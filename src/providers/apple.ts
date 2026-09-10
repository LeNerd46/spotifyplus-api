import { parseLyrics } from "../lyricsParser";
import { Lyrics } from "../types";
import { LyricsProvider, LyricsProviderContext, LyricsProviderResult } from "./types";

const AppleMusicProvider: LyricsProvider = {
    name: 'Apple Music',
    priority: 0,

    async getLyrics(context: LyricsProviderContext): Promise<LyricsProviderResult> {
        const { getAppleMusicToken } = await import('../appleMusicToken');
        const token = await getAppleMusicToken(context.env);
        const mediaToken = process.env.APPLE_MUSIC_TOKEN as string;

        const appleResponse = await fetch(`https://amp-api.music.apple.com/v1/catalog/us/songs?filter[isrc]=${encodeURIComponent(context.track.external_ids.isrc)}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                Origin: 'https://music.apple.com',
                'Media-User-Token': mediaToken
            }
        });

        if (!appleResponse.ok) {
            return { lyrics: null, reason: 'Failed to find song from Apple Music' };
        }

        const appleJson = await appleResponse.json() as {
            data?: { id: string; type: string; }[]
        };

        const ids = appleJson.data?.filter(x => x.type === 'songs').map(x => x.id) ?? [];

        if (ids.length === 0) {
            return { lyrics: null, reason: 'No matching Apple Music songs found' };
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
                //@ts-ignore
                await context.env.APPLE_CACHE.delete('apple-developer-token');

                return { lyrics: null, reason: 'Apple Music token expired' };
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

            //@ts-ignore
            await context.env.LYRICS_CACHE.put(`lyrics:${context.spotifyId}`, JSON.stringify(lyrics));
            return { lyrics };
        }

        return { lyrics: null, reason: 'Failed to get lyrics' };
    }
}

export default AppleMusicProvider;