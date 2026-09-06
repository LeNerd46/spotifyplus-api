# Community lyrics submissions

`POST /api/lyrics/:id` accepts the same JSON shape returned by the lyrics API for
`Type: "Syllable"`. The ID must be a 22-character Spotify track ID. Requests are
limited to 512 KiB. Timestamps are seconds, including fractional seconds.

The track's original line lyrics must already be cached by `GET /api/lyrics/:id`.
Submissions must preserve every lead line, its words, word boundaries and alignment.
Words can be divided into syllables using `IsPartOfWord: true` on every fragment
except the final fragment of a word. Each fragment needs finite, positive-duration
timings; fragments within a vocal must not overlap. Separate lead lines may overlap.
Line/song bounds must agree with the contained timings. Timings are bounded by the
cached source ending plus a 30-second correction allowance, capped at 24 hours.

Parenthetical phrases become optional `Background` vocals. They may overlap lead
vocals. Include only complete, timed phrases, in source order. Omit untouched
phrases entirely (or omit `Background` when none were synced). Entirely
parenthetical lines may also be omitted. Partial phrases and invented words are
rejected. Structural validation cannot determine whether timings match the audio.

Successful responses return **201**, the normalized lyrics and `Community: true`.
The server preserves the original `SongWriters`, ignoring client-supplied credits.
Malformed data returns **400**, missing original line lyrics **409**, and oversized
requests **413**. No cache mutations occur on validation failure.

The existing `LYRICS_CACHE` binding stores:

- `lyrics-source:<id>`: retained original line lyrics for validation and retries.
- `lyrics-community:<id>`: preferred community syllable lyrics.
- `lyrics:<id>`: also replaced with the community lyrics for compatibility.

GET checks the preferred community key first, protecting it from late provider
fetches that overwrite the normal cache. Cloudflare KV propagation remains
eventually consistent across regions. A later valid submission replaces the prior
community sync. This endpoint uses the API's existing public access model.

Run `npm test` and `npm run typecheck`. Deploy the API with the existing `npm run
deploy` workflow before releasing the client save feature; no new bindings are
required. Tests use an in-memory cache and do not submit real lyrics or deploy.
