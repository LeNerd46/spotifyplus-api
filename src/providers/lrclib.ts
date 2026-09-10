import { LrcLyrics, parseLrcLyrics } from "../lrcLyricsParser";
import { LyricsProvider, LyricsProviderContext, LyricsProviderResult } from "./types";

const LrclibProvider: LyricsProvider = {
    name: 'Lrclib',
    priority: 1,

    async getLyrics(context: LyricsProviderContext): Promise<LyricsProviderResult> {
        const lrcResponse = await fetch(`https://lrclib.net/api/get?track_name=${encodeURIComponent(context.track.name)}&artist_name=${encodeURIComponent(context.track.artists[0]?.name ?? '')}&album_name=${encodeURIComponent(context.track.album.name)}&duration=${encodeURIComponent(context.track.duration_ms / 1000)}`);

        if (lrcResponse.ok) {
            const json = await lrcResponse.json() as LrcLyrics;
            const lyrics = parseLrcLyrics(json);

            if (lyrics) {
                const result = lyrics;
                //@ts-ignore
                await context.env.LYRICS_CACHE.put(`lyrics:${context.spotifyId}`, JSON.stringify(result));
                return { lyrics: result };
            }
        }

        return { lyrics: null, reason: 'No matching lyrics found' };
    }
}

export default LrclibProvider;