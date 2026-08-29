import { Context } from "hono";
import { BlankInput } from "hono/types";
import { getAppleMusicToken } from "../appleMusicToken";
import { SpotifyApi } from "@spotify/web-api-ts-sdk";

const sdk = SpotifyApi.withClientCredentials(process.env.SPOTIFY_CLIENT!, process.env.SPOTIFY_SECRET!)

export const GetLyrics = async (c: Context<any, any, BlankInput>) => {
    const id = c.req.param('id');

    try {
        const spotifyId = c.req.param('id');
        if (!spotifyId) return c.json({
            error: 'No ID provided'
        }, 400);

        const track = await sdk.tracks.get(spotifyId);
        if (!track.external_ids.isrc) return c.json({
            error: 'Could not get ISRC'
        }, 404);

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

        const appleJson = await appleResponse.json();
        //@ts-ignore
        const { id } = appleJson.data.filter(x => x.type === 'songs')[0];

        const response = await fetch(`https://amp-api.music.apple.com/v1/catalog/us/songs/${id}/syllable-lyrics?l[lyrics]=en-US&l[script]=en-Latn&extend=ttmlLocalizations`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                Origin: 'https://music.apple.com',
                'Media-User-Token': mediaToken
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                await c.env.APPLE_CACHE.delete('apple-developer-token');

                return c.json({
                    error: 'Apple Music token expired'
                }, 401);
            }

            return c.json({
                error: 'Failed to get lyrics'
            }, 500);
        }

        const json = await response.json();

        return c.json(json);
    } catch (error) {
        console.error('Failed to get Apple Music token:', error);

        return c.json({
            error: 'Failed to get Apple Music token'
        }, 500);
    }
};