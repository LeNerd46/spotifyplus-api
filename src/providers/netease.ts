import { parseLrcLyrics } from "../lrcLyricsParser";
import { LyricsProvider, LyricsProviderContext, LyricsProviderResult } from "./types";

const NeteaseProvider: LyricsProvider = {
    name: 'Netease',
    priority: 1,

    async getLyrics(context: LyricsProviderContext): Promise<LyricsProviderResult> {
        const netEaseSearchResponse = await fetch(`https://music.163.com/api/search/pc?limit=1&type=1&offset=0&s=${encodeURIComponent(`${context.track.name} ${context.track.artists[0]?.name ?? ''}`)}`);
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

                const parsedLyrics = parseLrcLyrics({ duration: context.track.duration_ms / 1000, syncedLyrics: netEaseLyrics });
                if (parsedLyrics) {
                    //@ts-ignore
                    await context.env.LYRICS_CACHE.put(`lyrics:${context.spotifyId}`, JSON.stringify(parsedLyrics));
                    return { lyrics: parsedLyrics };
                }
            }
        }

        return { lyrics: null, reason: 'No matching lyrics found' };
    }
}

export default NeteaseProvider;