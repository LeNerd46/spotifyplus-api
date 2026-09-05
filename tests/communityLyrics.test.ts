import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { separateVocals, validateCommunityLyrics } from '../src/communityLyrics';
import { SubmitLyrics } from '../src/endpoints/submitLyrics';
import { GetLyrics } from '../src/endpoints/getLyrics';
import type { LineSyncedLyrics } from '../src/types';

const source: LineSyncedLyrics = { Type: 'Line', StartTime: 5, EndTime: 10, SongWriters: ['Original writer'], Content: [
    { Type: 'Vocal', Text: "I don't (I don't) know about you (about you)", StartTime: 5, EndTime: 10, OppositeAligned: false },
] };
const vocal = (words: string[], start: number) => ({ StartTime: start, EndTime: start + words.length * .5, Syllables: words.map((Text, i) => ({ Text, StartTime: start + i * .5, EndTime: start + (i + 1) * .5, IsPartOfWord: false })) });
function valid() {
    return { Type: 'Syllable', StartTime: 4, EndTime: 8, SongWriters: ['Spoofed writer'], Content: [
        { Type: 'Vocal', OppositeAligned: false, Lead: vocal(['I', "don't", 'know', 'about', 'you'], 5), Background: [vocal(['I', "don't"], 4), vocal(['about', 'you'], 7)] },
    ] };
}
test('extracts multiple, leading, trailing, nested and backing-only phrases', () => {
    assert.deepEqual(separateVocals(source.Content[0].Text), { lead: "I don't know about you", background: ["I don't", 'about you'] });
    assert.deepEqual(separateVocals('(first) hello (last)'), { lead: 'hello', background: ['first', 'last'] });
    assert.deepEqual(separateVocals('(one (two) three)'), { lead: '', background: ['one two three'] });
    assert.deepEqual(separateVocals('hello (unfinished'), { lead: 'hello', background: ['unfinished'] });
});
test('accepts overlapping backing vocals and preserves trusted writer attribution', () => {
    const result = validateCommunityLyrics(valid(), source);
    assert.equal(result.Community, true); assert.deepEqual(result.SongWriters, ['Original writer']);
});
test('accepts syllable subdivisions while preserving word boundaries', () => {
    const data = valid(), syllables = data.Content[0].Lead.Syllables;
    syllables.splice(3, 1, { Text: 'a', StartTime: 6.5, EndTime: 6.7, IsPartOfWord: true }, { Text: 'bout', StartTime: 6.7, EndTime: 7, IsPartOfWord: false });
    assert.doesNotThrow(() => validateCommunityLyrics(data, source));
    syllables[3].IsPartOfWord = false;
    assert.throws(() => validateCommunityLyrics(data, source));
});
for (const [name, mutate] of Object.entries({
    'changed words': (d: any) => d.Content[0].Lead.Syllables[0].Text = 'Changed',
    'negative time': (d: any) => d.Content[0].Lead.Syllables[0].StartTime = -1,
    'non-finite time': (d: any) => d.Content[0].Lead.Syllables[0].StartTime = Infinity,
    'zero duration': (d: any) => d.Content[0].Lead.Syllables[0].EndTime = 5,
    'overlapping syllables': (d: any) => d.Content[0].Lead.Syllables[1].StartTime = 5.1,
    'wrong bounds': (d: any) => d.Content[0].Lead.EndTime = 10,
    'wrong song bounds': (d: any) => d.StartTime = 0,
    'empty content': (d: any) => d.Content = [],
    'unfinished word': (d: any) => d.Content[0].Lead.Syllables.at(-1).IsPartOfWord = true,
    'unknown fields': (d: any) => d.Script = 'unexpected',
    'huge times': (d: any) => d.Content[0].Lead.Syllables[0].EndTime = 90000,
    'changed alignment': (d: any) => d.Content[0].OppositeAligned = true,
    'interlude overlapping vocals': (d: any) => d.Content.unshift({ Type: 'Interlude', StartTime: 0, EndTime: 6 }),
})) test(`rejects ${name}`, () => { const data = valid(); mutate(data); assert.throws(() => validateCommunityLyrics(data, source)); });

const id = '1234567890123456789012';
test('omits all or some backing phrases and allows omitted backing-only lines', () => {
    const data: any = valid(); delete data.Content[0].Background; data.StartTime = 5; data.EndTime = 7.5;
    assert.doesNotThrow(() => validateCommunityLyrics(data, source));
    data.Content[0].Background = [vocal(['about', 'you'], 7)]; data.EndTime = 8;
    assert.doesNotThrow(() => validateCommunityLyrics(data, source));
    const withBackingOnly = structuredClone(source);
    withBackingOnly.Content.unshift({ Type: 'Vocal', Text: '(optional intro)', StartTime: 1, EndTime: 2, OppositeAligned: false });
    assert.doesNotThrow(() => validateCommunityLyrics(data, withBackingOnly));
    data.Content[0].Background[0].Syllables.pop();
    assert.throws(() => validateCommunityLyrics(data, source));
});
function fixture(initial = source) {
    const entries = new Map<string, string>([[`lyrics:${id}`, JSON.stringify(initial)]]);
    const env = { LYRICS_CACHE: { get: async (key: string) => entries.get(key) ?? null, put: async (key: string, value: string) => { entries.set(key, value); } } };
    const app = new Hono();
    app.get('/api/lyrics/:id', GetLyrics);
    app.post('/api/lyrics/:id', bodyLimit({ maxSize: 512 * 1024 }), SubmitLyrics);
    return { entries, env, app };
}
test('POST replaces cached lines, retains source, and retries remain valid', async () => {
    const { entries, env, app } = fixture();
    for (let retry = 0; retry < 2; retry++) {
        const response = await app.request(`/api/lyrics/${id}`, { method: 'POST', body: JSON.stringify(valid()) }, env);
        assert.equal(response.status, 201); assert.equal((await response.json()).Community, true);
    }
    assert.equal(JSON.parse(entries.get(`lyrics:${id}`)!).Type, 'Syllable');
    assert.equal(JSON.parse(entries.get(`lyrics-source:${id}`)!).Type, 'Line');
    assert.equal(entries.get(`lyrics:${id}`), entries.get(`lyrics-community:${id}`));
});
test('POST invalid requests do not mutate the cache', async () => {
    const { entries, env, app } = fixture(); const before = [...entries];
    for (const body of ['{bad', JSON.stringify({}), JSON.stringify({ ...valid(), EndTime: 99 })]) {
        assert.equal((await app.request(`/api/lyrics/${id}`, { method: 'POST', body }, env)).status, 400);
        assert.deepEqual([...entries], before);
    }
    assert.equal((await app.request('/api/lyrics/bad', { method: 'POST', body: '{}' }, env)).status, 400);
    assert.equal((await app.request(`/api/lyrics/${id}`, { method: 'POST', body: 'x'.repeat(512 * 1024 + 1) }, env)).status, 413);
});
test('POST requires original cached line lyrics', async () => {
    const { entries, env, app } = fixture(); entries.clear();
    assert.equal((await app.request(`/api/lyrics/${id}`, { method: 'POST', body: JSON.stringify(valid()) }, env)).status, 409);
    entries.set(`lyrics:${id}`, JSON.stringify(valid()));
    assert.equal((await app.request(`/api/lyrics/${id}`, { method: 'POST', body: JSON.stringify(valid()) }, env)).status, 409);
});
test('GET prefers community lyrics even if a late provider fetch overwrites the normal cache', async () => {
    const { entries, env, app } = fixture();
    const community = validateCommunityLyrics(valid(), source);
    entries.set(`lyrics-community:${id}`, JSON.stringify(community));
    const response = await app.request(`/api/lyrics/${id}`, undefined, env);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), community);
});
