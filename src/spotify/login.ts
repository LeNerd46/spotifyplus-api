import { getClientToken, handleLogin5Challenges, SPOTIFY_PROTOCOL_VERSION } from './hash';
import { LoginRequest, LoginResponse } from './proto';

export interface LoginResult {
    username: string;
    accessToken: string;
    storedCredential: Uint8Array;
    expiresIn: number;
}

interface LoginOptions {
    username: string;
    password: string;
    deviceId: string;
    clientId: string;
    clientToken?: string;
}

interface StoredLoginOptions {
    username: string;
    storedCredential: Uint8Array;
    deviceId: string;
    clientId: string;
    clientToken?: string;
}

async function login(request: Record<string, unknown>, options: LoginOptions | StoredLoginOptions): Promise<LoginResult> {
    const clientToken = options.clientToken ?? await getClientToken({ deviceId: options.deviceId });
    let currentRequest = request;

    for (let attempt = 0; attempt < 3; attempt++) {
        const message = LoginRequest.create(currentRequest);
        const body = LoginRequest.encode(message).finish();

        const response = await fetch('https://login5.spotify.com/v3/login', {
            method: 'POST',
            headers: {
                'Accept': 'application/x-protobuf',
                'Content-Type': 'application/x-protobuf',
                'client-token': clientToken,
                'User-Agent': `Spotify/${SPOTIFY_PROTOCOL_VERSION} Win32/0 (librespot)`
            },
            body
        });

        if (!response.ok) throw new Error(`Spotify Login5 failed: ${response.status}`);

        const decoded = LoginResponse.decode(new Uint8Array(await response.arrayBuffer()));
        const result = LoginResponse.toObject(decoded, {
            bytes: Uint8Array,
            enums: Number,
            longs: Number
        }) as any;

        if (result.ok) {
            return {
                username: result.ok.username,
                accessToken: result.ok.accessToken,
                storedCredential: result.ok.storedCredential ?? new Uint8Array(),
                expiresIn: result.ok.accessTokenExpiresIn
            };
        }

        if (result.error !== undefined) {
            if (result.error === 4 || result.error === 6) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                continue;
            }

            throw new Error(`Spotify Login5 rejected login: ${result.error}`);
        }

        if (result.challenges) {
            currentRequest = handleLogin5Challenges(currentRequest, result);
            continue;
        }

        throw new Error('Unknown Spotify Login5 response');
    }

    throw new Error('Spotify Login5 failed after 3 attempts');
}

export async function loginWithPassword(options: LoginOptions): Promise<LoginResult> {
    return login({
        clientInfo: {
            clientId: options.clientId,
            deviceId: options.deviceId
        },

        password: {
            id: options.username,
            password: options.password
        }
    }, options);
}

export async function loginWithStoredCredential(options: StoredLoginOptions): Promise<LoginResult> {
    return login({
        clientInfo: {
            clientId: options.clientId,
            deviceId: options.deviceId
        },

        storedCredential: {
            username: options.username,
            data: options.storedCredential
        }
    }, options);
}
