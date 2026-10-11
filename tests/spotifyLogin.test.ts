import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loginWithPassword, loginWithStoredCredential } from '../src/spotify/login';
import { getClientTokenDetails } from '../src/spotify/hash';
import { ClientTokenResponse, LoginRequest, LoginResponse } from '../src/spotify/proto';

const options = {
    username: 'account',
    deviceId: '0123456789abcdef0123456789abcdef01234567',
    clientId: 'client-id',
    clientToken: 'client-token'
};

function responseBody(storedCredential = new Uint8Array([4, 5, 6])): Uint8Array {
    return LoginResponse.encode(LoginResponse.create({
        ok: {
            username: 'canonical-account',
            accessToken: 'access-token',
            storedCredential,
            accessTokenExpiresIn: 3600
        }
    })).finish();
}

test('encodes password login and decodes reusable credentials', async t => {
    t.mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
        const decoded = LoginRequest.toObject(LoginRequest.decode(init?.body as Uint8Array), { bytes: Uint8Array }) as any;
        assert.equal(decoded.clientInfo.clientId, 'client-id');
        assert.equal(decoded.clientInfo.deviceId, options.deviceId);
        assert.deepEqual(decoded.password, { id: 'account', password: 'password' });
        return new Response(responseBody());
    });

    const result = await loginWithPassword({ ...options, password: 'password' });
    assert.equal(result.username, 'canonical-account');
    assert.equal(result.accessToken, 'access-token');
    assert.equal(result.expiresIn, 3600);
    assert.deepEqual(result.storedCredential, new Uint8Array([4, 5, 6]));
});

test('encodes a stored-credential refresh', async t => {
    t.mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
        const decoded = LoginRequest.toObject(LoginRequest.decode(init?.body as Uint8Array), { bytes: Uint8Array }) as any;
        assert.equal(decoded.storedCredential.username, 'account');
        assert.deepEqual(Array.from(decoded.storedCredential.data), [1, 2, 3]);
        return new Response(responseBody(new Uint8Array()));
    });

    const result = await loginWithStoredCredential({ ...options, storedCredential: new Uint8Array([1, 2, 3]) });
    assert.equal(result.accessToken, 'access-token');
    assert.equal(result.storedCredential.length, 0);
});

test('uses static codecs for client-token and Login5 hashcash challenges', async t => {
    let clientTokenRequests = 0;
    const clientTokenMock = t.mock.method(globalThis, 'fetch', async () => {
        clientTokenRequests++;
        const body = clientTokenRequests === 1
            ? ClientTokenResponse.encode(ClientTokenResponse.create({
                responseType: 2,
                challenges: {
                    state: 'challenge-state',
                    challenges: [{ type: 3, evaluateHashcashParameters: { prefix: '00', length: 0 } }]
                }
            })).finish()
            : ClientTokenResponse.encode(ClientTokenResponse.create({
                responseType: 1,
                grantedToken: { token: 'client-token-result', expiresAfterSeconds: 7200, refreshAfterSeconds: 3600 }
            })).finish();
        return new Response(body);
    });

    const clientToken = await getClientTokenDetails({ deviceId: options.deviceId });
    assert.equal(clientToken.token, 'client-token-result');
    assert.equal(clientTokenRequests, 2);
    clientTokenMock.mock.restore();

    let loginRequests = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        loginRequests++;
        const body = loginRequests === 1
            ? LoginResponse.encode(LoginResponse.create({
                loginContext: new Uint8Array([9]),
                challenges: { challenges: [{ hashcash: { prefix: new Uint8Array([0]), length: 0 } }] }
            })).finish()
            : responseBody();
        return new Response(body);
    });

    assert.equal((await loginWithPassword({ ...options, password: 'password' })).accessToken, 'access-token');
    assert.equal(loginRequests, 2);
});
