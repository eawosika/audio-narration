# Audio Narration

A lightweight service that generates AI-narrated audio for Rialo blog posts using ElevenLabs. Audio is generated once per article and cached to persistent storage, so every subsequent listen is instant.

## Features

- **Listen on the blog.** An inline player embedded on each blog post with play/pause, scrubbing, and adjustable playback speed (0.75x to 2x).
- **Listen on Spotify.** Articles are available as podcast episodes. The player links directly to the corresponding Spotify episode when available.
- **Download the MP3.** One-click download of the full article audio, complete with ID3 tags (title, artist, summary, and featured image as cover art).
- **Adjustable speed.** Switch between 0.75x, 1x, 1.25x, 1.5x, and 2x playback speed on both the main player and the mini-player.
- **Resume where you left off.** Progress is saved to localStorage automatically. Come back hours or days later and playback picks up from where you stopped, including your speed setting. Expires after 30 days.
- **Sticky mini-player.** A compact player appears on the left side of the screen when you scroll past the main player (desktop and tablet only). Includes play/pause, vertical progress bar with drag support, speed cycling, and current time.

## How it works

1. The service fetches a blog post from rialo.io, extracts the article text, and strips out UI elements, hidden text, and non-speech content.
2. The cleaned text is split into chunks and sent to the ElevenLabs API, which returns MP3 audio.
3. Chunks are concatenated and the MP3 header is rewritten with ffmpeg for accurate duration reporting.
4. ID3 tags are embedded (title, artist, summary, cover art from the featured image).
5. The MP3 is saved to disk (Railway volume) and served as a static file.
6. A player embedded on the blog page checks for cached audio on load. If it exists, playback is instant. If not, the first listener triggers generation.

## Endpoints

### Check if audio exists

```
GET /api/narration/:postId
```

Returns `{ exists: true, url: "..." }` or `{ exists: false }`.

### Generate audio from provided text

```
POST /api/narration/:postId/generate
Body: { "text": "...", "title": "...", "summary": "...", "imageUrl": "..." }
```

Used by the frontend player when a listener clicks play and no cached audio exists. Title, summary, and imageUrl are optional and used for ID3 tags.

### Auto-generate from a blog post URL

```
GET /api/narration/:postId/auto-generate
```

Fetches the article from `rialo.io/posts/:postId`, extracts the text and metadata, generates audio, and caches it. Use this to pre-generate audio for new posts.

Example:

```
https://audio-narration-production.up.railway.app/api/narration/bringing-private-credit-onchain/auto-generate
```

### Delete cached audio

```
GET /api/narration/:postId/delete
```

Removes the cached MP3 for a post so it can be re-generated. Useful when the article content has been updated or the previous audio had issues.

### Download audio

```
GET /api/narration/:postId/download
```

Returns the MP3 file with a `Content-Disposition: attachment` header, triggering a direct browser download.

### Health check

```
GET /health
```

Returns `{ "status": "ok" }`.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ELEVENLABS_API_KEY` | Yes | Your ElevenLabs API key |
| `ELEVENLABS_VOICE_ID` | No | Voice to use (defaults to Adam) |
| `AUDIO_DIR` | Yes | Path to persistent storage for MP3 files (e.g. `/data/audio`) |
| `ALLOWED_ORIGIN` | No | CORS origin (e.g. `https://www.rialo.io`). Defaults to `*` |
| `PORT` | No | Set automatically by Railway |
| `RAILWAY_PUBLIC_DOMAIN` | No | Set automatically by Railway |

## Deployment (Railway)

1. Connect this repo to a new Railway project.
2. Add a persistent volume with mount path `/data/audio`.
3. Set the environment variables listed above.
4. Railway auto-deploys on push to `main`.

Note: Railway's default Node image includes ffmpeg, which is required for fixing MP3 duration headers on concatenated files.

## Frontend player

The blog uses an HTML embed placed above the article body on each post. The Spotify link is configured per-post via a slug-to-URL mapping in the embed code. The player matches Rialo's visual style (beige/black palette, black border).

## Efficiency notes

- Uses the `eleven_flash_v2_5` model at half the credit cost of older models.
- Text is cleaned before generation to remove URLs, code blocks, hidden UI elements, and non-speech content.
- Chunks are cached individually, so a failed generation picks up where it left off.
- Audio is generated once per article and served as a static file on all subsequent requests.
- MP3 headers are rewritten with ffmpeg after chunk concatenation for accurate duration reporting.
- MP3 files include ID3 tags with article title, artist (Rialo), summary, source URL, and the featured image as cover art.
