import { Context } from "hono";
import { BlankInput } from "hono/types";
import { SpotifyApi } from "@spotify/web-api-ts-sdk";
import { parseLyrics } from "../lyricsParser";
import { Lyrics } from "../types";
import { LrcLyrics, parseLrcLyrics } from "../lrcLyricsParser";

const sdk = SpotifyApi.withClientCredentials(process.env.SPOTIFY_CLIENT!, process.env.SPOTIFY_SECRET!)

export const GetLyrics = async (c: Context<any, any, BlankInput>) => {
    try {
        const spotifyId = c.req.param('id');
        if (!spotifyId) return c.json({
            error: 'No ID provided'
        }, 400);

        const cachedLyrics = await c.env.LYRICS_CACHE.get(`lyrics-community:${spotifyId}`) ?? await c.env.LYRICS_CACHE.get(`lyrics:${spotifyId}`);

        if (cachedLyrics) {
            return c.json(JSON.parse(cachedLyrics));
        }

        const track = await sdk.tracks.get(spotifyId);
        if (!track.external_ids.isrc) return c.json({
            error: 'Could not get ISRC'
        }, 404);

        const { getAppleMusicToken } = await import('../appleMusicToken');
        const token = await getAppleMusicToken(c.env);
        const mediaToken = process.env.APPLE_MUSIC_TOKEN as string;

        const appleResponse = await fetch(`https://amp-api.music.apple.com/v1/catalog/us/songs?filter[isrc]=${encodeURIComponent(track.external_ids.isrc)}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                Origin: 'https://music.apple.com',
                'Media-User-Token': mediaToken
            }
        });

        if (!appleResponse.ok) {
            return c.json({
                error: 'Failed to get song from Apple Music'
            }, 400);
        }

        const appleJson = await appleResponse.json() as {
            data?: { id: string; type: string; }[]
        };

        const ids = appleJson.data?.filter(x => x.type === 'songs').map(x => x.id) ?? [];

        if (ids.length === 0) {
            const lrcResponse = await fetch(`https://lrclib.net/api/get?track_name=${encodeURIComponent(track.name)}&artist_name=${encodeURIComponent(track.artists[0]?.name ?? '')}&album_name=${encodeURIComponent(track.album.name)}&duration=${encodeURIComponent(track.duration_ms / 1000)}`);

            if (lrcResponse.ok) {
                const json = await lrcResponse.json() as LrcLyrics;
                const lyrics = parseLrcLyrics(json);

                if (lyrics) {
                    const result = lyrics;
                    await c.env.LYRICS_CACHE.put(`lyrics:${spotifyId}`, JSON.stringify(result));
                    return c.json(result);
                }
            }

            return c.json({
                error: 'No matching Apple Music songs found'
            }, 404);
        }

        let fallbackLyrics: Lyrics | null = null;

        for (const id of ids) {
            const response = await fetch(`https://amp-api.music.apple.com/v1/catalog/us/songs/${id}/syllable-lyrics?l[lyrics]=en-US&l[script]=en-Latn&extend=ttmlLocalizations`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json',
                    Origin: 'https://music.apple.com',
                    'Media-User-Token': mediaToken
                }
            });

            if (response.status === 401) {
                await c.env.APPLE_CACHE.delete('apple-developer-token');

                return c.json({
                    error: 'Apple Music token expired'
                }, 401);
            }

            if (!response.ok) {
                console.log(`Failed to get lyrics for ${id}`);
                continue;
            }

            const json: any = await response.json();
            const ttml = json.data?.[0]?.attributes?.ttmlLocalizations;
            if (!ttml) {
                console.log(`No ttml found for ${id}`)
                continue;
            }

            const lyrics = parseLyrics(ttml);

            if (lyrics.Type === 'Static') {
                fallbackLyrics ??= lyrics;
                continue;
            }

            await c.env.LYRICS_CACHE.put(`lyrics:${spotifyId}`, JSON.stringify(lyrics));
            return c.json(lyrics);
        }

        // Attempt to get lyrics from LRCLib next if no Apple Music lyrics were found
        // Not including static lyrics. We'd rather have LRCLib than static lyrics

        const lrcResponse = await fetch(`https://lrclib.net/api/get?track_name=${encodeURIComponent(track.name)}&artist_name=${encodeURIComponent(track.artists[0]?.name ?? '')}&album_name=${encodeURIComponent(track.album.name)}&duration=${encodeURIComponent(track.duration_ms / 1000)}`);

        if (lrcResponse.ok) {
            const json = await lrcResponse.json() as LrcLyrics;
            const lyrics = parseLrcLyrics(json);

            if (lyrics) {
                const result = lyrics.Type === 'Static' ? fallbackLyrics ?? lyrics : lyrics;
                await c.env.LYRICS_CACHE.put(`lyrics:${spotifyId}`, JSON.stringify(result));
                return c.json(result);
            }
        }

        if (fallbackLyrics) {
            return c.json(fallbackLyrics);
        }

        return c.json({
            error: 'Could not find lyrics for any matching Apple Music song'
        }, 404);
    } catch (error) {
        console.error('Failed to get Apple Music token:', error);

        return c.json({
            error: 'Failed to get Apple Music token'
        }, 500);
    }
};
