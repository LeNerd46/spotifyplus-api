import { Context } from "hono";
import { BlankInput } from "hono/types";
import { Lyrics } from "../types";
import AppleMusicProvider from "../providers/apple";
import LrclibProvider from "../providers/lrclib";
import NeteaseProvider from "../providers/netease";
import MusixmatchProvider from "../providers/musixmatch";
import { getSpotifyTrack, SpotifyMetadataError } from "../spotify/metadata";
import { removeBackgroundParentheses } from '../normalizeLyrics';

export const GetLyrics = async (c: Context<any, any, BlankInput>) => {
    try {
        const spotifyId = c.req.param('id');
        if (!spotifyId || !/^[a-zA-Z0-9]{22}$/.test(spotifyId)) {
            return c.json({ error: 'Invalid Spotify track ID' }, 400);
        }

        const [communityLyrics, cachedLyrics] = await Promise.all([
            c.env.LYRICS_CACHE.get(`lyrics-community:${spotifyId}`),
            c.env.LYRICS_CACHE.get(`lyrics:${spotifyId}`)
        ]);

        const normalizedCache = [communityLyrics, cachedLyrics].map((value, index) => {
            if (!value) return null;
            const lyrics = JSON.parse(value) as Lyrics;
            if (removeBackgroundParentheses(lyrics)) {
                const key = index === 0 ? `lyrics-community:${spotifyId}` : `lyrics:${spotifyId}`;
                c.executionCtx.waitUntil(c.env.LYRICS_CACHE.put(key, JSON.stringify(lyrics)));
            }
            return lyrics;
        });
        const lyrics = normalizedCache[0] ?? normalizedCache[1];

        if (lyrics) {
            return c.json(lyrics);
        }

        const providerLyrics = await findProviderLyrics(c.env, spotifyId, promise => c.executionCtx.waitUntil(promise));

        if (providerLyrics) {
            return c.json(providerLyrics);
        }

        return c.json({
            error: 'Could not find lyrics'
        }, 404);
    } catch (error) {
        console.error('Failed to get lyrics:', error);

        if (error instanceof SpotifyMetadataError) {
            return c.json({ error: error.message }, error.status as 400 | 404 | 502);
        }

        return c.json({
            error: 'Failed to get lyrics'
        }, 500);
    }
};

// Checks every provider in priority order, preferring synced lyrics over static ones
export const findProviderLyrics = async (env: Env, spotifyId: string, waitUntil: (promise: Promise<unknown>) => void): Promise<Lyrics | null> => {
    const track = await getSpotifyTrack(env, spotifyId);

    // We sort by priority because I care about some providers more than others
    const providers = [
        AppleMusicProvider,
        LrclibProvider,
        NeteaseProvider,
        MusixmatchProvider
    ].sort((a, b) => a.priority - b.priority);

    const providerGroups = Map.groupBy(providers, provider => provider.priority);

    let fallbackLyrics: Lyrics | null = null;

    for (const group of providerGroups.values()) {
        // Some providers have the same priority because I don't really prefer one over the other
        // So therefore we do them at the same time to speed things up if one of them do not have lyrics
        // And if you're requesting lyrics for a song that only has lyrics on Musixmatch, you deserve to wait

        const results = await Promise.all(group.map(async provider => {
            try {
                const result = await provider.getLyrics({
                    env,
                    spotifyId,
                    track
                });

                return {
                    provider,
                    lyrics: result
                };
            } catch (error) {
                return {
                    provider,
                    lyrics: null
                };
            }
        }));

        for (const result of results) {
            if (!result.lyrics || !result.lyrics.lyrics) continue;
            removeBackgroundParentheses(result.lyrics.lyrics);

            if (result.lyrics.lyrics?.Type === 'Static') {
                fallbackLyrics ??= result.lyrics.lyrics;
                continue;
            }

            waitUntil(env.LYRICS_CACHE.put(`lyrics:${spotifyId}`, JSON.stringify(result.lyrics.lyrics)));
            return result.lyrics.lyrics;
        }
    }

    return fallbackLyrics;
};
