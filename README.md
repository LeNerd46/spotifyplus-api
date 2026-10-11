# Spotify Plus API

This is the official API used to fetch lyrics for [Spotify Plus](https://www.github.com/LeNerd46/SpotifyPlus). It gets the lyrics from Apple Music, then reformats it into JSON so Spotify Plus can understand them.

Currently supported lyric sources:
- Apple Music
- Lrclib
- Netease
- Musixmatch
- Community submitted lyrics

## Using the API

The main endpoint you would want to use is probably the lyrics endpoint, but I'll list all of them

### Get Lyrics

`GET /api/lyrics/:id`

Retrives lyrics for the given Spotify track

**Parameters**

| Parameter | Type          | Description                      |
| ------ | ----------------- | -------------------------------- |
| `id`  | `string` | The Spotify track ID |

### Submit Lyrics

`POST /api/lyrics/:id`

Submits lyrics to the API. Supports the beautiful lyrics format (JSON), TTML, and Enriched LRC. Please do not submit normal LRC.

**Parameters**

| Parameter | Type          | Description                      |
| ------ | ----------------- | -------------------------------- |
| `id`  | `string` | The Spotify track ID |
| `format` | `json \| ttml \| lrc` | The format the lyrics are in |

The body of the request should be your lyrics

### Report Lyrics

`POST /api/lyrics/:id/reports`

| Parameter | Type          | Description                      |
| ------ | ----------------- | -------------------------------- |
| `id`  | `string` | The Spotify track ID |

Body contents:

| Key | Value | Desription |
| --- | ----- | ---------- |
| `reason` | `timings \| lyrics \| missing \| other ` | The reason for the report |
| `details` | `string?` | Any additional details about the report |

# How It Works

When a request is made, it only recieves the Spotify ID. It needs to convert that into an Apple Music ID. So we ask the Spotify API what the ISRC code is for the song, and luckily Apple Music lets you search by ISRC in their API, which then will give you the Apple Music ID. Once we have that, we can use the Apple Music web API to get the lyrics. It requires a developer token and a media user token. We can get the developer token on demand by loading the Apple Music webpage in a browser, so it does that if we get a 404 error from Apple Music. However, the media user token has to be provided from a valid Apple Music account. This token should last ~6 months. So if you want to deploy this yourself, you will need to update that every now and then. 

### Spotify authentication for self-hosting

Track metadata is cached in `SPOTIFY_CACHE`. On a cache miss, the Spotify SDK tries client credentials first (`SPOTIFY_CLIENT` and `SPOTIFY_SECRET`). Configure them with `npx wrangler secret put SPOTIFY_CLIENT` and `npx wrangler secret put SPOTIFY_SECRET`. If credentials are missing, the SDK throws (including any 4xx error), or the result lacks required metadata such as an ISRC, lookup falls back to Spotify's authenticated `spclient` metadata endpoint. The fallback uses the stored credential and short-lived tokens in `SPOTIFY_CACHE` to renew bearer tokens.

1. Create and keep a stable 40-character device ID:

   ```sh
   node -e "console.log(require('crypto').randomBytes(20).toString('hex'))"
   npx wrangler secret put SPOTIFY_DEVICE_ID
   ```

2. Add the bootstrap credentials as Worker secrets:

   ```sh
   npx wrangler secret put SPOTIFY_USERNAME
   npx wrangler secret put SPOTIFY_PASSWORD
   ```

3. Deploy and make one uncached lyrics request. Once it succeeds, remove the bootstrap credentials; the stored credential contains the canonical username needed for refreshes:

   ```sh
   npx wrangler secret delete SPOTIFY_USERNAME
   npx wrangler secret delete SPOTIFY_PASSWORD
   ```

For local development, copy `.dev.vars.example` to `.dev.vars`. If the `SPOTIFY_CACHE` namespace is cleared or Spotify revokes the stored credential, temporarily add the username and password again to bootstrap a new one. Treat that KV namespace as sensitive account data. This uses Spotify's private protocol in the same spirit as librespot and may be affected by Spotify protocol changes or terms of service.

## Access to the API

I am publicly hosting this API on `https://spotifyplus-api.devon-shoutz.workers.dev`. Anyone is allowed to use the API for any project. I really do not care what you use it for. Please just be respectful of how much you're using it. Just don't abuse it, that's all I ask.
