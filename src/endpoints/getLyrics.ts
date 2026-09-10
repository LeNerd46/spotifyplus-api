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
        // Not including static lyrics. I think we'd rather have LRCLib than static lyrics

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

        // Next we'll check NetEase!! 
        // Mostly because idk what this is, and we have to make 2 requests for this one whereas lrclib only needs one

        const netEaseSearchResponse = await fetch(`https://music.163.com/api/search/pc?limit=1&type=1&offset=0&s=${encodeURIComponent(`${track.name} ${track.artists[0]?.name ?? ''}`)}`);
        const netEaseThing = await netEaseSearchResponse.json() as { result?: { songs?: { id: number }[] } };

        if (netEaseSearchResponse.ok && netEaseThing.result?.songs?.[0]?.id) {
            const netEaseSearch = await fetch(`https://music.163.com/api/song/lyric?lv=1&id=${netEaseThing.result?.songs?.[0]?.id}`);
            const lyricsResponse = await netEaseSearch.json() as { lrc?: { lyric?: string } };

            if (netEaseSearch.ok && lyricsResponse.lrc?.lyric) {
                // NetEase shoves the artist at the beginning of their lyrics for some reason. We don't want that! The artists are not apart of the lyrics!
                const netEaseLyrics = lyricsResponse.lrc.lyric.split('\n').filter(line => {
                    const match = line.match(/^\[\d{2}:\d{2}(?:\.\d+)?\](.*)$/);
                    if (!match) return true;

                    const text = match[1]?.trim();

                    return !/^(作词|作曲)\s*[:：]/.test(text!);
                }).join('\n');

                const parsedLyrics = parseLrcLyrics({ duration: track.duration_ms / 1000, syncedLyrics: netEaseLyrics });
                if (parsedLyrics) {
                    await c.env.LYRICS_CACHE.put(`lyrics:${spotifyId}`, JSON.stringify(parsedLyrics));
                    return c.json(parsedLyrics);
                }
            }
        }

        // Fuck Musixmatch dude. They're stuff is so innacurate and I hate it so much
        // This is the last resort. If literally no other lyrics provider has lyrics, then and only then will I check Musixmatch
        // I hate them so much that I am not even going to cache the token. You need a hella niche song to even reach this point (I also just don't want to go through the work to cache it)
        // or an instrumental song, I guess
        // I am literally only adding this so that people will stop asking me why Spotify has lyrics but my API does not

        console.log('Am I even reaching this point?');

        const musixmatchTokenResponse = await fetch(`https://apic-appmobile.musixmatch.com/ws/1.1/token.get?app_id=mac-ios-v2.0`);
        const musixmatchTokenJson = await musixmatchTokenResponse.json() as { message?: { body?: { user_token?: string } } };
        if (!musixmatchTokenResponse.ok || !musixmatchTokenJson.message?.body?.user_token) {
            console.error(await musixmatchTokenResponse.text());

            return fallbackLyrics ? c.json(fallbackLyrics) : c.json({
                error: 'Could not find lyrics'
            }, 404);
        }

        const musixmatchLyricsResponse = await fetch(`https://apic-appmobile.musixmatch.com/ws/1.1/macro.subtitles.get?track_isrc=${encodeURIComponent(track.external_ids.isrc)}&usertoken=${encodeURIComponent(musixmatchTokenJson.message.body.user_token)}&app_id=mac-ios-v2.0`);
        const musixmatchLyricsJson = await musixmatchLyricsResponse.json() as { message?: { body?: { macro_calls?: { 'track.subtitles.get'?: { message?: { body?: { subtitle_list?: Array<{ subtitle?: { subtitle_body?: string } }> } } } } } } };
        if (!musixmatchLyricsResponse.ok || !musixmatchLyricsJson.message?.body?.macro_calls?.['track.subtitles.get']?.message?.body?.subtitle_list?.[0]?.subtitle?.subtitle_body) {
            console.error(await musixmatchLyricsResponse.text());

            return fallbackLyrics ? c.json(fallbackLyrics) : c.json({
                error: 'Could not find lyrics'
            }, 404);
        }

        const musixmatchLyrics = parseLrcLyrics({ duration: track.duration_ms / 1000, syncedLyrics: musixmatchLyricsJson.message.body.macro_calls['track.subtitles.get'].message.body.subtitle_list[0].subtitle.subtitle_body });
        if (musixmatchLyrics) {
            await c.env.LYRICS_CACHE.put(`lyrics:${spotifyId}`, JSON.stringify(musixmatchLyrics));
            return c.json(musixmatchLyrics);
        }

        if (fallbackLyrics) {
            return c.json(fallbackLyrics);
        }

        return c.json({
            error: 'Could not find lyrics'
        }, 404);
    } catch (error) {
        console.error('Failed to get Apple Music token:', error);

        return c.json({
            error: 'Failed to get Apple Music token'
        }, 500);
    }
};
