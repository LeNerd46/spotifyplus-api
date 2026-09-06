import { z } from 'zod';
import type { LineSyncedLyrics, SyllableSyncedLyrics } from './types';

const time = z.number().finite().min(0).max(86400);
const text = z.string().trim().min(1).max(500).refine(s => !/[\u0000-\u001f\u007f]/u.test(s), 'Invalid text');
const syllable = z.object({ Text: text, RomanizedText: text.optional(), TranslatedText: text.optional(), StartTime: time, EndTime: time, IsPartOfWord: z.boolean() }).strict();
const vocal = z.object({ StartTime: time, EndTime: time, Syllables: z.array(syllable).max(2000) }).strict();
const interlude = z.object({ Type: z.literal('Interlude'), StartTime: time, EndTime: time }).strict();
const group = z.object({ Type: z.literal('Vocal'), OppositeAligned: z.boolean(), RomanizedText: text.optional(), TranslatedText: text.optional(), Lead: vocal, Background: z.array(vocal).max(100).optional() }).strict();
export const communitySchema = z.object({
    Type: z.literal('Syllable'), StartTime: time, EndTime: time,
    SongWriters: z.array(text).max(100).optional(), Community: z.boolean().optional(),
    Content: z.array(z.union([group, interlude])).min(1).max(2000),
}).strict();

// Keep each parenthetical phrase, including nested parentheses, in source order.
export function separateVocals(input: string): { lead: string; background: string[] } {
    let lead = '', phrase = '', depth = 0;
    const background: string[] = [];
    for (const char of input) {
        if (char === '(') { if (depth++ === 0) { lead += ' '; phrase = ''; } continue; }
        if (char === ')' && depth > 0) {
            if (--depth === 0 && phrase.trim()) background.push(normalize(phrase));
            continue;
        }
        if (depth > 0) phrase += char; else lead += char;
    }
    // An unclosed parenthesis still represents a backing phrase.
    if (depth > 0 && phrase.trim()) background.push(normalize(phrase));
    return { lead: normalize(lead), background };
}
const normalize = (s: string) => s.replace(/\s+/gu, ' ').trim();
const fail = (message: string): never => { throw new Error(message); };

export function validateCommunityLyrics(input: unknown, source: LineSyncedLyrics): SyllableSyncedLyrics {
    const parsed = communitySchema.safeParse(input);
    if (!parsed.success) fail('Invalid syllable lyrics structure');
    const result = parsed.data!;
    const sourceLines = source.Content.filter(line => line.Type === 'Vocal');
    const groups = result.Content.filter(line => line.Type === 'Vocal');
    if (!groups.length) fail('At least one synced vocal is required');
    const limit = Math.min(86400, source.EndTime + 30);
    if (result.EndTime > limit || result.EndTime <= result.StartTime) fail('Invalid song timing bounds');
    let total = 0;
    function checkVocal(v: z.infer<typeof vocal>, expected: string, allowEmpty = false) {
        if (!v.Syllables.length) {
            if (!allowEmpty || expected || v.StartTime !== v.EndTime) fail('Missing vocal timings');
            return;
        }
        let reconstructed = '', previousEnd = -1;
        for (const s of v.Syllables) {
            if (++total > 20000) fail('Too many syllables');
            if (s.StartTime < previousEnd || s.EndTime <= s.StartTime || s.EndTime > limit) fail('Invalid or overlapping syllable timings');
            if (/\s/u.test(s.Text)) fail('Each syllable must contain only one word or word fragment');
            previousEnd = s.EndTime;
            reconstructed += s.Text + (s.IsPartOfWord ? '' : ' ');
        }
        if (v.Syllables.at(-1)!.IsPartOfWord || normalize(reconstructed) !== expected) fail('Lyrics text must match the original song');
        if (v.StartTime !== v.Syllables[0]!.StartTime || v.EndTime !== v.Syllables.at(-1)!.EndTime) fail('Vocal bounds must match syllables');
    }
    const reconstruct = (v: z.infer<typeof vocal>) => normalize(v.Syllables.map(s => s.Text + (s.IsPartOfWord ? '' : ' ')).join(''));
    const matchesBackground = (given: string[], expected: string[]) => {
        let cursor = 0;
        return given.every(s => { const at = expected.indexOf(s, cursor); cursor = at + 1; return at >= 0; });
    };
    let sourceIndex = 0;
    groups.forEach(g => {
        const leadText = reconstruct(g.Lead);
        const backingText = (g.Background ?? []).map(reconstruct);
        let original = sourceLines[sourceIndex];
        // Entirely parenthetical lines may be omitted when none of their vocals were synced.
        while (original) {
            const candidate = separateVocals(original.Text);
            if (candidate.lead === leadText && matchesBackground(backingText, candidate.background)) break;
            if (candidate.lead) fail('All original lead lines must be included in order');
            original = sourceLines[++sourceIndex];
        }
        if (!original) fail('Lyrics text must match the original song');
        sourceIndex++;
        const parts = separateVocals(original!.Text);
        if (g.OppositeAligned !== original!.OppositeAligned) fail('Line alignment must match the source');
        checkVocal(g.Lead, parts.lead, true);
        let backgroundIndex = 0;
        g.Background?.forEach(v => {
            const at = parts.background.indexOf(reconstruct(v), backgroundIndex);
            if (at < 0) fail('Backing vocals must match an original phrase in order');
            checkVocal(v, parts.background[at]!); backgroundIndex = at + 1;
        });
        if (!g.Lead.Syllables.length && !g.Background?.length) fail('Empty vocal line');
    });
    if (sourceLines.slice(sourceIndex).some(line => separateVocals(line.Text).lead)) fail('All original lead lines must be included');
    let previousStart = -1, previousInterludeEnd = -1;
    const intervals = groups.flatMap(g => [g.Lead, ...(g.Background ?? [])]).filter(v => v.Syllables.length);
    for (const entry of result.Content) {
        const start = entry.Type === 'Interlude' ? entry.StartTime : Math.min(...[entry.Lead, ...(entry.Background ?? [])].filter(v => v.Syllables.length).map(v => v.StartTime));
        if (start < previousStart) fail('Content must be in playback order');
        previousStart = start;
        if (entry.Type === 'Interlude' && (entry.EndTime <= entry.StartTime || entry.EndTime > limit || intervals.some(v => entry.StartTime < v.EndTime && entry.EndTime > v.StartTime))) fail('Interludes must not overlap vocals');
        if (entry.Type === 'Interlude') {
            if (entry.StartTime < previousInterludeEnd) fail('Interludes must not overlap each other');
            previousInterludeEnd = entry.EndTime;
        }
    }
    const starts = result.Content.map(e => e.Type === 'Interlude' ? e.StartTime : Math.min(...[e.Lead, ...(e.Background ?? [])].filter(v => v.Syllables.length).map(v => v.StartTime)));
    const ends = result.Content.map(e => e.Type === 'Interlude' ? e.EndTime : Math.max(e.Lead.EndTime, ...(e.Background ?? []).map(v => v.EndTime)));
    if (result.StartTime !== Math.min(...starts) || result.EndTime !== Math.max(...ends)) fail('Song bounds must match content');
    return { ...result, SongWriters: source.SongWriters ?? [], Community: true };
}
