import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ReportLyrics } from '../src/endpoints/reportLyrics';

const trackId = '1234567890123456789012';

function setup(options: { community?: boolean; missing?: boolean; limited?: boolean; webhook?: boolean; storageFails?: boolean } = {}) {
    const values = new Map<string, string>();
    if (!options.missing) values.set(`lyrics-community:${trackId}`, JSON.stringify({ Type: 'Syllable', Community: options.community ?? true }));
    const pending: Promise<unknown>[] = [];
    const env = {
        LYRICS_CACHE: {
            get: async (key: string) => values.get(key) ?? null,
            put: async (key: string, value: string) => {
                if (options.storageFails) throw new Error('Storage unavailable');
                values.set(key, value);
            },
        },
        SUBMIT_RATE_LIMITER: { limit: async () => ({ success: !options.limited }) },
        LYRICS_REPORT_WEBHOOK_URL: options.webhook ? 'https://discord.com/api/webhooks/test/token' : undefined,
    } as unknown as Env;
    const app = new Hono<{ Bindings: Env }>();
    app.onError((error, c) => c.json({ error: 'Internal error' }, 500));
    app.post('/api/lyrics/:id/reports', bodyLimit({ maxSize: 8 * 1024, onError: c => c.json({ error: 'Report payload too large' }, 413) }), ReportLyrics);

    return {
        values, pending,
        reports: () => [...values.entries()].filter(([key]) => key.startsWith('lyrics-report:')).map(([, value]) => JSON.parse(value)),
        request: (body: unknown, id = trackId, raw = false) => app.request(`/api/lyrics/${id}/reports`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' },
            body: raw ? body as string : JSON.stringify(body),
        }, env, { waitUntil: promise => pending.push(promise), passThroughOnException() {} }),
    };
}

test('stores each report without changing lyrics or retaining the client IP', async () => {
    const fixture = setup();
    const original = fixture.values.get(`lyrics-community:${trackId}`);
    const response = await fixture.request({ reason: 'timings', details: '  Chorus starts late  ' });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const body = await response.json() as { id: string; status: string };
    const report = fixture.reports()[0];
    assert.equal(report.id, body.id);
    assert.equal(body.status, 'received');
    assert.equal(report.details, 'Chorus starts late');
    assert.equal(report.trackId, trackId);
    assert.equal(report.notification, 'not_configured');
    assert.match(report.lyricsHash, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(report).includes('192.0.2.1'));
    assert.equal(fixture.values.get(`lyrics-community:${trackId}`), original);
    assert.equal((await fixture.request({ reason: 'lyrics' })).status, 201);
    assert.equal(fixture.reports().length, 2);
});

test('accepts each supported reason and requires details for Other', async () => {
    const fixture = setup();
    for (const reason of ['timings', 'lyrics', 'missing', 'other']) {
        assert.equal((await fixture.request({ reason, details: 'An issue' })).status, 201);
    }
    for (const body of [{ reason: 'other' }, { reason: 'other', details: '   ' }, { reason: 'unknown' }, {}, { reason: 'lyrics', details: 'x'.repeat(1001) }, { reason: 'lyrics', extra: true }, { reason: 'lyrics', details: '\u0000' }]) {
        assert.equal((await fixture.request(body)).status, 400);
    }
    assert.equal(fixture.reports().length, 4);
});

test('rejects malformed JSON, invalid IDs and oversized bodies before writing', async () => {
    const fixture = setup();
    assert.equal((await fixture.request('{', trackId, true)).status, 400);
    assert.equal((await fixture.request({ reason: 'timings' }, 'invalid')).status, 400);
    assert.equal((await fixture.request({ reason: 'timings', details: 'x'.repeat(9000) })).status, 413);
    assert.equal(fixture.reports().length, 0);
});

test('only accepts reports for existing community lyrics', async () => {
    for (const [options, status] of [[{ missing: true }, 404], [{ community: false }, 409]] as const) {
        const fixture = setup(options);
        assert.equal((await fixture.request({ reason: 'timings' })).status, status);
        assert.equal(fixture.reports().length, 0);
    }
});

test('supports community lyrics in the compatibility cache', async () => {
    const fixture = setup({ missing: true });
    fixture.values.set(`lyrics:${trackId}`, JSON.stringify({ Type: 'Syllable', Community: true }));
    assert.equal((await fixture.request({ reason: 'lyrics' })).status, 201);
});

test('rate limits reports without writing or notifying', async () => {
    const fixture = setup({ limited: true, webhook: true });
    const response = await fixture.request({ reason: 'timings' });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '60');
    assert.equal(fixture.reports().length, 0);
    assert.equal(fixture.pending.length, 0);
});

test('stores the report before notifying Discord and disables mentions', async t => {
    const fixture = setup({ webhook: true });
    t.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
        assert.equal(fixture.reports().length, 1);
        assert.equal(url.searchParams.get('wait'), 'true');
        const body = JSON.parse(options.body as string);
        assert.deepEqual(body.allowed_mentions, { parse: [] });
        assert.ok(body.content.includes(trackId));
        assert.ok(body.content.includes('Lyrics are wrong'));
        return new Response(null, { status: 204 });
    });
    assert.equal((await fixture.request({ reason: 'lyrics', details: '@everyone incorrect chorus' })).status, 201);
    await Promise.all(fixture.pending);
    assert.equal(fixture.reports()[0].notification, 'sent');
});

test('notification errors do not lose or reject a stored report', async t => {
    for (const fails of [false, true]) {
        const fixture = setup({ webhook: true });
        const mock = t.mock.method(globalThis, 'fetch', async () => {
            if (fails) throw new Error('Network error');
            return new Response(null, { status: 429 });
        });
        assert.equal((await fixture.request({ reason: 'missing' })).status, 201);
        await Promise.all(fixture.pending);
        assert.equal(fixture.reports()[0].notification, 'failed');
        mock.mock.restore();
    }
});

test('does not acknowledge or notify reports when storage fails', async () => {
    const fixture = setup({ storageFails: true, webhook: true });
    assert.equal((await fixture.request({ reason: 'timings' })).status, 500);
    assert.equal(fixture.reports().length, 0);
    assert.equal(fixture.pending.length, 0);
});
