import { AwsClient } from "aws4fetch";

export const AUDIO_CONTENT_TYPE = "audio/mpeg";

export const AUDIO_UPLOAD_EXPIRATION_SECONDS = 10 * 60;
export const AUDIO_DOWNLOAD_EXPIRATION_SECONDS = 10 * 60;
export const GENERATION_STATE_EXPIRATION_SECONDS = 24 * 60 * 60;

export const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

export const GENERATION_STATE_PREFIX = "lyrics-generation:";
export const GENERATION_SOURCE_PREFIX = "lyrics-generation-source:";

export type LyricsGenerationStatus = 'awaiting_upload' | 'processing' | 'complete' | 'failed';

export type LyricsGenerationState = {
    SpotifyId: string;
    GenerationId: string;
    AudioKey: string;
    CreatedAt: number;
    UpdatedAt: number;
    Status: LyricsGenerationStatus;
    Error?: string;
};

const getR2Client = (env: Env) => {
    return new AwsClient({
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!
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

export const createAudioUploadUrl = async (env: Env, key: string) => {
    return signR2Request(env, 'spotifyplus-generated-lyric-audio', key, "PUT", AUDIO_UPLOAD_EXPIRATION_SECONDS, AUDIO_CONTENT_TYPE);
};

export const createAudioDownloadUrl = async (env: Env, key: string) => {
    return signR2Request(env, 'spotifyplus-generated-lyric-audio', key, "GET", AUDIO_DOWNLOAD_EXPIRATION_SECONDS);
};

export const generationStateKey = (generationId: string) => {
    return `${GENERATION_STATE_PREFIX}${generationId}`;
};

export const saveGenerationState = async (env: { LYRICS_CACHE: KVNamespace }, state: LyricsGenerationState) => {
    await env.LYRICS_CACHE.put(
        generationStateKey(state.GenerationId),
        JSON.stringify(state),
        { expirationTtl: GENERATION_STATE_EXPIRATION_SECONDS }
    );
};

export const generationSourceKey = (spotifyId: string) => {
    return `${GENERATION_SOURCE_PREFIX}${spotifyId}`;
};

export const generatedTtmlKey = (spotifyId: string) => {
    return `lyrics/${spotifyId}.ttml`;
};

export const generatedJsonKey = (spotifyId: string) => {
    return `lyrics/${spotifyId}.json`;
};
