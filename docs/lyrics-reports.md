# Community lyrics reports

`POST /api/lyrics/:id/reports` accepts reports for cached community syllable lyrics.
The Android client shows a report icon in the lyrics header only for community
syncs, asks for a reason and optional details, and keeps the form available if
submission fails. Other requires details. Sending a report does not remove lyrics.

```json
{
  "reason": "timings",
  "details": "The chorus starts about a second late."
}
```

Reasons are `timings`, `lyrics`, `missing`, or `other`. Details are trimmed and
limited to 1000 characters. Unknown fields, invalid reasons and malformed JSON
return **400**. The track ID must contain exactly 22 alphanumeric characters.
Missing cached lyrics return **404**; non-community lyrics return **409**.
Requests larger than 8 KiB return **413**. The existing overall API limiter applies,
plus the submission limiter's five requests per minute per IP using a separate
report key. Rate-limited requests return **429** with `Retry-After: 60`.

A successful response is **201**:

```json
{ "id": "<report UUID>", "status": "received" }
```

Reports are stored before acknowledgement in `LYRICS_CACHE` under
`lyrics-report:<track ID>:<report UUID>`. Each contains the ID, track ID, reason,
details, UTC creation time, SHA-256 hash of the community lyrics at receipt, and
notification status. The hash identifies the version reported if a later sync
replaces it. No IP address is stored in the report. Reports have no automatic
expiry and do not alter the lyrics cache entries. Retries are separate reports.
Inspect or remove reports in the Cloudflare KV dashboard; there is no public
endpoint exposing report details.

## Optional Discord notifications

Create an incoming webhook for a private Discord text channel, then set its URL
as a Worker secret from the API project directory:

```sh
npx wrangler secret put LYRICS_REPORT_WEBHOOK_URL
npm run deploy
```

Paste the webhook URL into the secret prompt. Keep it out of source control and
the Android app. This uses Discord's
[Execute Webhook API](https://docs.discord.com/developers/resources/webhook#execute-webhook)
with `wait=true` and mentions disabled. Notifications include the report ID,
Spotify track link, reason, and details. User-provided details are untrusted text.

Without the secret, reports still save with `notification: "not_configured"`.
With it, status starts as `pending`, then becomes `sent` or `failed`. Delivery runs
in the Worker execution context after the report is stored, with a ten-second
timeout. Notification failure does not reject a stored report; the report ID is
logged in Worker logs and the report remains in KV. There is no automatic retry
or retroactive notification for existing reports. A status-write failure can leave
`pending`; check Worker logs when reviewing these records.

No new bindings are required. Deploy the API before shipping the client update.
Run `npm test` and `npm run typecheck`; report tests use in-memory storage and
mocked webhooks, without sending notifications or deploying.
