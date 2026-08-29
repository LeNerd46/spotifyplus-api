import { XMLParser } from "fast-xml-parser";
import { LineSyncedLyrics, LineVocal, Lyrics, StaticSyncedLyrics, SyllableMetadata, SyllableSyncedLyrics, SyllableVocal, SyllableVocalSet, TextMetadata } from "./types";

const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: false
});

type XmlNode = {
    [key: string]: any;
}

type AuxiliaryText = {
    text: string;
    spans?: SyllableMetadata[];
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

    const ttAttributes = getAttributes(tt);
    const timing = ttAttributes['itunes:timing'] ?? 'None';

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

    const lines: TextMetadata[] = paragraphs.map(paragraph => {
        const attributes = getAttributes(paragraph);
        const key = attributes['itunes:key'];

        const line: TextMetadata = {
            Text: getNodeText(paragraph).trim()
        };

        if (key) {
            const translation = metadata.translations.get(key);
            const romanization = metadata.romanizations.get(key);

            if (translation?.text) line.TranslatedText = translation.text;
            if (romanization?.text) line.RomanizedText = romanization.text;
        }

        return line;
    });

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

    const primaryAgent = getPrimaryAgent(paragraphs);

    const content: LineVocal[] = paragraphs.map(paragraph => {
        const attributes = getAttributes(paragraph);
        const key = attributes['itunes:key'];
        const agent = attributes['ttm:agent'];

        const vocal: LineVocal = {
            Type: 'Vocal',
            StartTime: parseTime(attributes.begin),
            EndTime: parseTime(attributes.end),
            Text: getLeadLineText(paragraph).trim(),
            OppositeAligned: isOppositeAligned(agent, primaryAgent)
        };

        if (key) {
            const translation = metadata.translations.get(key);
            const romanization = metadata.romanizations.get(key);

            if (translation?.text) vocal.TranslatedText = translation.text;
            if (romanization?.text) vocal.RomanizedText = romanization.text;
        }

        return vocal;
    });

    return {
        Type: 'Line',
        StartTime: Math.min(...content.map(x => x.StartTime)),
        EndTime: Math.max(...content.map(x => x.EndTime)),
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

    const primaryAgent = getPrimaryAgent(paragraphs);
    const content: SyllableVocalSet[] = [];

    for (const paragraph of paragraphs) {
        const attributes = getAttributes(paragraph);
        const agent = attributes['ttm:agent'];
        const key = attributes['itunes:key'];

        const children = getChildren(paragraph);

        const leadNodes = children.filter(node => {
            if (!isElement(node, 'span')) return true;

            const spanAttributes = getAttributes(node);
            const role = spanAttributes['ttm:role'];

            return role !== 'x-bg' && role !== 'x-translation' && role !== 'x-roman';
        });

        const leadSyllables = parseTimedSyllables(leadNodes);
        if (leadSyllables.length === 0) continue;

        applyAuxiliarySyllableMetadata(leadSyllables, key ? metadata.translations.get(key) : undefined, key ? metadata.romanizations.get(key) : undefined);

        const lead: SyllableVocal = {
            StartTime: parseTime(attributes.begin) || leadSyllables[0]!.StartTime,
            EndTime: parseTime(attributes.end) || leadSyllables[leadSyllables.length - 1]!.EndTime,
            Syllables: leadSyllables
        };

        const background: SyllableVocal[] = [];

        for (const child of children) {
            if (!isElement(child, 'span')) continue;

            const childAttributes = getAttributes(child);
            if (childAttributes['ttm:role'] !== 'x-bg') continue;

            const backgroundSyllables = parseTimedSyllables(getChildren(child));
            if (backgroundSyllables.length === 0) continue;

            background.push({
                StartTime: parseTime(childAttributes.begin) || backgroundSyllables[0]!.StartTime,
                EndTime: parseTime(childAttributes.end) || backgroundSyllables[backgroundSyllables.length - 1]!.EndTime,
                Syllables: backgroundSyllables
            });
        }

        const vocalSet: SyllableVocalSet = {
            Type: 'Vocal',
            OppositeAligned: isOppositeAligned(agent, primaryAgent),
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
        StartTime: Math.min(...content.map(x => x.Lead.StartTime)),
        EndTime: Math.max(...content.flatMap(x => [x.Lead.EndTime, ...(x.Background?.map(background => background.EndTime) ?? [])])),
        SongWriters: metadata.songWriters,
        Content: content
    };
}

const parseTimedSyllables = (nodes: XmlNode[]): SyllableMetadata[] => {
    const syllables: SyllableMetadata[] = [];

    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!;

        if (!isElement(node, 'span')) continue;

        const attributes = getAttributes(node);
        const role = attributes['ttm:role'];

        if (role === 'x-bg' || role === 'x-translation' || role === 'x-roman') continue;
        if (!attributes.begin || !attributes.end) continue;

        let text = getNodeText(node);

        const hasLeadingWhitespace = /^\s/.test(text);
        const hasTrailingWhitespace = /\s$/.test(text);

        text = text.trim();
        if (!text) continue;

        const nextSpanIndex = findNextTimedSpanIndex(nodes, i + 1);
        let isPartOfWord = false;

        if (nextSpanIndex !== -1 && !hasTrailingWhitespace) {
            const separator = getTextBetween(nodes, i + 1, nextSpanIndex);
            const nextText = getNodeText(nodes[nextSpanIndex]!);
            const nextHasLeadingWhitespace = /^\s/.test(nextText);

            isPartOfWord = !/\s/.test(separator) && !nextHasLeadingWhitespace;
        }

        syllables.push({
            Text: text,
            StartTime: parseTime(attributes.begin),
            EndTime: parseTime(attributes.end),
            IsPartOfWord: isPartOfWord
        });
    }

    return syllables;
}

const findNextTimedSpanIndex = (nodes: XmlNode[], start: number): number => {
    for (let i = start; i < nodes.length; i++) {
        const node = nodes[i]!;

        if (!isElement(node, 'span')) continue;

        const attributes = getAttributes(node);
        const role = attributes['ttm:role'];

        if (role === 'x-bg' || role === 'x-translation' || role === 'x-roman') continue;

        if (attributes.begin && attributes.end) return i;
    }

    return -1;
}

const getTextBetween = (nodes: XmlNode[], start: number, end: number): string => {
    let text = '';

    for (let i = start; i < end; i++) {
        const node = nodes[i]!;

        if (node['#text'] !== undefined) {
            text += String(node['#text']);
        }
    }

    return text;
}

const applyAuxiliarySyllableMetadata = (syllables: SyllableMetadata[], translation?: AuxiliaryText, romanization?: AuxiliaryText) => {
    if (translation?.spans && translation.spans.length === syllables.length) {
        for (let i = 0; i < syllables.length; i++) {
            syllables[i]!.TranslatedText = translation.spans[i]?.Text;
        }
    }

    if (romanization?.spans && romanization.spans.length === syllables.length) {
        for (let i = 0; i < syllables.length; i++) {
            syllables[i]!.RomanizedText = romanization.spans[i]?.Text;
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

    if (!iTunesMetadata) {
        return metadata;
    }

    const songwritersElement = findFirstElement(getChildren(iTunesMetadata), 'songwriters');

    if (songwritersElement) {
        const songwriterElements = findElements(getChildren(songwritersElement), 'songwriter');

        metadata.songWriters = songwriterElements.map(songwriter => getNodeText(songwriter).trim()).filter(Boolean);
    }

    const translationsElement = findFirstElement(getChildren(iTunesMetadata), 'translations');

    if (translationsElement) {
        const translations = findElements(getChildren(translationsElement), 'translation');

        for (const translation of translations) {
            const textElements = findElements(getChildren(translation), 'text');

            for (const textElement of textElements) {
                const attributes = getAttributes(textElement);
                const key = attributes.for;

                console.log('Translation attributes:', attributes);
                console.log('Translation key:', key);
                console.log('Translation text:', getNodeText(textElement).trim());

                if (!key) continue;

                metadata.translations.set(key, {
                    text: getNodeText(textElement).trim(),
                    spans: parseAuxiliaryTimedSpans(textElement)
                });
            }
        }
    }

    const transliterationsElement = findFirstElement(getChildren(iTunesMetadata), 'transliterations');

    if (transliterationsElement) {
        const transliterations = findElements(getChildren(transliterationsElement), 'transliteration');

        for (const transliteration of transliterations) {
            const textElements = findElements(getChildren(transliteration), 'text');

            for (const textElement of textElements) {
                const attributes = getAttributes(textElement);
                const key = attributes.for;

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

const parseAuxiliaryTimedSpans = (node: XmlNode): SyllableMetadata[] | undefined => {
    const spans = parseTimedSyllables(getChildren(node));
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

        const attributes = getAttributes(child);
        const role = attributes['ttm:role'];

        if (role === 'x-bg' || role === 'x-translation' || role === 'x-roman') {
            continue;
        }

        result += getNodeText(child);
    }

    return normalizeWhitespace(result);
}

const getPrimaryAgent = (paragraphs: XmlNode[]): string | undefined => {
    for (const paragraph of paragraphs) {
        const agent = getAttributes(paragraph)['ttm:agent'];

        if (agent) {
            return agent;
        }
    }

    return undefined;
}

const isOppositeAligned = (agent: string | undefined, primaryAgent: string | undefined): boolean => {
    if (!agent || !primaryAgent) return false;
    return agent !== primaryAgent;
}

const parseTime = (value?: string): number => {
    if (!value) return 0;

    const trimmed = value.trim();

    if (trimmed.endsWith('ms')) {
        return Number.parseFloat(trimmed.slice(0, -2)) / 1000;
    }

    if (trimmed.endsWith('s')) {
        return Number.parseFloat(trimmed.slice(0, -1));
    }

    const parts = trimmed.split(':').map(Number);

    if (parts.some(Number.isNaN)) {
        throw new Error(`Invalid ttml timestamp: ${value}`);
    }

    if (parts.length === 1) {
        return parts[0]!;
    }

    if (parts.length === 2) {
        return parts[0]! * 60 + parts[1]!;
    }

    if (parts.length === 3) {
        return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
    }

    throw new Error(`Invalid ttml timestamp: ${value}`);
}

const getChildren = (node: XmlNode): XmlNode[] => {
    for (const [key, value] of Object.entries(node)) {
        if (key === ':@' || key === '#text') continue;

        if (Array.isArray(value)) {
            return value;
        }
    }

    return [];
}

const getAttributes = (node: XmlNode): Record<string, string> => {
    const attributes = node[':@'] ?? {};
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(attributes)) {
        const normalizedKey = key.startsWith('@_') ? key.substring(2) : key;
        result[normalizedKey] = String(value);
    }

    return result;
}

const isElement = (node: XmlNode, name: string): boolean => {
    return Object.prototype.hasOwnProperty.call(node, name);
}

const findFirstElement = (nodes: XmlNode[], name: string): XmlNode | undefined => {
    for (const node of nodes) {
        if (isElement(node, name)) {
            return node;
        }

        const child = findFirstElement(getChildren(node), name);

        if (child) {
            return child;
        }
    }

    return undefined;
}

const findElements = (nodes: XmlNode[], name: string): XmlNode[] => {
    const results: XmlNode[] = [];

    for (const node of nodes) {
        if (isElement(node, name)) {
            results.push(node);
        }

        results.push(...findElements(getChildren(node), name));
    }

    return results;
}

const getNodeText = (node: XmlNode) => {
    let result = '';

    const visit = (nodes: XmlNode[]) => {
        for (const child of nodes) {
            if (child['#text'] !== undefined) {
                result += String(child['#text']);
                continue;
            }

            visit(getChildren(child));
        }
    };

    visit(getChildren(node));

    return result;
}

const normalizeWhitespace = (text: string) => {
    return text.replace(/\s+/g, ' ').trim();
}