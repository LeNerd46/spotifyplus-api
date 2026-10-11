import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import { getSpotifyAuthHeaders } from './spotify-auth';

const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const sdkClients = new WeakMap<Env, SpotifyApi>();

function getSdk(env: Env): SpotifyApi {
    let sdk = sdkClients.get(env);
    if (!sdk) {
        const client = env.SPOTIFY_CLIENT ?? process.env.SPOTIFY_CLIENT;
        const secret = env.SPOTIFY_SECRET ?? process.env.SPOTIFY_SECRET;
        if (!client || !secret) throw new Error('Spotify SDK credentials are not configured');
        sdk = SpotifyApi.withClientCredentials(client, secret);
        sdkClients.set(env, sdk);
    }
    return sdk;
}

export interface SpotifyTrack {
    name: string;
    artists: Array<{ name: string }>;
    album: { name: string };
    duration_ms: number;
    external_ids: { isrc: string };
}

interface SpotifyMetadataResponse {
    name?: string;
    duration?: number;
    artist?: Array<{ name?: string }>;
    album?: { name?: string };
    external_id?: Array<{ type?: string; id?: string }>;
}

export class SpotifyMetadataError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

export function spotifyIdToGid(id: string): string {
    if (!/^[a-zA-Z0-9]{22}$/.test(id)) throw new SpotifyMetadataError('Invalid Spotify track ID', 400);

    let value = 0n;
    for (const character of id) {
        value = value * 62n + BigInt(BASE62.indexOf(character));
    }

    return value.toString(16).padStart(32, '0');
}

function isCachedTrack(value: unknown): value is SpotifyTrack {
    const track = value as SpotifyTrack | undefined;
    return Boolean(
        track?.name && track.album?.name && Number.isFinite(track.duration_ms) &&
        track.external_ids?.isrc && Array.isArray(track.artists)
    );
}

async function requestMetadata(env: Env, spotifyId: string, forceRefresh = false): Promise<Response> {
    return fetch(
        `https://spclient.wg.spotify.com/metadata/4/track/${spotifyIdToGid(spotifyId)}?market=from_token`,
        { headers: await getSpotifyAuthHeaders(env, forceRefresh) }
    );
}

export async function getSpotifyTrack(env: Env, spotifyId: string): Promise<SpotifyTrack> {
    spotifyIdToGid(spotifyId);
    const cacheKey = `spotify:track:${spotifyId}`;
    const cached = await env.SPOTIFY_CACHE.get(cacheKey);

    if (cached) {
        try {
            const track = JSON.parse(cached);
            if (isCachedTrack(track)) return track;
        } catch {
            // Ignore corrupt cache entries and replace them from Spotify.
        }
    }

    let sdkTrack: SpotifyTrack | undefined;
    try {
        const result = await getSdk(env).tracks.get(spotifyId);
        if (!isCachedTrack(result)) throw new Error('Spotify SDK returned incomplete track metadata');
        sdkTrack = {
            name: result.name,
            artists: result.artists.map(artist => ({ name: artist.name })),
            album: { name: result.album.name },
            duration_ms: result.duration_ms,
            external_ids: { isrc: result.external_ids.isrc! }
        };
    } catch {
        // Any SDK failure (including 4xx responses) falls back to account auth.
    }

    const track = sdkTrack ?? await getAuthenticatedTrack(env, spotifyId);
    await Promise.all([
        env.SPOTIFY_CACHE.put(cacheKey, JSON.stringify(track)),
        env.SPOTIFY_CACHE.put(`spotify:isrc:${spotifyId}`, track.external_ids.isrc)
    ]);
    return track;
}

async function getAuthenticatedTrack(env: Env, spotifyId: string): Promise<SpotifyTrack> {
    let response = await requestMetadata(env, spotifyId);
    if (response.status === 401) response = await requestMetadata(env, spotifyId, true);

    if (!response.ok) {
        const status = response.status === 404 ? 404 : 502;
        throw new SpotifyMetadataError(`Spotify metadata request failed with ${response.status}`, status);
    }

    const metadata = await response.json() as SpotifyMetadataResponse;
    const isrc = metadata.external_id?.find(identifier => identifier.type?.toLowerCase() === 'isrc')?.id;

    if (!isrc) throw new SpotifyMetadataError('Spotify metadata did not contain an ISRC', 404);
    if (!metadata.name || !metadata.album?.name || !Number.isFinite(metadata.duration)) {
        throw new SpotifyMetadataError('Spotify returned incomplete track metadata', 502);
    }

    const track: SpotifyTrack = {
        name: metadata.name,
        artists: (metadata.artist ?? []).flatMap(artist => artist.name ? [{ name: artist.name }] : []),
        album: { name: metadata.album.name },
        duration_ms: metadata.duration!,
        external_ids: { isrc }
    };

    return track;
}
