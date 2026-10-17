import { SpotifyTrack } from './spotify/metadata';

interface MonochromeTrack {
    id?: string;
    trackId?: string;
    title?: string;
    artistNames?: string[];
    artists?: Array<{ name?: string; displayName?: string }>;
    duration?: number;
    isrc?: string;
    playable?: boolean;
}

export class MonochromeError extends Error {
    constructor(message: string, readonly status: 404 | 502 | 503) {
        super(message);
    }
}

function cleanString(value: string): string {
    return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\b(feat|featuring|ft)\.?\s+.*$/i, '').replace(/[([{].*?[)\]}]/g, '').replace(/[^a-z0-9]/g, '').trim();
}

function scoreTrack(candidate: MonochromeTrack, target: SpotifyTrack): number {
    const targetIsrc = target.external_ids.isrc.trim().toLowerCase();
    if (targetIsrc && candidate.isrc?.trim().toLowerCase() === targetIsrc) return 200;

    let score = 0;
    const title = cleanString(target.name);
    const candidateTitle = cleanString(candidate.title ?? '');
    if (title && candidateTitle) {
        if (title === candidateTitle) score += 100;
        else if (title.includes(candidateTitle) || candidateTitle.includes(title)) score += 65;
    }

    const artist = cleanString(target.artists[0]?.name ?? '');
    const artists = candidate.artistNames ?? candidate.artists?.map(item => item.name ?? item.displayName ?? '') ?? [];
    if (artist && artists.map(cleanString).some(name => name && (name === artist || name.includes(artist) || artist.includes(name)))) score += 50;

    const duration = candidate.duration ?? 0;
    const candidateSeconds = Math.round(duration > 1000 ? duration / 1000 : duration);
    const targetSeconds = Math.round(target.duration_ms / 1000);
    if (candidateSeconds > 0 && targetSeconds > 0) {
        const difference = Math.abs(candidateSeconds - targetSeconds);
        if (difference <= 3) score += 25;
        else if (difference <= 7) score += 10;
    }

    return score;
}

async function searchTracks(baseUrl: string, query: string): Promise<MonochromeTrack[]> {
    const url = new URL(`${baseUrl}/search/tracks`);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '6');

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
            if ([502, 503, 504].includes(response.status) && attempt < 2) {
                await response.body?.cancel();
                await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
                continue;
            }
            if (!response.ok) throw new MonochromeError(`Monochrome search failed (HTTP ${response.status})`, 502);

            const data = await response.json() as { tracks?: MonochromeTrack[] };
            if (!Array.isArray(data?.tracks)) throw new MonochromeError('Monochrome returned an invalid search response', 502);
            return data.tracks.filter(track => track && typeof track === 'object');
        } catch (error) {
            if (error instanceof MonochromeError) throw error;
            if (attempt === 2) throw new MonochromeError('Monochrome search is unavailable', 502);
            await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
        }
    }

    throw new MonochromeError('Monochrome search is unavailable', 502);
}

export async function getMonochromeStream(track: SpotifyTrack | string, apiUrl = 'https://tracks.monochrome.st') {
    let baseUrl: string;
    try {
        const url = new URL(apiUrl);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid URL');
        baseUrl = url.toString().replace(/\/+$/, '');
    } catch {
        throw new MonochromeError('MONOCHROME_API_URL is invalid', 503);
    }

    let trackId = typeof track === 'string' ? track : '';
    if (typeof track !== 'string') {
        const candidates = await searchTracks(baseUrl, `${track.artists[0]?.name ?? ''} ${track.name}`.trim());
        let bestScore = 0;
        for (const candidate of candidates) {
            const id = candidate.trackId ?? candidate.id ?? '';
            if (candidate.playable === false || typeof id !== 'string' || !/^\d{17,20}$/.test(id)) continue;
            const score = scoreTrack(candidate, track);
            if (score >= 85 && score > bestScore) {
                trackId = id;
                bestScore = score;
            }
        }
        if (!trackId) throw new MonochromeError('No matching playable track found on Monochrome', 404);
    }

    if (!/^\d{17,20}$/.test(trackId)) throw new MonochromeError('Invalid Monochrome track ID', 404);
    return { trackId, url: `${baseUrl}/track/${trackId}`, provider: 'monochrome', playbackType: 'direct' };
}
