import { parseLrcLyrics } from "../lrcLyricsParser";
import { LyricsProvider, LyricsProviderContext, LyricsProviderResult } from "./types";

// Fuck Musixmatch dude. They're stuff is so innacurate and I hate it so much
// This is the last resort. If literally no other lyrics provider has lyrics, then and only then will I check Musixmatch
// I hate them so much that I am not even going to cache the token. You need a hella niche song to even reach this point (I also just don't want to go through the work to cache it)
// or an instrumental song, I guess
// I am literally only adding this so that people will stop asking me why Spotify has lyrics but my API does not
// I just really need people to know how much I dislike Musixmatch

const MusixmatchProvider: LyricsProvider = {
    name: 'Musixmatch',
    priority: 2,

    async getLyrics(context: LyricsProviderContext): Promise<LyricsProviderResult> {
        const musixmatchTokenResponse = await fetch(`https://apic-appmobile.musixmatch.com/ws/1.1/token.get?app_id=mac-ios-v2.0`);
        const musixmatchTokenJson = await musixmatchTokenResponse.json() as { message?: { body?: { user_token?: string } } };
        if (!musixmatchTokenResponse.ok || !musixmatchTokenJson.message?.body?.user_token) {
            return { lyrics: null, reason: 'Could not get Musixmatch token' };
        }

        const musixmatchLyricsResponse = await fetch(`https://apic-appmobile.musixmatch.com/ws/1.1/macro.subtitles.get?track_isrc=${encodeURIComponent(context.track.external_ids.isrc)}&usertoken=${encodeURIComponent(musixmatchTokenJson.message.body.user_token)}&app_id=mac-ios-v2.0`);
        const musixmatchLyricsJson = await musixmatchLyricsResponse.json() as { message?: { body?: { macro_calls?: { 'track.subtitles.get'?: { message?: { body?: { subtitle_list?: Array<{ subtitle?: { subtitle_body?: string } }> } } } } } } };
        if (!musixmatchLyricsResponse.ok || !musixmatchLyricsJson.message?.body?.macro_calls?.['track.subtitles.get']?.message?.body?.subtitle_list?.[0]?.subtitle?.subtitle_body) {
            return { lyrics: null, reason: 'Could not find lyrics from Musixmatch' };
        }

        const musixmatchLyrics = parseLrcLyrics({ duration: context.track.duration_ms / 1000, syncedLyrics: musixmatchLyricsJson.message.body.macro_calls['track.subtitles.get'].message.body.subtitle_list[0].subtitle.subtitle_body });
        if (musixmatchLyrics) {
            //@ts-ignore
            await context.env.LYRICS_CACHE.put(`lyrics:${context.spotifyId}`, JSON.stringify(musixmatchLyrics));
            return { lyrics: musixmatchLyrics };
        }

        return { lyrics: null, reason: 'Could not get lyrics from Musixmatch' };
    }
}

export default MusixmatchProvider;