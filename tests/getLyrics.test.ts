import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { GetLyrics } from '../src/endpoints/getLyrics';
import { parseLyrics } from '../src/lyricsParser';
import { removeBackgroundParentheses } from '../src/normalizeLyrics';
import type { Lyrics, SyllableSyncedLyrics } from '../src/types';
import AppleMusicProvider from '../src/providers/apple';
import LrclibProvider from '../src/providers/lrclib';
import NeteaseProvider from '../src/providers/netease';
import MusixmatchProvider from '../src/providers/musixmatch';

const id = '1234567890123456789012';
const syllable = (Text: string) => ({ Text, StartTime: 1, EndTime: 2, IsPartOfWord: false });
function fixtureLyrics(): SyllableSyncedLyrics {
    return {
        Type: 'Syllable', StartTime: 1, EndTime: 2, SongWriters: [], Content: [
            { Type: 'Interlude', StartTime: 0, EndTime: 1 },
            { Type: 'Vocal', OppositeAligned: false, Lead: { StartTime: 1, EndTime: 2, Syllables: [syllable('(Lead)')] },
                Background: ['(Oh,|yeah!)', '(Only opening', 'Only closing)', '((Single))', 'Middle (aside) text', ''].map(text => ({
                    StartTime: 1, EndTime: 2, Syllables: text ? text.split('|').map(syllable) : []
                })) }
        ]
    };
}

function setup() {
    const values = new Map<string, string>();
    const writes: string[] = [];
    const pending: Promise<unknown>[] = [];
    const env = {
        LYRICS_CACHE: {
            get: async (key: string) => values.get(key) ?? null,
            put: async (key: string, value: string) => { writes.push(key); values.set(key, value); }
        },
        SPOTIFY_CACHE: {
            get: async () => JSON.stringify({ name: 'Song', album: { name: 'Album' }, artists: [{ name: 'Artist' }], duration_ms: 2000, external_ids: { isrc: 'ISRC' } })
        }
    } as unknown as Env;
    const app = new Hono<{ Bindings: Env }>();
    app.get('/lyrics/:id', GetLyrics);
    return { values, writes, pending, request: () => app.request(`/lyrics/${id}`, {}, env, {
        waitUntil: promise => pending.push(promise), passThroughOnException() {}
    }) };
}

test('removes only backing-vocal boundary parentheses and is idempotent', () => {
    const lyrics = fixtureLyrics();
    assert.equal(removeBackgroundParentheses(lyrics), true);
    const entry = lyrics.Content[1]!;
    assert.equal(entry.Type, 'Vocal');
    if (entry.Type !== 'Vocal') return;
    assert.equal(entry.Lead.Syllables[0]!.Text, '(Lead)');
    assert.deepEqual(entry.Background!.map(v => v.Syllables.map(s => s.Text)), [
        ['Oh,', 'yeah!'], ['Only opening'], ['Only closing'], ['Single'], ['Middle (aside) text'], []
    ]);
    assert.equal(entry.Background![0]!.Syllables[0]!.StartTime, 1);
    assert.equal(removeBackgroundParentheses(lyrics), false);
    for (const other of [{ Type: 'Static', SongWriters: [], Lines: [{ Text: '(Lead)' }] }, { Type: 'Line', StartTime: 0, EndTime: 1, Content: [] }] as Lyrics[]) {
        assert.equal(removeBackgroundParentheses(other), false);
    }
});

test('Apple TTML parsing strips backing-vocal parentheses before provider caching', () => {
    const lyrics = parseLyrics(`<tt itunes:timing="Word"><body><p begin="1s" end="2s"><span begin="1s" end="2s">(Lead)</span><span ttm:role="x-bg"><span begin="1s" end="1.5s">(Oh, </span><span begin="1.5s" end="2s">yeah!)</span></span></p></body></tt>`);
    assert.equal(lyrics.Type, 'Syllable');
    if (lyrics.Type !== 'Syllable') return;
    const entry = lyrics.Content[0]!;
    if (entry.Type !== 'Vocal') return assert.fail('Missing vocals');
    assert.equal(entry.Lead.Syllables[0]!.Text, '(Lead)');
    assert.deepEqual(entry.Background![0]!.Syllables.map(s => s.Text), ['Oh,', 'yeah!']);
});

for (const community of [false, true]) {
    test(`repairs cached ${community ? 'community' : 'provider'} lyrics on read and avoids repeat writes`, async () => {
        const fixture = setup();
        const key = `${community ? 'lyrics-community' : 'lyrics'}:${id}`;
        fixture.values.set(key, JSON.stringify(fixtureLyrics()));
        const expected = fixtureLyrics();
        removeBackgroundParentheses(expected);
        assert.deepEqual(await (await fixture.request()).json(), expected);
        await Promise.all(fixture.pending);
        assert.deepEqual(JSON.parse(fixture.values.get(key)!), expected);
        assert.deepEqual(fixture.writes, [key]);
        await fixture.request();
        assert.deepEqual(fixture.writes, [key]);
    });
}

test('repairs both cache entries while preserving community precedence', async () => {
    const fixture = setup();
    const community = { ...fixtureLyrics(), Community: true };
    fixture.values.set(`lyrics-community:${id}`, JSON.stringify(community));
    fixture.values.set(`lyrics:${id}`, JSON.stringify(fixtureLyrics()));
    removeBackgroundParentheses(community);
    assert.deepEqual(await (await fixture.request()).json(), community);
    await Promise.all(fixture.pending);
    assert.deepEqual(fixture.writes, [`lyrics-community:${id}`, `lyrics:${id}`]);
});

test('normalizes fresh provider results before returning and caching', async t => {
    const fixture = setup();
    t.mock.method(AppleMusicProvider, 'getLyrics', async () => ({ lyrics: fixtureLyrics() }));
    for (const provider of [LrclibProvider, NeteaseProvider, MusixmatchProvider]) {
        t.mock.method(provider, 'getLyrics', async () => ({ lyrics: null }));
    }
    const expected = fixtureLyrics();
    removeBackgroundParentheses(expected);
    assert.deepEqual(await (await fixture.request()).json(), expected);
    await Promise.all(fixture.pending);
    assert.deepEqual(JSON.parse(fixture.values.get(`lyrics:${id}`)!), expected);
});
