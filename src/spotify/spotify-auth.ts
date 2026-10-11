import { getClientTokenDetails, SPOTIFY_KEYMASTER_CLIENT_ID } from './hash';
import { loginWithStoredCredential, type LoginResult } from './login';

const ACCESS_TOKEN_KEY = 'spotify:v2:auth:access-token';
const CLIENT_TOKEN_KEY = 'spotify:v2:auth:client-token';
const STORED_CREDENTIAL_KEY = 'spotify:v2:auth:stored-credential';
const EXPIRY_SKEW_MS = 60_000;

interface CachedToken {
    token: string;
    expiresAt: number;
}

interface StoredCredential {
    username: string;
    data: string;
    clientId: string;
}

let memoryAccessToken: CachedToken | undefined;
let memoryClientToken: CachedToken | undefined;
let accessTokenRefresh: Promise<CachedToken> | undefined;
let clientTokenRefresh: Promise<CachedToken> | undefined;

function isUsable(token: CachedToken | undefined): token is CachedToken {
    return Boolean(token?.token && token.expiresAt - EXPIRY_SKEW_MS > Date.now());
}

async function readJson<T>(kv: KVNamespace, key: string): Promise<T | undefined> {
    const value = await kv.get(key);
    if (!value) return undefined;

    try {
        return JSON.parse(value) as T;
    } catch {
        return undefined;
    }
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function getDeviceId(env: Env): string {
    const deviceId = env.SPOTIFY_DEVICE_ID?.trim();
    if (!deviceId || !/^[a-f0-9]{40}$/i.test(deviceId)) {
        throw new Error('SPOTIFY_DEVICE_ID must be configured as 40 hexadecimal characters');
    }
    return deviceId.toLowerCase();
}

async function storeAccessResult(
    env: Env,
    result: LoginResult,
    previousCredential?: StoredCredential
): Promise<CachedToken> {
    const expiresIn = result.expiresIn > 0 ? result.expiresIn : 3600;
    const token = { token: result.accessToken, expiresAt: Date.now() + expiresIn * 1000 };
    const credential = result.storedCredential.length > 0 ? {
        username: result.username,
        data: bytesToBase64(result.storedCredential),
        clientId: SPOTIFY_KEYMASTER_CLIENT_ID
    } : previousCredential;

    if (!credential) throw new Error('Spotify did not return a reusable stored credential');

    await Promise.all([
        env.SPOTIFY_CACHE.put(ACCESS_TOKEN_KEY, JSON.stringify(token), {
            expirationTtl: Math.max(60, expiresIn)
        }),
        env.SPOTIFY_CACHE.put(STORED_CREDENTIAL_KEY, JSON.stringify(credential))
    ]);

    memoryAccessToken = token;
    return token;
}

async function refreshAccessToken(env: Env): Promise<CachedToken> {
    const deviceId = getDeviceId(env);
    const clientToken = await getSpotifyClientToken(env);

    let stored = await readJson<StoredCredential>(
        env.SPOTIFY_CACHE,
        STORED_CREDENTIAL_KEY
    );

    if (!stored) {
        const username = env.SPOTIFY_USERNAME?.trim();
        const data = env.SPOTIFY_STORED_CREDENTIAL?.trim();

        if (!username || !data) {
            throw new Error(
                'Spotify is not initialized; configure SPOTIFY_USERNAME and SPOTIFY_STORED_CREDENTIAL'
            );
        }

        stored = {
            username,
            data,
            clientId: SPOTIFY_KEYMASTER_CLIENT_ID
        };
    }

    if (stored.clientId !== SPOTIFY_KEYMASTER_CLIENT_ID) {
        throw new Error(
            `Spotify stored credential belongs to unexpected client ID ${stored.clientId}`
        );
    }

    const result = await loginWithStoredCredential({
        username: stored.username,
        storedCredential: base64ToBytes(stored.data),
        deviceId,
        clientId: SPOTIFY_KEYMASTER_CLIENT_ID,
        clientToken
    });

    return storeAccessResult(env, result, stored);
}

export async function getSpotifyAccessToken(env: Env, forceRefresh = false): Promise<string> {
    if (!forceRefresh && isUsable(memoryAccessToken)) return memoryAccessToken.token;

    if (!forceRefresh) {
        const cached = await readJson<CachedToken>(env.SPOTIFY_CACHE, ACCESS_TOKEN_KEY);
        if (isUsable(cached)) {
            memoryAccessToken = cached;
            return cached.token;
        }
    } else {
        memoryAccessToken = undefined;
    }

    accessTokenRefresh ??= refreshAccessToken(env).finally(() => {
        accessTokenRefresh = undefined;
    });
    return (await accessTokenRefresh).token;
}

export async function getSpotifyClientToken(env: Env, forceRefresh = false): Promise<string> {
    if (!forceRefresh && isUsable(memoryClientToken)) return memoryClientToken.token;

    if (!forceRefresh) {
        const cached = await readJson<CachedToken>(env.SPOTIFY_CACHE, CLIENT_TOKEN_KEY);
        if (isUsable(cached)) {
            memoryClientToken = cached;
            return cached.token;
        }
    } else {
        memoryClientToken = undefined;
    }

    clientTokenRefresh ??= (async () => {
        const result = await getClientTokenDetails({ deviceId: getDeviceId(env) });
        const refreshAfter = result.refreshAfter > 0 ? result.refreshAfter : 3600;
        const token = { token: result.token, expiresAt: Date.now() + refreshAfter * 1000 };
        await env.SPOTIFY_CACHE.put(CLIENT_TOKEN_KEY, JSON.stringify(token), {
            expirationTtl: Math.max(60, result.expiresIn || refreshAfter)
        });
        memoryClientToken = token;
        return token;
    })().finally(() => {
        clientTokenRefresh = undefined;
    });

    return (await clientTokenRefresh).token;
}

export async function getSpotifyAuthHeaders(env: Env, forceRefresh = false): Promise<Headers> {
    const [accessToken, clientToken] = await Promise.all([
        getSpotifyAccessToken(env, forceRefresh),
        getSpotifyClientToken(env)
    ]);

    return new Headers({
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Client-Token': clientToken
    });
}
