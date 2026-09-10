import { Context } from "hono";
import { BlankInput } from "hono/types";
import { SpotifyApi } from "@spotify/web-api-ts-sdk";
import { parseLyrics } from "../lyricsParser";
import { Lyrics } from "../types";
import { LrcLyrics, parseLrcLyrics } from "../lrcLyricsParser";
import { LyricsProvider } from "../providers/types";
import AppleMusicProvider from "../providers/apple";
import LrclibProvider from "../providers/lrclib";
import NeteaseProvider from "../providers/netease";
import MusixmatchProvider from "../providers/musixmatch";

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

        const providers = [
            AppleMusicProvider,
            LrclibProvider,
            NeteaseProvider,
            MusixmatchProvider
        ].sort((a, b) => a.priority - b.priority);

        const providerGroups = Map.groupBy(providers, provider => provider.priority);

        let fallbackLyrics: Lyrics | null = null;

        for (const group of providerGroups.values()) {
            const results = await Promise.all(group.map(async provider => {
                try {
                    const lyrics = await provider.getLyrics({
                        env: c.env,
                        spotifyId,
                        track
                    });

                    return {
                        provider,
                        lyrics
                    }
                } catch (error) {
                    return {
                        provider,
                        lyrics: null
                    }
                }
            }));

            for (const result of results) {
                if (!result.lyrics) continue;

                if (result.lyrics.lyrics?.Type === 'Static') {
                    fallbackLyrics ??= result.lyrics.lyrics;
                    continue;
                }

                await c.env.LYRICS_CACHE.put(`lyrics:${spotifyId}`, JSON.stringify(result.lyrics.lyrics));
                return c.json(result.lyrics);
            }
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
