import type { Context } from 'hono';
import type { LineSyncedLyrics } from '../types';
import { validateCommunityLyrics } from '../communityLyrics';
import { parseEnrichedLrcLyrics } from '../lrcLyricsParser';
import { parseLyrics } from '../lyricsParser';

type CommunityLyricsUser = {
    username: string;
    avatar?: string;
};

type SubmitLyricsBody = {
    user?: CommunityLyricsUser;
    format?: 'json' | 'ttml' | 'lrc';
    lyrics: unknown;
};

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

    if (!input || typeof input !== 'object' || !('lyrics' in input)) {
        return c.json({ error: 'Lyrics are required' }, 400);
    }

    const body = input as SubmitLyricsBody;

    if (body.user) {
        if (typeof body.user !== 'object') {
            return c.json({ error: 'Invalid user' }, 400);
        }

        if (typeof body.user.username !== 'string' || !body.user.username.trim()) {
            return c.json({ error: 'Invalid username' }, 400);
        }

        if (body.user.avatar !== undefined && typeof body.user.avatar !== 'string') {
            return c.json({ error: 'Invalid avatar' }, 400);
        }
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

    let submittedLyrics: unknown;

    try {
        switch (body.format ?? 'json') {
            case 'json':
                submittedLyrics = body.lyrics;
                break;

            case 'ttml':
                if (typeof body.lyrics !== 'string') {
                    throw new Error('TTML lyrics must be text');
                }

                submittedLyrics = parseLyrics(body.lyrics);
                break;

            case 'lrc':
                if (typeof body.lyrics !== 'string') {
                    throw new Error('LRC lyrics must be text');
                }

                submittedLyrics = parseEnrichedLrcLyrics({
                    duration: source.EndTime,
                    syncedLyrics: body.lyrics
                });

                if (!submittedLyrics) {
                    throw new Error('Invalid enriched LRC lyrics');
                }

                break;

            default:
                throw new Error('Unsupported lyrics format');
        }
    } catch (error) {
        return c.json({
            error: error instanceof Error ? error.message : 'Failed to parse lyrics'
        }, 400);
    }

    let lyrics;

    try {
        lyrics = validateCommunityLyrics(submittedLyrics, source);
    } catch (error) {
        return c.json({
            error: error instanceof Error ? error.message : 'Invalid lyrics'
        }, 400);
    }

    const communityLyrics = {
        ...lyrics,
        ...(body.user && {
            SubmittedBy: {
                username: body.user.username.trim(),
                ...(body.user.avatar && { avatar: body.user.avatar })
            }
        })
    };

    await cache.put(`lyrics-source:${id}`, sourceJson);

    const json = JSON.stringify(communityLyrics);

    await cache.put(`lyrics-community:${id}`, json);
    await cache.put(`lyrics:${id}`, json);

    return c.json(communityLyrics, 201);
};