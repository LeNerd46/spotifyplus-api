import { createHash } from 'node:crypto';
import { ClientTokenRequest, ClientTokenResponse } from './proto';

const CLIENT_TOKEN_URL = 'https://clienttoken.spotify.com/v1/clienttoken';

export const SPOTIFY_KEYMASTER_CLIENT_ID = '65b708073fc0480ea92a077233ca87bd';
export const SPOTIFY_DESKTOP_VERSION = '1.2.52.442';
export const SPOTIFY_PROTOCOL_VERSION = '124200290';

interface HashCashResult {
    suffix: Uint8Array;
    durationMs: number;
}

function sha1(data: Uint8Array): Uint8Array {
    return new Uint8Array(createHash('sha1').update(data).digest());
}

function concat(...arrays: Uint8Array[]): Uint8Array {
    const length = arrays.reduce((sum, array) => sum + array.length, 0);
    const result = new Uint8Array(length);

    let offset = 0;

    for (const array of arrays) {
        result.set(array, offset);
        offset += array.length;
    }

    return result;
}

function readInt64BE(bytes: Uint8Array): bigint {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getBigInt64(0, false);
}

function writeInt64BE(value: bigint): Uint8Array {
    const result = new Uint8Array(8);
    const view = new DataView(result.buffer);

    view.setBigInt64(0, BigInt.asIntN(64, value), false);

    return result;
}

function trailingZeros64(value: bigint): number {
    let unsigned = BigInt.asUintN(64, value);

    if (unsigned === 0n) return 64;

    let zeros = 0;

    while ((unsigned & 1n) === 0n) {
        zeros++;
        unsigned >>= 1n;
    }

    return zeros;
}

function solveHashCash(
    context: Uint8Array,
    prefix: Uint8Array,
    length: number,
    timeoutMs = 5000
): HashCashResult {
    const started = performance.now();

    const contextHash = sha1(context);

    const target = readInt64BE(contextHash.slice(12, 20));

    let counter = 0n;

    while (performance.now() - started < timeoutMs) {
        const first = writeInt64BE(BigInt.asIntN(64, target + counter));
        const second = writeInt64BE(counter);

        const suffix = concat(first, second);

        const hash = sha1(concat(prefix, suffix));
        const value = readInt64BE(hash.slice(12, 20));

        if (trailingZeros64(value) >= length) {
            return {
                suffix,
                durationMs: performance.now() - started
            };
        }

        counter = BigInt.asIntN(64, counter + 1n);
    }

    throw new Error(`Hashcash challenge could not be solved within ${timeoutMs}ms`);
}

function hexToBytes(hex: string): Uint8Array {
    if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
        throw new Error('Invalid hex string');
    }

    const result = new Uint8Array(hex.length / 2);

    for (let i = 0; i < result.length; i++) {
        result[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }

    return result;
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
}

interface ClientTokenOptions {
    deviceId: string;
    clientId?: string;
    clientVersion?: string;
}

export interface ClientTokenResult {
    token: string;
    expiresIn: number;
    refreshAfter: number;
}

export async function getClientTokenDetails({
    deviceId,
    clientId = SPOTIFY_KEYMASTER_CLIENT_ID,
    clientVersion = SPOTIFY_DESKTOP_VERSION
}: ClientTokenOptions): Promise<ClientTokenResult> {
    const send = async (payload: Record<string, unknown>) => {
        const message = ClientTokenRequest.create(payload);
        const body = ClientTokenRequest.encode(message).finish();

        const response = await fetch(CLIENT_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Accept': 'application/x-protobuf',
                'Content-Type': 'application/x-protobuf',
                'User-Agent': `Spotify/${SPOTIFY_PROTOCOL_VERSION} Win32/0 (librespot)`
            },
            body
        });

        if (!response.ok) {
            throw new Error(
                `Client-token request failed: ${response.status} ${response.statusText}`
            );
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        const decoded = ClientTokenResponse.decode(bytes);

        return ClientTokenResponse.toObject(decoded, {
            bytes: Uint8Array,
            enums: Number,
            longs: Number
        }) as any;
    };

    const initialRequest = {
        requestType: 1,

        clientData: {
            clientVersion,
            clientId,

            connectivitySdkData: {
                deviceId,

                platformSpecificData: {
                    desktopWindows: {
                        osVersion: 10,
                        osBuild: 21370,
                        platformId: 2,
                        unknownValue6: 9,
                        imageFileMachine: 34404,
                        peMachine: 34404,
                        unknownValue10: true
                    }
                }
            }
        }
    };

    let response = await send(initialRequest);

    for (let attempt = 0; attempt < 3; attempt++) {
        if (response.responseType === 1 && response.grantedToken) {
            return {
                token: response.grantedToken.token,
                expiresIn: response.grantedToken.expiresAfterSeconds || 7200,
                refreshAfter: response.grantedToken.refreshAfterSeconds || 3600
            };
        }

        if (response.responseType !== 2 || !response.challenges) {
            throw new Error(
                `Unknown Spotify client-token response type: ${response.responseType}`
            );
        }

        const challenge = response.challenges.challenges?.[0];

        if (!challenge) {
            throw new Error('Spotify returned an empty client-token challenge');
        }

        if (challenge.type !== 3 || !challenge.evaluateHashcashParameters) {
            throw new Error(
                `Unsupported client-token challenge type: ${challenge.type}`
            );
        }

        const parameters = challenge.evaluateHashcashParameters;

        const prefix = hexToBytes(parameters.prefix);

        const { suffix } = solveHashCash(
            new Uint8Array(),
            prefix,
            parameters.length
        );

        response = await send({
            requestType: 2,

            challengeAnswers: {
                state: response.challenges.state,

                answers: [
                    {
                        challengeType: 3,
                        hashCash: {
                            suffix: bytesToHex(suffix)
                        }
                    }
                ]
            }
        });
    }

    throw new Error('Spotify client-token challenge failed after 3 attempts');
}

export async function getClientToken(options: ClientTokenOptions): Promise<string> {
    return (await getClientTokenDetails(options)).token;
}

export function handleLogin5Challenges(loginRequest: any, loginResponse: any): any {
    const challenges = loginResponse.challenges?.challenges;

    if (!challenges?.length) {
        throw new Error('Spotify returned an empty Login5 challenge');
    }

    const solutions: any[] = [];

    for (const challenge of challenges) {
        if (challenge.code) {
            throw new Error(
                'Spotify requested a code challenge, which is not currently supported'
            );
        }

        if (!challenge.hashcash) {
            continue;
        }

        const context = loginResponse.loginContext ?? new Uint8Array();
        const prefix = challenge.hashcash.prefix;
        const length = challenge.hashcash.length;

        const { suffix, durationMs } = solveHashCash(
            context,
            prefix,
            length
        );

        const seconds = Math.floor(durationMs / 1000);
        const nanos = Math.floor(
            (durationMs - seconds * 1000) * 1_000_000
        );

        solutions.push({
            hashcash: {
                suffix,

                duration: {
                    seconds,
                    nanos
                }
            }
        });
    }

    return {
        ...loginRequest,

        loginContext: loginResponse.loginContext,

        challengeSolutions: {
            solutions
        }
    };
}
