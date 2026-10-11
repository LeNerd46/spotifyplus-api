import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSpotifyTrack, spotifyIdToGid } from '../src/spotify/metadata';

const spotifyId = '5hQSXkFgbxjZo9uCwd11so';

function setup() {
    const values = new Map<string, string>([
        ['spotify:v2:auth:access-token', JSON.stringify({ token: 'access', expiresAt: Date.now() + 3_600_000 })],
        ['spotify:v2:auth:client-token', JSON.stringify({ token: 'client', expiresAt: Date.now() + 3_600_000 })]
    ]);
    const env = {
        SPOTIFY_DEVICE_ID: '0123456789abcdef0123456789abcdef01234567',
        SPOTIFY_CLIENT: 'test-client',
        SPOTIFY_SECRET: 'test-secret',
        SPOTIFY_CACHE: {
            get: async (key: string) => values.get(key) ?? null,
            put: async (key: string, value: string) => { values.set(key, value); }
        }
    } as unknown as Env;

    return { env, values };
}

test('converts Spotify base62 IDs to 16-byte hexadecimal GIDs', () => {
    assert.equal(spotifyIdToGid(spotifyId), 'adbed6e0bcf24605804ebd0a4164ad2c');
    assert.throws(() => spotifyIdToGid('invalid'));
});

test('fetches authenticated metadata and caches the track and ISRC mapping', async t => {
    const fixture = setup();
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === 'https://accounts.spotify.com/api/token') {
            return new Response(null, { status: 401 });
        }
        requests++;
        assert.equal(String(input), 'https://spclient.wg.spotify.com/metadata/4/track/adbed6e0bcf24605804ebd0a4164ad2c?market=from_token');
        const headers = new Headers(init?.headers);
        assert.equal(headers.get('Authorization'), 'Bearer access');
        assert.equal(headers.get('Client-Token'), 'client');
        return Response.json({
            name: 'False God',
            album: { name: 'Lover' },
            artist: [{ name: 'Taylor Swift' }],
            duration: 200306,
            external_id: [{ type: 'isrc', id: 'USUG11901483' }]
        });
    });

    const expected = {
        name: 'False God',
        album: { name: 'Lover' },
        artists: [{ name: 'Taylor Swift' }],
        duration_ms: 200306,
        external_ids: { isrc: 'USUG11901483' }
    };

    assert.deepEqual(await getSpotifyTrack(fixture.env, spotifyId), expected);
    assert.equal(fixture.values.get(`spotify:isrc:${spotifyId}`), 'USUG11901483');
    assert.deepEqual(await getSpotifyTrack(fixture.env, spotifyId), expected);
    assert.equal(requests, 1);
});

const sdkTrack = {
    name: 'False God', album: { name: 'Lover' }, artists: [{ name: 'Taylor Swift' }],
    duration_ms: 200306, external_ids: { isrc: 'USUG11901483' }
};

test('tries the SDK first and caches successful results without account auth', async t => {
    const { env, values } = setup();
    const requests: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push(url);
        if (url === 'https://accounts.spotify.com/api/token') {
            assert.equal(new Headers(init?.headers).get('Authorization'), `Basic ${btoa('test-client:test-secret')}`);
            return Response.json({ access_token: 'sdk-token', token_type: 'Bearer', expires_in: 3600 });
        }
        assert.equal(url, `https://api.spotify.com/v1/tracks/${spotifyId}`);
        assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer sdk-token');
        return Response.json(sdkTrack);
    });
    assert.deepEqual(await getSpotifyTrack(env, spotifyId), sdkTrack);
    assert.deepEqual(await getSpotifyTrack(env, spotifyId), sdkTrack);
    assert.equal(values.get(`spotify:isrc:${spotifyId}`), sdkTrack.external_ids.isrc);
    assert.equal(requests.length, 2);
});

for (const failure of [400, 401, 403, 404, 429, 500, 'network', 'missing-isrc'] as const) {
    test(`falls back to account auth after SDK failure: ${failure}`, async t => {
        const { env } = setup();
        const requests: string[] = [];
        t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
            const url = String(input);
            requests.push(url);
            if (url === 'https://accounts.spotify.com/api/token') {
                return Response.json({ access_token: 'sdk-token', token_type: 'Bearer', expires_in: 3600 });
            }
            if (url.startsWith('https://api.spotify.com/')) {
                if (failure === 'network') throw new Error('Network unavailable');
                if (failure === 'missing-isrc') return Response.json({ ...sdkTrack, external_ids: {} });
                return Response.json({ error: { status: failure, message: 'SDK failed' } }, { status: failure });
            }
            assert.ok(url.startsWith('https://spclient.wg.spotify.com/metadata/'));
            return Response.json({
                name: sdkTrack.name, album: sdkTrack.album, artist: sdkTrack.artists,
                duration: sdkTrack.duration_ms, external_id: [{ type: 'isrc', id: sdkTrack.external_ids.isrc }]
            });
        });
        assert.deepEqual(await getSpotifyTrack(env, spotifyId), sdkTrack);
        assert.equal(requests.length, 3);
        assert.ok(requests[1]!.startsWith('https://api.spotify.com/'));
        assert.ok(requests[2]!.startsWith('https://spclient.wg.spotify.com/'));
    });
}
