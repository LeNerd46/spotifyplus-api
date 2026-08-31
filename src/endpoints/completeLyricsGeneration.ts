import { Context } from "hono";
import { BlankInput } from "hono/types";
import { parseLyrics } from "../lyricsParser";
import { Lyrics } from "../types";
import { MAX_AUDIO_BYTES, LyricsGenerationState, createAudioDownloadUrl, generatedJsonKey, generatedTtmlKey, generationSourceKey, generationStateKey, saveGenerationState } from "../lyricsGeneration";

type CompleteGenerationBody = {
    generationId?: string;
};

type ModalGenerationResponse = {
    trackId?: string;
    ttml?: string;
    analysis?: unknown;
    detail?: string;
};

export const CompleteLyricsGeneration = async (c: Context<any, any, BlankInput>) => {
    const spotifyId = c.req.param('id');

    let generationId: string | null = null;
    let audioKey: string | null = null;
    let state: LyricsGenerationState | null = null;

    const saveFailedState = async (error: string) => {
        if (!state) {
            return;
        }

        state.Status = 'failed';
        state.Error = error;
        state.UpdatedAt = Date.now();

        await saveGenerationState(c.env, state);
    };

    try {
        if (!spotifyId) return c.json({
            error: 'No ID provided'
        }, 400);

        const body = (await c.req.json()) as CompleteGenerationBody;

        generationId = (body.generationId ?? null);

        if (!generationId) {
            return c.json({
                error: 'No generation ID provided'
            }, 400);
        }

        const stateJson = await c.env.LYRICS_CACHE.get(generationStateKey(generationId));

        if (!stateJson) {
            return c.json({
                error: 'Generation does not exist or has expired'
            }, 404);
        }

        state = (JSON.parse(stateJson)) as LyricsGenerationState;

        if (state.GenerationId !== generationId || state.SpotifyId !== spotifyId) {
            return c.json({
                error: 'Generation does not match this track'
            }, 400);
        }

        audioKey = state.AudioKey;
        const audioObject = await c.env.AUDIO_BUCKET.head(audioKey);

        if (!audioObject) {
            await saveFailedState('Audio upload was not found');

            return c.json({
                error: 'Audio upload was not found'
            }, 409);
        }

        if (audioObject.size <= 0 || audioObject.size > MAX_AUDIO_BYTES) {
            await c.env.AUDIO_BUCKET.delete(audioKey);
            await saveFailedState('Uploaded audio file is empty or too large');

            return c.json({
                error: 'Uploaded audio file is empty or too large'
            }, 413);
        }

        const sourceTtml = await c.env.LYRICS_CACHE.get(generationSourceKey(spotifyId));

        if (!sourceTtml) {
            await saveFailedState('Generation source has expired');

            return c.json({
                error: 'Generation source has expired'
            }, 409);
        }

        state.Status = 'processing';
        state.Error = undefined;
        state.UpdatedAt = Date.now();

        await saveGenerationState(c.env, state);

        const audioUrl = await createAudioDownloadUrl(c.env, audioKey);

        console.log(`Starting Modal generation for ${spotifyId}...`);

        const modalResponse = await fetch(c.env.MODAL_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Modal-Key': c.env.MODAL_KEY,
                'Modal-Secret': c.env.MODAL_SECRET
            },
            body: JSON.stringify({
                trackId: spotifyId,
                audioUrl,
                ttml: sourceTtml,
                includeAnalysis: false
            })
        }
        );

        const modalText = await modalResponse.text();

        if (!modalResponse.ok) {
            console.error(
                'Modal generation failed:',
                modalResponse.status,
                modalText
            );

            const error = modalText || 'Modal generation failed';

            await saveFailedState(error);

            return c.json({
                error
            }, 502);
        }

        let modalJson: ModalGenerationResponse;

        try {
            modalJson = JSON.parse(
                modalText
            ) as ModalGenerationResponse;
        } catch {
            console.error(
                'Modal returned invalid JSON:',
                modalText
            );

            const error = 'Modal returned an invalid response';

            await saveFailedState(error);

            return c.json({
                error
            }, 502);
        }

        if (!modalJson.ttml) {
            await saveFailedState('Modal did not return TTML');

            return c.json({
                error: 'Modal did not return TTML'
            }, 502);
        }

        const lyrics = parseLyrics(modalJson.ttml) as Lyrics;

        if (lyrics.Type !== 'Syllable') {
            console.error(
                'Generated TTML did not parse as syllable lyrics'
            );

            const error = 'Generated lyrics were not word/syllable synced';

            await saveFailedState(error);

            return c.json({
                error
            }, 502);
        }

        lyrics.GeneratedWithAI = true;
        const generatedAt = (new Date().toISOString());
        const lyricsJson = JSON.stringify(lyrics);

        await Promise.all([
            c.env.LYRICS_BUCKET.put(generatedTtmlKey(spotifyId), modalJson.ttml, {
                httpMetadata: {
                    contentType: 'application/ttml+xml; charset=utf-8'
                },
                customMetadata: {
                    spotifyId,
                    generatedWithAI: 'true',
                    generatedAt
                }
            }
            ),

            c.env.LYRICS_BUCKET.put(
                generatedJsonKey(spotifyId),
                lyricsJson,
                {
                    httpMetadata: {
                        contentType: 'application/json; charset=utf-8'
                    },
                    customMetadata: {
                        spotifyId,
                        generatedWithAI: 'true',
                        generatedAt
                    }
                }
            )
        ]);

        await c.env.LYRICS_CACHE.put(`lyrics:${spotifyId}`, lyricsJson);

        state.Status = 'complete';
        state.Error = undefined;
        state.UpdatedAt = Date.now();

        await saveGenerationState(c.env, state);

        console.log(`Lyrics generation complete for ${spotifyId}!`);

        return c.json({
            status: 'complete',
            lyrics
        });

    } catch (error) {
        console.error(
            'Failed to complete lyrics generation:',
            error
        );

        const responseError = 'Failed to complete lyrics generation';

        try {
            await saveFailedState(responseError);
        } catch (stateError) {
            console.error(
                'Failed to save lyrics generation failure:',
                stateError
            );
        }

        return c.json({
            error: responseError
        }, 500);

    } finally {
        if (audioKey) {
            try {
                await c.env.AUDIO_BUCKET.delete(audioKey);
            } catch (error) {
                console.error('Failed to delete temporary audio:', error);
            }
        }

    }
};
