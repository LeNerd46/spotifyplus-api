import { Context } from 'hono';
import { parseLyrics } from '../lyricsParser';
import { Lyrics } from '../types';
import { SpotifyMetadataError } from '../spotify/metadata';
import { findProviderLyrics } from './getLyrics';
import { generationLease } from '../durable-objects/generationCoordinator';
import {
    MAX_STEM_BYTES, MODAL_TIMEOUT_MS, STEM_NAMES, LyricsGenerationState, StemName,
    createAudioDownloadUrl, generatedJsonKey, generatedTtmlKey, getGenerationState,
    lyricsToTtml, saveGenerationState, stemKey
} from '../lyricsGeneration';

type ModalGenerationResponse = { trackId?: string; ttml?: string; analysis?: unknown; detail?: string };
type GenerationResult = { status: 200 | 409 | 500 | 502; body: { status: 'complete'; lyrics: Lyrics } | { status: 'failed'; error: string } };

export const GenerateLyrics = async (c: Context<{ Bindings: Env }>) => {
    c.header('Cache-Control', 'no-store');
    const spotifyId = c.req.param('id') ?? '';
    if (!/^[a-zA-Z0-9]{22}$/.test(spotifyId)) return c.json({ error: 'Invalid Spotify track ID' }, 400);

    // const ip = c.req.header('CF-Connecting-IP');
    // if (!ip) return c.json({ error: 'Unable to get IP address' }, 400);

    // const limit = await c.env.SUBMIT_RATE_LIMITER.limit({ key: `generate:ip:${ip}` });
    // if (!limit.success) {
    //     c.header('Retry-After', '60');
    //     return c.json({ error: 'Too many generation requests. Please try again later' }, 429);
    // }

    // Reject excessively large uploads at the edge when Content-Length is available.
    const contentLength = Number(c.req.header('Content-Length') ?? 0);
    if (contentLength > MAX_STEM_BYTES * STEM_NAMES.length + 1024 * 1024) return c.json({ error: 'Upload too large' }, 413);

    let form: FormData;
    try {
        form = await c.req.formData();
    } catch {
        return c.json({ error: 'Expected multipart form data with vocals and instrumental files' }, 400);
    }

    const stems = {} as Record<StemName, File>;
    for (const name of STEM_NAMES) {
        const file = form.get(name);
        if (!(file instanceof File)) return c.json({ error: `Missing ${name} audio file` }, 400);
        if (file.size <= 0 || file.size > MAX_STEM_BYTES) return c.json({ error: `The ${name} audio file is empty or too large` }, 413);
        if (file.type && !file.type.startsWith('audio/') && file.type !== 'application/octet-stream') return c.json({ error: `The ${name} file is not audio` }, 415);
        stems[name] = file;
    }

    const generationId = crypto.randomUUID();
    let acquired = false;
    let workStarted = false;
    try {
        const lease = await generationLease(c.env, spotifyId, 'acquire', generationId);
        if (!lease.acquired) return c.json({ status: 'processing', error: 'Lyrics are already being generated for this track' }, 409);
        acquired = true;

        const sourceLyrics = await getSourceLyrics(c, spotifyId);
        if (!sourceLyrics) return c.json({ error: 'Could not find lyrics to align for this track' }, 404);
        if (sourceLyrics.Type === 'Syllable') return c.json({ error: 'This track already has word synced lyrics' }, 409);

        const state: LyricsGenerationState = {
            SpotifyId: spotifyId,
            GenerationId: generationId,
            CreatedAt: Date.now(),
            UpdatedAt: Date.now(),
            Status: 'processing'
        };
        await saveGenerationState(c.env, state);

        const work = runGeneration(c.env, state, stems, lyricsToTtml(sourceLyrics));
        workStarted = true;
        c.executionCtx.waitUntil(work);
        const result = await work;
        return c.json(result.body, result.status);
    } catch (error) {
        console.error('Failed to start lyrics generation:', error);
        if (error instanceof SpotifyMetadataError) return c.json({ error: error.message }, error.status as 400 | 404 | 502);
        return c.json({ error: 'Failed to generate lyrics' }, 500);
    } finally {
        if (acquired && !workStarted) {
            try { await generationLease(c.env, spotifyId, 'release', generationId); }
            catch (error) { console.error('Failed to release unused generation lease:', error); }
        }
    }
};

const getSourceLyrics = async (c: Context<{ Bindings: Env }>, spotifyId: string) => {
    const [communityLyrics, cachedLyrics] = await Promise.all([
        c.env.LYRICS_CACHE.get(`lyrics-community:${spotifyId}`),
        c.env.LYRICS_CACHE.get(`lyrics:${spotifyId}`)
    ]);
    const cached = communityLyrics ?? cachedLyrics;
    if (cached) return JSON.parse(cached) as Lyrics;
    return findProviderLyrics(c.env, spotifyId, promise => c.executionCtx.waitUntil(promise));
};

const runGeneration = async (env: Env, state: LyricsGenerationState, stems: Record<StemName, File>, sourceTtml: string): Promise<GenerationResult> => {
    const { SpotifyId: spotifyId, GenerationId: generationId } = state;
    const keys = STEM_NAMES.map(name => stemKey(spotifyId, generationId, name));
    const owns = async () => (await generationLease(env, spotifyId, 'owns', generationId)).owns === true;

    const fail = async (error: string, status: GenerationResult['status'] = 502): Promise<GenerationResult> => {
        try {
            if (await owns()) {
                state.Status = 'failed';
                state.Error = error;
                state.UpdatedAt = Date.now();
                await saveGenerationState(env, state);
            }
        } catch (stateError) {
            console.error('Failed to save lyrics generation failure:', stateError);
        }
        return { status, body: { status: 'failed', error } };
    };

    try {
        await Promise.all(STEM_NAMES.map(name => env.AUDIO_BUCKET.put(stemKey(spotifyId, generationId, name), stems[name], {
            httpMetadata: { contentType: stems[name].type || 'application/octet-stream' }
        })));

        const [vocalsUrl, instrumentalUrl] = await Promise.all(keys.map(key => createAudioDownloadUrl(env, key)));
        const modalResponse = await fetch(env.MODAL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Modal-Key': env.MODAL_KEY, 'Modal-Secret': env.MODAL_SECRET },
            body: JSON.stringify({ trackId: spotifyId, vocalsUrl, instrumentalUrl, ttml: sourceTtml, includeAnalysis: false }),
            signal: AbortSignal.timeout(MODAL_TIMEOUT_MS)
        });

        if (!modalResponse.ok) {
            const detail = (await modalResponse.text()).slice(0, 2000);
            console.error('Modal generation failed:', modalResponse.status, detail);
            return fail('Modal generation failed');
        }

        let modalJson: ModalGenerationResponse;
        try {
            modalJson = await modalResponse.json() as ModalGenerationResponse;
        } catch {
            return fail('Modal returned an invalid response');
        }
        if (!modalJson.ttml) return fail('Modal did not return TTML');

        const lyrics = parseLyrics(modalJson.ttml);
        if (lyrics.Type !== 'Syllable') return fail('Generated lyrics were not word/syllable synced');
        lyrics.ai = true;

        // A stale job must never publish or cache results belonging to a newer job.
        if (!await owns()) return { status: 409, body: { status: 'failed', error: 'Generation was superseded' } };
        const current = await getGenerationState(env, spotifyId);
        if (current?.GenerationId !== generationId) return { status: 409, body: { status: 'failed', error: 'Generation was superseded' } };

        const generatedAt = new Date().toISOString();
        const lyricsJson = JSON.stringify(lyrics);
        const customMetadata = { spotifyId, ai: 'true', generatedAt };
        await Promise.all([
            env.LYRICS_BUCKET.put(generatedTtmlKey(spotifyId), modalJson.ttml, {
                httpMetadata: { contentType: 'application/ttml+xml; charset=utf-8' }, customMetadata
            }),
            env.LYRICS_BUCKET.put(generatedJsonKey(spotifyId), lyricsJson, {
                httpMetadata: { contentType: 'application/json; charset=utf-8' }, customMetadata
            })
        ]);
        await env.LYRICS_CACHE.put(`lyrics:${spotifyId}`, lyricsJson);

        state.Status = 'complete';
        state.Error = undefined;
        state.UpdatedAt = Date.now();
        await saveGenerationState(env, state);
        return { status: 200, body: { status: 'complete', lyrics } };
    } catch (error) {
        console.error('Failed to complete lyrics generation:', error);
        const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
        return fail(timedOut ? 'Modal generation timed out' : 'Failed to complete lyrics generation', timedOut ? 502 : 500);
    } finally {
        try { await env.AUDIO_BUCKET.delete(keys); }
        catch (error) { console.error('Failed to delete temporary audio:', error); }
        try { await generationLease(env, spotifyId, 'release', generationId); }
        catch (error) { console.error('Failed to release generation lease:', error); }
    }
};
