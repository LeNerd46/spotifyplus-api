// KV bindings declared in wrangler.jsonc.
interface Env {
    LYRICS_CACHE: KVNamespace;
    APPLE_CACHE: KVNamespace;
    LYRICS_REPORT_WEBHOOK_URL?: string;
}
