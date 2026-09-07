import type { Context } from 'hono';
import type { LineSyncedLyrics } from '../types';
import { validateCommunityLyrics } from '../communityLyrics';

export const SubmitLyrics = async (c: Context<{ Bindings: Env }>) => {
    const id = c.req.param('id') ?? '';

    if (!/^[a-zA-Z0-9]{22}$/.test(id)) {
        return c.json({ error: 'Invalid Spotify track ID' }, 400);
    }

    let input: unknown;
    try {
        input = await c.req.json();
    } catch {
        return c.json({ error: 'Invalid JSON' }, 400);
    }

    const cache = c.env.LYRICS_CACHE;
    const sourceJson = (await cache.get(`lyrics-source:${id}`)) ?? (await cache.get(`lyrics:${id}`));

    if (!sourceJson) {
        return c.json({ error: 'Load the original line lyrics before submitting' }, 409);
    }

    const source = JSON.parse(sourceJson) as LineSyncedLyrics;
    if (source.Type !== 'Line') {
        return c.json({ error: 'Community sync requires original line lyrics' }, 409);
    }

    let lyrics;
    try {
        lyrics = validateCommunityLyrics(input, source);
    } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : 'Invalid lyrics' }, 400);
    }

    await cache.put(`lyrics-source:${id}`, sourceJson);
    const json = JSON.stringify(lyrics);

    await cache.put(`lyrics-community:${id}`, json);
    await cache.put(`lyrics:${id}`, json);

    return c.json(lyrics, 201);
};
