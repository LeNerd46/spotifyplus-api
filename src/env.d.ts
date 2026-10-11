// KV bindings declared in wrangler.jsonc.
interface Env {
    LYRICS_CACHE: KVNamespace;
    APPLE_CACHE: KVNamespace;
    SPOTIFY_CACHE: KVNamespace;
    SPOTIFY_CLIENT?: string;
    SPOTIFY_SECRET?: string;
    SPOTIFY_DEVICE_ID?: string;
    SPOTIFY_USERNAME?: string;
    SPOTIFY_PASSWORD?: string;
    LYRICS_REPORT_WEBHOOK_URL?: string;
}
