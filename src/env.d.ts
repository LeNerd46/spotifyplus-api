// KV and R2 bindings declared in wrangler.jsonc.
interface Env {
    MONOCHROME_API_URL?: string;
    LYRICS_CACHE: KVNamespace;
    APPLE_CACHE: KVNamespace;
    SPOTIFY_CACHE: KVNamespace;
    AUDIO_BUCKET: R2Bucket;
    LYRICS_BUCKET: R2Bucket;
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    MODAL_URL: string;
    MODAL_KEY: string;
    MODAL_SECRET: string;
    SPOTIFY_CLIENT?: string;
    SPOTIFY_SECRET?: string;
    SPOTIFY_DEVICE_ID?: string;
    SPOTIFY_USERNAME?: string;
    SPOTIFY_PASSWORD?: string;
    LYRICS_REPORT_WEBHOOK_URL?: string;
}
