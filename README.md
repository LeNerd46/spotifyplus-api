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

## Access to the API

I am publicly hosting this API on `https://spotifyplus-api.devon-shoutz.workers.dev`. Anyone is allowed to use the API for any project. I really do not care what you use it for. Please just be respectful of how much you're using it. Just don't abuse it, that's all I ask. 