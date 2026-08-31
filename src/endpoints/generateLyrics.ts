import { Context } from "hono";
import { BlankInput } from "hono/types";
import { Lyrics } from "../types";
import { AUDIO_CONTENT_TYPE, LyricsGenerationState, createAudioUploadUrl, generatedJsonKey, generationSourceKey, saveGenerationState } from "../lyricsGeneration";

export const GenerateLyrics = async (c: Context<any, any, BlankInput>) => {
    try {
        const spotifyId = c.req.param('id');

        if (!spotifyId) return c.json({
            error: 'No ID provided'
        }, 400);

        const cachedLyrics = await c.env.LYRICS_CACHE.get(`lyrics:${spotifyId}`);

        if (cachedLyrics) {
            const lyrics = (JSON.parse(cachedLyrics)) as Lyrics;

            if (lyrics.Type === 'Syllable' && lyrics.GeneratedWithAI) {
                return c.json({
                    status: 'complete',
                    lyrics
                });
            }

            if (lyrics.Type === 'Syllable' && !lyrics.GeneratedWithAI) {
                return c.json({
                    status: 'native',
                    lyrics
                });
            }

            if (lyrics.Type === 'Static') {
                return c.json({
                    error: 'AI generation requires line-synced Apple Music lyrics'
                }, 409);
            }
        }

        const generatedObject = await c.env.LYRICS_BUCKET.get(generatedJsonKey(spotifyId));

        if (generatedObject) {
            const lyrics = (await generatedObject.json()) as Lyrics;
            lyrics.GeneratedWithAI = true;

            await c.env.LYRICS_CACHE.put(`lyrics:${spotifyId}`, JSON.stringify(lyrics));

            return c.json({
                status: 'complete',
                lyrics
            });
        }

        const sourceTtml = await c.env.LYRICS_CACHE.get(generationSourceKey(spotifyId));

        if (!sourceTtml) {
            return c.json({
                error: 'No line-synced generation source is cached. Request /api/lyrics/' + spotifyId + ' first'
            }, 409);
        }

        const generationId = crypto.randomUUID();

        const audioKey = (`pending/${spotifyId}/` + `${generationId}.mp3`);

        const uploadUrl = await createAudioUploadUrl(c.env, audioKey);

        const now = Date.now();
        const state: LyricsGenerationState = {
            SpotifyId: spotifyId,
            GenerationId: generationId,
            AudioKey: audioKey,
            CreatedAt: now,
            UpdatedAt: now,
            Status: 'awaiting_upload'
        };

        await saveGenerationState(c.env, state);

        return c.json({
            status: 'upload_required',
            generationId,
            uploadUrl,
            method: 'PUT',
            headers: {
                'Content-Type': AUDIO_CONTENT_TYPE
            }
        });

    } catch (error) {
        console.error(
            'Failed to start lyrics generation:',
            error
        );

        return c.json({
            error: 'Failed to start lyrics generation'
        }, 500);
    }
};
