import { Context } from "hono";
import { BlankInput } from "hono/types";
import { generatedJsonKey, generationStateKey, LyricsGenerationState } from "../lyricsGeneration";
import { Lyrics } from "../types";

export const GetLyricsGenerationStatus = async (c: Context<any, any, BlankInput>) => {
    try {
        const spotifyId = c.req.param('id');
        const generationId = c.req.query('generationId');

        if (!spotifyId) {
            return c.json({
                error: 'No ID provided'
            }, 400);
        }

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

        const state = JSON.parse(stateJson) as LyricsGenerationState;

        if (state.GenerationId !== generationId || state.SpotifyId !== spotifyId) {
            return c.json({
                error: 'Generation does not match this track'
            }, 400);
        }

        if (state.Status === 'failed') {
            return c.json({
                status: 'failed',
                error: state.Error ?? 'Lyrics generation failed'
            });
        }

        if (state.Status !== 'complete') {
            return c.json({
                status: state.Status ?? 'processing'
            });
        }

        const generatedObject = await c.env.LYRICS_BUCKET.get(generatedJsonKey(spotifyId));

        if (!generatedObject) {
            return c.json({
                error: 'Generated lyrics could not be found'
            }, 500);
        }

        const lyrics = await generatedObject.json() as Lyrics;
        lyrics.GeneratedWithAI = true;

        return c.json({
            status: 'complete',
            lyrics
        });
    } catch (error) {
        console.error(
            'Failed to get lyrics generation status:',
            error
        );

        return c.json({
            error: 'Failed to get lyrics generation status'
        }, 500);
    }
};
