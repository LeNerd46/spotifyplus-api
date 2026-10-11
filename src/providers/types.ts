import { Lyrics } from "../types";
import { SpotifyTrack } from "../spotify/metadata";

export type LyricsProviderContext = {
    env: Env;
    spotifyId: string;
    track: SpotifyTrack;
}

export type LyricsProviderResult = {
    lyrics: Lyrics | null;
    reason?: string;
}

export interface LyricsProvider {
    name: string;
    priority: number;

    getLyrics(context: LyricsProviderContext): Promise<LyricsProviderResult>;
}
