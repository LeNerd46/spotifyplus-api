import { Context } from 'hono';
import { generatedJsonKey, getGenerationState, isGenerationRunning, saveGenerationState } from '../lyricsGeneration';
import { Lyrics } from '../types';
import { generationLease } from '../durable-objects/generationCoordinator';

export const GetLyricsGenerationStatus = async (c: Context<{ Bindings: Env }>) => {
    c.header('Cache-Control', 'no-store');
    try {
        const spotifyId = c.req.param('id') ?? '';
        if (!/^[a-zA-Z0-9]{22}$/.test(spotifyId)) return c.json({ error: 'Invalid Spotify track ID' }, 400);

        const state = await getGenerationState(c.env, spotifyId);
        if (!state) return c.json({ error: 'No lyrics generation found for this track' }, 404);

        if (state.Status === 'processing') {
            const lease = await generationLease(c.env, spotifyId, 'owns', state.GenerationId);
            if (isGenerationRunning(state) && lease.owns) return c.json({ status: 'processing' });

            // Only persist the failure if the job still owns the coordinator lease.
            // Otherwise an older status check could overwrite a newer generation.
            if (lease.owns) {
                state.Status = 'failed';
                state.Error = 'Lyrics generation stopped unexpectedly';
                state.UpdatedAt = Date.now();
                await saveGenerationState(c.env, state);
                await generationLease(c.env, spotifyId, 'release', state.GenerationId);
            }
            return c.json({ status: 'failed', error: 'Lyrics generation stopped unexpectedly' });
        }

        if (state.Status === 'failed') return c.json({ status: 'failed', error: state.Error ?? 'Lyrics generation failed' });
        const generatedObject = await c.env.LYRICS_BUCKET.get(generatedJsonKey(spotifyId));
        if (!generatedObject) return c.json({ error: 'Generated lyrics could not be found' }, 500);
        const lyrics = await generatedObject.json() as Lyrics;
        return c.json({ status: 'complete', lyrics });
    } catch (error) {
        console.error('Failed to get lyrics generation status:', error);
        return c.json({ error: 'Failed to get lyrics generation status' }, 500);
    }
};
