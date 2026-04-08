# Audio Narration

A lightweight service that generates AI-narrated audio for Rialo blog posts using ElevenLabs. Audio is generated once per article and cached to persistent storage, so every subsequent listen is instant.

## How it works

1. The service fetches a blog post from rialo.io, extracts the article text, and strips out UI elements, hidden text, and non-speech content.
2. The cleaned text is split into chunks and sent to the ElevenLabs API, which returns MP3 audio.
3. The MP3 is saved to disk (Railway volume) and served as a static file.
4. A player embedded on the blog page checks for cached audio on load. If it exists, playback is instant. If not, the first listener triggers generation.

## Endpoints

### Check if audio exists

```
GET /api/narration/:postId
```

Returns `{ exists: true, url: "..." }` or `{ exists: false }`.

### Generate audio from provided text

```
POST /api/narration/:postId/generate
Body: { "text": "..." }
```

Used by the frontend player when a listener clicks play and no cached audio exists.

### Auto-generate from a blog post URL

```
GET /api/narration/:postId/auto-generate
```

Fetches the article from `rialo.io/posts/:postId`, extracts the text, generates audio, and caches it. Use this to pre-generate audio for new posts.

Example:

```
https://audio-narration-production.up.railway.app/api/narration/bringing-private-credit-onchain/auto-generate
```

### Delete cached audio

```
GET /api/narration/:postId/delete
```

Removes the cached MP3 for a post so it can be re-generated. Useful when the article content has been updated or the previous audio had issues.

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

## Frontend player

The blog uses an HTML embed placed above the article body on each post. The player:

- Checks for cached audio on page load
- Shows a loading state while generating on first listen
- Supports play/pause, scrubbing, and speed control (0.75x to 2x)
- Matches Rialo's visual style (beige/black palette)

## Efficiency notes

- Uses the `eleven_flash_v2_5` model, which costs 0.5 credits per character (half the cost of older models) and generates faster.
- Text is cleaned before sending to ElevenLabs: URLs, code blocks, citation markers, markdown syntax, and hidden UI text are stripped out.
- Chunks are cached individually during generation. If the process fails partway through (e.g. quota exceeded), completed chunks are preserved and the next attempt picks up where it left off.
- Audio is generated once per article and served as a static file on all subsequent requests.
