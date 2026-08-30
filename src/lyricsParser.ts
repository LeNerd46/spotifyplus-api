import { XMLParser } from "fast-xml-parser";
import { LineSyncedLyrics, LineVocal, Lyrics, StaticSyncedLyrics, SyllableMetadata, SyllableSyncedLyrics, SyllableVocal, SyllableVocalSet, TextMetadata } from "./types";

const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: false
});

const whitespaceRegex = /\s/;
const leadingWhitespaceRegex = /^\s/;
const trailingWhitespaceRegex = /\s$/;

type XmlNode = {
    [key: string]: any;
}

type AuxiliaryText = {
    text: string;
    spans?: string[];
}

type ParsedMetadata = {
    songWriters: string[];
    translations: Map<string, AuxiliaryText>;
    romanizations: Map<string, AuxiliaryText>;
}

export const parseLyrics = (ttml: string): Lyrics => {
    const xml = parser.parse(ttml) as XmlNode[];

    const tt = findFirstElement(xml, 'tt');
    if (!tt) throw new Error('Invalid ttml, missing <tt> element');

    const timing = getAttributes(tt)['itunes:timing'] ?? 'None';
    const metadata = parseMetadata(tt);

    const body = findFirstElement(getChildren(tt), 'body');
    if (!body) throw new Error('Invalid ttml: missing <body> element');

    switch (timing.toLowerCase()) {
        case 'word':
            return parseSyllableLyrics(body, metadata);

        case 'line':
            return parseLineLyrics(body, metadata);

        case 'none':
            return parseStaticLyrics(body, metadata);

        default:
            throw new Error(`Unsupported ttml timing mode: ${timing}`)
    }
}

const parseStaticLyrics = (body: XmlNode, metadata: ParsedMetadata): StaticSyncedLyrics => {
    const paragraphs = findElements(getChildren(body), 'p');
    const lines: TextMetadata[] = new Array(paragraphs.length);

    for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i]!;
        const key = getAttributes(paragraph)['itunes:key'];

        const line: TextMetadata = {
            Text: getNodeText(paragraph).trim()
        };

        if (key) {
            const translation = metadata.translations.get(key);
            const romanization = metadata.romanizations.get(key);

            if (translation?.text) line.TranslatedText = translation.text;
            if (romanization?.text) line.RomanizedText = romanization.text;
        }

        lines[i] = line;
    }

    return {
        Type: 'Static',
        SongWriters: metadata.songWriters,
        Lines: lines
    };
}

const parseLineLyrics = (body: XmlNode, metadata: ParsedMetadata): LineSyncedLyrics => {
    const paragraphs = findElements(getChildren(body), 'p');

    if (paragraphs.length === 0) {
        return {
            Type: 'Line',
            StartTime: 0,
            EndTime: parseTime(getAttributes(body).dur),
            SongWriters: metadata.songWriters,
            Content: []
        };
    }

    const content: LineVocal[] = new Array(paragraphs.length);

    let startTime = Infinity;
    let endTime = -Infinity;

    for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i]!;
        const attributes = getAttributes(paragraph);

        const key = attributes['itunes:key'];
        const agent = attributes['ttm:agent'];

        const vocal: LineVocal = {
            Type: 'Vocal',
            StartTime: parseTime(attributes.begin),
            EndTime: parseTime(attributes.end),
            Text: getLeadLineText(paragraph),
            OppositeAligned: isOppositeAligned(agent)
        };

        if (key) {
            const translation = metadata.translations.get(key);
            const romanization = metadata.romanizations.get(key);

            if (translation?.text) vocal.TranslatedText = translation.text;
            if (romanization?.text) vocal.RomanizedText = romanization.text;
        }

        if (vocal.StartTime < startTime) startTime = vocal.StartTime;
        if (vocal.EndTime > endTime) endTime = vocal.EndTime;

        content[i] = vocal;
    }

    return {
        Type: 'Line',
        StartTime: startTime,
        EndTime: endTime,
        SongWriters: metadata.songWriters,
        Content: content
    };
}

const parseSyllableLyrics = (body: XmlNode, metadata: ParsedMetadata): SyllableSyncedLyrics => {
    const paragraphs = findElements(getChildren(body), 'p');

    if (paragraphs.length === 0) {
        return {
            Type: 'Syllable',
            StartTime: 0,
            EndTime: parseTime(getAttributes(body).dur),
            SongWriters: metadata.songWriters,
            Content: []
        };
    }

    const content: SyllableVocalSet[] = [];

    let startTime = Infinity;
    let endTime = -Infinity;

    for (const paragraph of paragraphs) {
        const attributes = getAttributes(paragraph);
        const agent = attributes['ttm:agent'];
        const key = attributes['itunes:key'];

        const children = getChildren(paragraph);

        const leadSyllables = parseTimedSyllables(children);
        if (leadSyllables.length === 0) continue;

        applyAuxiliarySyllableMetadata(leadSyllables, key ? metadata.translations.get(key) : undefined, key ? metadata.romanizations.get(key) : undefined);

        const leadStartTime = parseTime(attributes.begin) || leadSyllables[0]!.StartTime;
        const leadEndTime = parseTime(attributes.end) || leadSyllables[leadSyllables.length - 1]!.EndTime;

        const lead: SyllableVocal = {
            StartTime: leadStartTime,
            EndTime: leadEndTime,
            Syllables: leadSyllables
        };

        const background: SyllableVocal[] = [];

        if (leadStartTime < startTime) startTime = leadStartTime;
        if (leadEndTime > endTime) endTime = leadEndTime;

        for (const child of children) {
            if (!isElement(child, 'span')) continue;

            const childAttributes = getAttributes(child);
            if (childAttributes['ttm:role'] !== 'x-bg') continue;

            const backgroundSyllables = parseTimedSyllables(getChildren(child));
            if (backgroundSyllables.length === 0) continue;

            const backgroundStartTime = parseTime(childAttributes.begin) || backgroundSyllables[0]!.StartTime;
            const backgroundEndTime = parseTime(childAttributes.end) || backgroundSyllables[backgroundSyllables.length - 1]!.EndTime;

            background.push({
                StartTime: backgroundStartTime,
                EndTime: backgroundEndTime,
                Syllables: backgroundSyllables
            });

            if (backgroundEndTime > endTime) endTime = backgroundEndTime;
        }

        const vocalSet: SyllableVocalSet = {
            Type: 'Vocal',
            OppositeAligned: isOppositeAligned(agent),
            Lead: lead
        };

        if (key) {
            const translation = metadata.translations.get(key);
            const romanization = metadata.romanizations.get(key);

            if (translation?.text) vocalSet.TranslatedText = translation.text;
            if (romanization?.text) vocalSet.RomanizedText = romanization.text;
        }

        if (background.length > 0) {
            vocalSet.Background = background;
        }

        content.push(vocalSet);
    }

    if (content.length === 0) {
        return {
            Type: 'Syllable',
            StartTime: 0,
            EndTime: parseTime(getAttributes(body).dur),
            SongWriters: metadata.songWriters,
            Content: []
        };
    }

    return {
        Type: 'Syllable',
        StartTime: startTime,
        EndTime: endTime,
        SongWriters: metadata.songWriters,
        Content: content
    };
}

const parseTimedSyllables = (nodes: XmlNode[]): SyllableMetadata[] => {
    const syllables: SyllableMetadata[] = [];

    let previousSyllable: SyllableMetadata | undefined;
    let previousHasTrailingWhitespace = false;
    let separatorHasWhitespace = false;

    for (const node of nodes) {
        if (node['#text'] !== undefined) {
            if (previousSyllable && !separatorHasWhitespace && whitespaceRegex.test(String(node['#text']))) {
                separatorHasWhitespace = true;
            }

            continue;
        }

        if (!isElement(node, 'span')) continue;

        const attributes = getAttributes(node);
        const role = attributes['ttm:role'];

        if (role === 'x-bg' || role === 'x-translation' || role === 'x-roman') continue;
        if (!attributes.begin || !attributes.end) continue;

        const rawText = getNodeText(node);
        const hasLeadingWhitespace = leadingWhitespaceRegex.test(rawText);

        // A timed span counts as the "next span" even if its text is empty.
        // This preserves the behavior of the previous implementation.
        if (previousSyllable) {
            previousSyllable.IsPartOfWord = !previousHasTrailingWhitespace && !separatorHasWhitespace && !hasLeadingWhitespace;
        }

        previousSyllable = undefined;
        separatorHasWhitespace = false;

        const text = rawText.trim();
        if (!text) continue;

        const syllable: SyllableMetadata = {
            Text: text,
            StartTime: parseTime(attributes.begin),
            EndTime: parseTime(attributes.end),
            IsPartOfWord: false
        };

        syllables.push(syllable);

        previousSyllable = syllable;
        previousHasTrailingWhitespace = trailingWhitespaceRegex.test(rawText);
    }

    return syllables;
}

const applyAuxiliarySyllableMetadata = (syllables: SyllableMetadata[], translation?: AuxiliaryText, romanization?: AuxiliaryText) => {
    if (translation?.spans && translation.spans.length === syllables.length) {
        for (let i = 0; i < syllables.length; i++) {
            syllables[i]!.TranslatedText = translation.spans[i];
        }
    }

    if (romanization?.spans && romanization.spans.length === syllables.length) {
        for (let i = 0; i < syllables.length; i++) {
            syllables[i]!.RomanizedText = romanization.spans[i];
        }
    }
}

const parseMetadata = (tt: XmlNode): ParsedMetadata => {
    const metadata: ParsedMetadata = {
        songWriters: [],
        translations: new Map(),
        romanizations: new Map()
    };

    const iTunesMetadata = findFirstElement(getChildren(tt), 'iTunesMetadata');
    if (!iTunesMetadata) return metadata;

    const metadataChildren = getChildren(iTunesMetadata);

    const songwritersElement = findFirstElement(metadataChildren, 'songwriters');

    if (songwritersElement) {
        const songwriterElements = findElements(getChildren(songwritersElement), 'songwriter');

        for (const songwriter of songwriterElements) {
            const text = getNodeText(songwriter).trim();

            if (text) {
                metadata.songWriters.push(text);
            }
        }
    }

    const translationsElement = findFirstElement(metadataChildren, 'translations');

    if (translationsElement) {
        const translations = findElements(getChildren(translationsElement), 'translation');

        for (const translation of translations) {
            const textElements = findElements(getChildren(translation), 'text');

            for (const textElement of textElements) {
                const key = getAttributes(textElement).for;
                if (!key) continue;

                metadata.translations.set(key, {
                    text: getNodeText(textElement).trim(),
                    spans: parseAuxiliaryTimedSpans(textElement)
                });
            }
        }
    }

    const transliterationsElement = findFirstElement(metadataChildren, 'transliterations');

    if (transliterationsElement) {
        const transliterations = findElements(getChildren(transliterationsElement), 'transliteration');

        for (const transliteration of transliterations) {
            const textElements = findElements(getChildren(transliteration), 'text');

            for (const textElement of textElements) {
                const key = getAttributes(textElement).for;
                if (!key) continue;

                metadata.romanizations.set(key, {
                    text: getNodeText(textElement).trim(),
                    spans: parseAuxiliaryTimedSpans(textElement)
                });
            }
        }
    }

    return metadata;
}

const parseAuxiliaryTimedSpans = (node: XmlNode): string[] | undefined => {
    const spans: string[] = [];

    for (const child of getChildren(node)) {
        if (!isElement(child, 'span')) continue;

        const attributes = getAttributes(child);
        const role = attributes['ttm:role'];

        if (role === 'x-bg' || role === 'x-translation' || role === 'x-roman') continue;
        if (!attributes.begin || !attributes.end) continue;

        const text = getNodeText(child).trim();

        if (text) {
            spans.push(text);
        }
    }

    return spans.length > 0 ? spans : undefined;
}

const getLeadLineText = (paragraph: XmlNode): string => {
    let result = '';

    for (const child of getChildren(paragraph)) {
        if (child['#text'] !== undefined) {
            result += child['#text'];
            continue;
        }

        if (!isElement(child, 'span')) continue;

        const role = getAttributes(child)['ttm:role'];

        if (role === 'x-bg' || role === 'x-translation' || role === 'x-roman') {
            continue;
        }

        result += getNodeText(child);
    }

    return normalizeWhitespace(result);
}

const isOppositeAligned = (agent: string | undefined): boolean => {
    return agent === 'v2';
}

const parseTime = (value?: string): number => {
    if (!value) return 0;

    const trimmed = value.trim();
    const length = trimmed.length;

    if (length >= 2 && trimmed.endsWith('ms')) {
        return Number.parseFloat(trimmed.slice(0, -2)) / 1000;
    }

    if (length >= 1 && trimmed.charCodeAt(length - 1) === 115) {
        return Number.parseFloat(trimmed.slice(0, -1));
    }

    const firstColon = trimmed.indexOf(':');

    if (firstColon === -1) {
        const result = Number(trimmed);

        if (Number.isNaN(result)) {
            throw new Error(`Invalid ttml timestamp: ${value}`);
        }

        return result;
    }

    const secondColon = trimmed.indexOf(':', firstColon + 1);

    if (secondColon === -1) {
        const minutes = Number(trimmed.slice(0, firstColon));
        const seconds = Number(trimmed.slice(firstColon + 1));

        if (Number.isNaN(minutes) || Number.isNaN(seconds)) {
            throw new Error(`Invalid ttml timestamp: ${value}`);
        }

        return minutes * 60 + seconds;
    }

    if (trimmed.indexOf(':', secondColon + 1) !== -1) {
        throw new Error(`Invalid ttml timestamp: ${value}`);
    }

    const hours = Number(trimmed.slice(0, firstColon));
    const minutes = Number(trimmed.slice(firstColon + 1, secondColon));
    const seconds = Number(trimmed.slice(secondColon + 1));

    if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) {
        throw new Error(`Invalid ttml timestamp: ${value}`);
    }

    return hours * 3600 + minutes * 60 + seconds;
}

const getChildren = (node: XmlNode): XmlNode[] => {
    for (const key in node) {
        if (key === ':@' || key === '#text') continue;

        const value = node[key];

        if (Array.isArray(value)) {
            return value;
        }
    }

    return [];
}

const getAttributes = (node: XmlNode): Record<string, string> => {
    return node[':@'] ?? {};
}

const isElement = (node: XmlNode, name: string): boolean => {
    return node[name] !== undefined;
}

const findFirstElement = (nodes: XmlNode[], name: string): XmlNode | undefined => {
    for (const node of nodes) {
        if (isElement(node, name)) {
            return node;
        }

        const children = getChildren(node);

        if (children.length > 0) {
            const child = findFirstElement(children, name);

            if (child) {
                return child;
            }
        }
    }

    return undefined;
}

const findElements = (nodes: XmlNode[], name: string): XmlNode[] => {
    const results: XmlNode[] = [];

    const visit = (children: XmlNode[]) => {
        for (const node of children) {
            if (isElement(node, name)) {
                results.push(node);
            }

            const nestedChildren = getChildren(node);

            if (nestedChildren.length > 0) {
                visit(nestedChildren);
            }
        }
    };

    visit(nodes);

    return results;
}

const getNodeText = (node: XmlNode): string => {
    return getNodesText(getChildren(node));
}

const getNodesText = (nodes: XmlNode[]): string => {
    let result = '';

    for (const node of nodes) {
        if (node['#text'] !== undefined) {
            result += String(node['#text']);
            continue;
        }

        const children = getChildren(node);

        if (children.length > 0) {
            result += getNodesText(children);
        }
    }

    return result;
}

const normalizeWhitespace = (text: string): string => {
    return text.replace(/\s+/g, ' ').trim();
}