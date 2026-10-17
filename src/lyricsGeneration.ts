import { AwsClient } from "aws4fetch";
import { Lyrics } from "./types";

export const AUDIO_BUCKET_NAME = "spotifyplus-generated-lyric-audio";

export const AUDIO_DOWNLOAD_EXPIRATION_SECONDS = 10 * 60;
export const GENERATION_STATE_EXPIRATION_SECONDS = 24 * 60 * 60;

// Anything still "processing" after this long was killed mid-run, so a new generation is allowed
export const GENERATION_STALE_MS = 10 * 60 * 1000;
export const MODAL_TIMEOUT_MS = 5 * 60 * 1000;

export const MAX_STEM_BYTES = 32 * 1024 * 1024;
export const MAX_GENERATION_BODY_BYTES = 2 * MAX_STEM_BYTES + 64 * 1024;

export const GENERATION_STATE_PREFIX = "lyrics-generation:";

export type StemName = 'vocals' | 'instrumental';
export const STEM_NAMES: StemName[] = ['vocals', 'instrumental'];

export type LyricsGenerationStatus = 'processing' | 'complete' | 'failed';

export type LyricsGenerationState = {
    SpotifyId: string;
    GenerationId: string;
    CreatedAt: number;
    UpdatedAt: number;
    Status: LyricsGenerationStatus;
    Error?: string;
};

const getR2Client = (env: Env) => {
    return new AwsClient({
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY
    });
};

const getR2BaseUrl = (env: Env) => {
    return `https://7594044bf753b77e68e7e27c52d91f4b.r2.cloudflarestorage.com`;
};

const signR2Request = async (env: Env, bucketName: string, key: string, method: "GET" | "PUT", expires: number, contentType?: string) => {
    const client = getR2Client(env);

    const url = new URL(`${getR2BaseUrl(env)}/${bucketName}/${key}`);
    url.searchParams.set("X-Amz-Expires", expires.toString());

    const headers = new Headers();

    if (contentType) {
        headers.set("Content-Type", contentType);
    }

    const request = new Request(url, { method, headers });
    const signed = await client.sign(request, { aws: { signQuery: true } });

    return signed.url;
};

export const createAudioDownloadUrl = async (env: Env, key: string) => {
    return signR2Request(env, AUDIO_BUCKET_NAME, key, "GET", AUDIO_DOWNLOAD_EXPIRATION_SECONDS);
};

export const stemKey = (spotifyId: string, generationId: string, stem: StemName) => {
    return `generations/${spotifyId}/${generationId}/${stem}`;
};

export const generationStateKey = (spotifyId: string) => {
    return `${GENERATION_STATE_PREFIX}${spotifyId}`;
};

export const getGenerationState = async (env: { LYRICS_CACHE: KVNamespace }, spotifyId: string) => {
    const stateJson = await env.LYRICS_CACHE.get(generationStateKey(spotifyId));
    return stateJson ? JSON.parse(stateJson) as LyricsGenerationState : null;
};

export const saveGenerationState = async (env: { LYRICS_CACHE: KVNamespace }, state: LyricsGenerationState) => {
    await env.LYRICS_CACHE.put(
        generationStateKey(state.SpotifyId),
        JSON.stringify(state),
        { expirationTtl: GENERATION_STATE_EXPIRATION_SECONDS }
    );
};

export const isGenerationRunning = (state: LyricsGenerationState | null) => {
    return state?.Status === 'processing' && Date.now() - state.UpdatedAt < GENERATION_STALE_MS;
};

export const generatedTtmlKey = (spotifyId: string) => {
    return `lyrics/${spotifyId}.ttml`;
};

export const generatedJsonKey = (spotifyId: string) => {
    return `lyrics/${spotifyId}.json`;
};

const escapeXml = (value: string) => {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
};

const formatTime = (seconds: number) => {
    return `${Math.max(0, seconds).toFixed(3)}s`;
};

// Turns line or static lyrics back into TTML so the aligner knows which words to look for
export const lyricsToTtml = (lyrics: Exclude<Lyrics, { Type: 'Syllable' }>) => {
    const timing = lyrics.Type === 'Line' ? 'Line' : 'None';
    const songWriters = lyrics.SongWriters ?? [];

    const paragraphs = lyrics.Type === 'Line'
        ? lyrics.Content.flatMap(vocal => vocal.Type === 'Vocal'
            ? [`<p begin="${formatTime(vocal.StartTime)}" end="${formatTime(vocal.EndTime)}" ttm:agent="${vocal.OppositeAligned ? 'v2' : 'v1'}">${escapeXml(vocal.Text)}</p>`]
            : [])
        : lyrics.Lines.map(line => `<p>${escapeXml(line.Text)}</p>`);

    const head = songWriters.length > 0
        ? `<head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><songwriters>${songWriters.map(writer => `<songwriter>${escapeXml(writer)}</songwriter>`).join('')}</songwriters></iTunesMetadata></metadata></head>`
        : '';

    return `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="${timing}">${head}<body><div>${paragraphs.join('')}</div></body></tt>`;
};
