import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLrcLyrics } from '../src/lrcLyricsParser';

test('converts synced lyrics to seconds and uses empty timestamps as vocal endings', () => {
    const lyrics = parseLrcLyrics({
        duration: 233,
        plainLyrics: 'Plain fallback',
        syncedLyrics: '[00:17.12] I feel your breath upon my neck\r\n[03:20.31] The clock won\'t stop\r\n[03:25.72] '
    });
    assert.deepEqual(lyrics, {
        Type: 'Line', StartTime: 17.12, EndTime: 205.72, SongWriters: [],
        Content: [
            { Type: 'Vocal', StartTime: 17.12, EndTime: 200.31, Text: 'I feel your breath upon my neck', OppositeAligned: false },
            { Type: 'Vocal', StartTime: 200.31, EndTime: 205.72, Text: 'The clock won\'t stop', OppositeAligned: false }
        ]
    });
});

test('sorts repeated timestamps and ends the final line at the song duration', () => {
    const lyrics = parseLrcLyrics({ duration: 40, syncedLyrics: '[ar:Artist]\n[00:20][00:10.123] Chorus\n[00:20] Harmony' });
    assert.equal(lyrics?.Type, 'Line');
    if (lyrics?.Type !== 'Line') return;
    assert.deepEqual(lyrics.Content.map(line => [line.StartTime, line.EndTime]), [[10.123, 20], [20, 40], [20, 40]]);
});

test('falls back to plain lyrics when synced lyrics have no usable vocals', () => {
    assert.deepEqual(parseLrcLyrics({ duration: 20, syncedLyrics: '[00:99] Invalid\n[00:10]', plainLyrics: ' First\r\n\r\nSecond\n' }), {
        Type: 'Static', SongWriters: [], Lines: [{ Text: 'First' }, { Text: 'Second' }]
    });
    assert.equal(parseLrcLyrics({ duration: 20, syncedLyrics: null, plainLyrics: null }), null);
    assert.equal(parseLrcLyrics({ duration: 20, plainLyrics: ' \n' }), null);
});
