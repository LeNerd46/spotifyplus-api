import { Track } from "@spotify/web-api-ts-sdk";
import { Env } from "hono"
import { Lyrics } from "../types";

export type LyricsProviderContext = {
    env: Env;
    spotifyId: string;
    track: Track;
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