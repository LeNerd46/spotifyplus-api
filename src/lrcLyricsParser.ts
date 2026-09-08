import { LineVocal, Lyrics, SyllableMetadata, SyllableVocalSet } from "./types";

export type LrcLyrics = {
    duration: number;
    plainLyrics?: string | null;
    syncedLyrics?: string | null;
};

export type EnrichedLrcLyrics = {
    duration: number;
    syncedLyrics: string;
};

const timestampRegex = /\[(\d+):([0-5]\d(?:\.\d+)?)\]/g;

const parseTimestamp = (minutes: string, seconds: string) => {
    return Number(minutes) * 60 + Number(seconds);
};

export const parseLrcLyrics = (lyrics: LrcLyrics): Lyrics | null => {
    const lines: { time: number; text: string }[] = [];

    if (typeof lyrics.syncedLyrics === 'string') {
        for (const line of lyrics.syncedLyrics.split(/\r?\n/)) {
            timestampRegex.lastIndex = 0;
            let match: RegExpExecArray | null;
            const times: number[] = [];
            let textStart = 0;

            while ((match = timestampRegex.exec(line)) !== null) {
                const time = Number(match[1]) * 60 + Number(match[2]);
                if (Number.isFinite(time)) times.push(time);
                textStart = timestampRegex.lastIndex;
            }

            const text = line.slice(textStart).trim();
            for (const time of times) lines.push({ time, text });
        }
    }

    lines.sort((a, b) => a.time - b.time);
    const content: LineVocal[] = [];
    const duration = Number.isFinite(lyrics.duration) ? Math.max(0, lyrics.duration) : 0;
    let endTime = duration;

    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]!;
        if (line.text) {
            content.push({
                Type: 'Vocal',
                StartTime: line.time,
                EndTime: Math.max(line.time, endTime),
                Text: line.text,
                OppositeAligned: false
            });
        }

        if (i === 0 || lines[i - 1]!.time !== line.time) endTime = line.time;
    }

    if (content.length > 0) {
        content.reverse();
        return {
            Type: 'Line',
            StartTime: content[0]!.StartTime,
            EndTime: content[content.length - 1]!.EndTime,
            SongWriters: [],
            Content: content
        };
    }

    if (typeof lyrics.plainLyrics !== 'string') return null;
    const plainLines = lyrics.plainLyrics.split(/\r?\n/).map(text => ({ Text: text.trim() })).filter(line => line.Text);
    if (plainLines.length === 0) return null;

    return {
        Type: 'Static',
        SongWriters: [],
        Lines: plainLines
    };
}

export const parseEnrichedLrcLyrics = (lyrics: EnrichedLrcLyrics): Lyrics | null => {
    if (typeof lyrics.syncedLyrics !== 'string') return null;

    const content: SyllableVocalSet[] = [];

    for (const rawLine of lyrics.syncedLyrics.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        timestampRegex.lastIndex = 0;

        const firstTimestamp = timestampRegex.exec(line);
        if (!firstTimestamp) continue;

        const lineStartTime = parseTimestamp(firstTimestamp[1]!, firstTimestamp[2]!);
        if (!Number.isFinite(lineStartTime) || lineStartTime === 0) continue;

        const syllables: SyllableMetadata[] = [];
        let currentStartTime = lineStartTime;
        let textStart = timestampRegex.lastIndex;

        let match: RegExpExecArray | null;

        while ((match = timestampRegex.exec(line)) !== null) {
            const text = line.slice(textStart, match.index);
            const time = parseTimestamp(match[1]!, match[2]!);

            if (time === 0) {
                textStart = timestampRegex.lastIndex;
                continue;
            }

            if (text) {
                const hasTrailingSpace = /\s$/.test(text);
                const syllableText = text.trim();

                if (syllableText) {
                    syllables.push({
                        StartTime: currentStartTime,
                        EndTime: Math.max(currentStartTime, time),
                        Text: syllableText,
                        IsPartOfWord: !hasTrailingSpace
                    });

                    currentStartTime = time;
                }
            }

            textStart = timestampRegex.lastIndex;
        }

        if (syllables.length === 0) continue;

        content.push({
            Type: 'Vocal',
            OppositeAligned: false,
            Lead: {
                StartTime: syllables[0]!.StartTime,
                EndTime: syllables[syllables.length - 1]!.EndTime,
                Syllables: syllables
            },
            Background: []
        });
    }

    if (content.length === 0) return null;

    return {
        Type: 'Syllable',
        StartTime: content[0]!.Lead.StartTime,
        EndTime: content[content.length - 1]!.Lead.EndTime,
        SongWriters: [],
        Content: content
    };
};