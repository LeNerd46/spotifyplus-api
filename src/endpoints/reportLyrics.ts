import type { Context } from 'hono';
import { z } from 'zod';

const reportSchema = z.object({
    reason: z.enum(['timings', 'lyrics', 'missing', 'other']),
    details: z.string().trim().max(1000).refine(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s), 'Invalid details').default(''),
}).strict().refine(report => report.reason !== 'other' || report.details.length > 0, 'Describe the issue for Other');

const reasonLabels = {
    timings: 'Timings are inaccurate',
    lyrics: 'Lyrics are wrong',
    missing: 'Lyrics are missing',
    other: 'Other',
};

export const ReportLyrics = async (c: Context<{ Bindings: Env }>) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id') ?? '';

    if (!/^[a-zA-Z0-9]{22}$/.test(id)) {
        return c.json({ error: 'Invalid Spotify track ID' }, 400);
    }

    const ip = c.req.header('CF-Connecting-IP');
    if (!ip) {
        return c.json({ error: 'Unable to get IP address' }, 400);
    }

    const limit = await c.env.SUBMIT_RATE_LIMITER.limit({ key: `reports:ip:${ip}` });
    if (!limit.success) {
        c.header('Retry-After', '60');
        return c.json({ error: 'Too many reports. Please try again later' }, 429);
    }

    let input: unknown;
    try {
        input = await c.req.json();
    } catch {
        return c.json({ error: 'Invalid JSON' }, 400);
    }

    const parsed = reportSchema.safeParse(input);
    if (!parsed.success) {
        return c.json({ error: 'Choose a valid reason and provide up to 1000 characters of details. Other requires details' }, 400);
    }

    const cache = c.env.LYRICS_CACHE;
    const lyricsJson = (await cache.get(`lyrics-community:${id}`)) ?? (await cache.get(`lyrics:${id}`));
    if (!lyricsJson) {
        return c.json({ error: 'Community lyrics not found' }, 404);
    }

    const lyrics = JSON.parse(lyricsJson);
    if (lyrics.Type !== 'Syllable' || lyrics.Community !== true) {
        return c.json({ error: 'Only community synced lyrics can be reported' }, 409);
    }

    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lyricsJson));
    const report = {
        id: crypto.randomUUID(),
        trackId: id,
        ...parsed.data,
        createdAt: new Date().toISOString(),
        lyricsHash: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''),
        notification: c.env.LYRICS_REPORT_WEBHOOK_URL ? 'pending' : 'not_configured',
    };
    const key = `lyrics-report:${id}:${report.id}`;
    await cache.put(key, JSON.stringify(report));

    if (c.env.LYRICS_REPORT_WEBHOOK_URL) {
        const webhook = c.env.LYRICS_REPORT_WEBHOOK_URL;
        c.executionCtx.waitUntil((async () => {
            try {
                const url = new URL(webhook);
                url.searchParams.set('wait', 'true');
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: `Community lyrics report: ${report.id}\nhttps://open.spotify.com/track/${id}\nReason: ${reasonLabels[report.reason]}\n${report.details}`,
                        allowed_mentions: { parse: [] },
                    }),
                    signal: AbortSignal.timeout(10000),
                });
                report.notification = response.ok ? 'sent' : 'failed';
                await response.body?.cancel();
            } catch {
                report.notification = 'failed';
            }

            if (report.notification === 'failed') console.error('Lyrics report notification failed:', report.id);
            try {
                await cache.put(key, JSON.stringify(report));
            } catch {
                console.error('Could not update lyrics report notification status:', report.id);
            }
        })());
    }

    return c.json({ id: report.id, status: 'received' }, 201);
};
