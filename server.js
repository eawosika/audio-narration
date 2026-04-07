import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const app = express();
app.use(express.json({ limit: '1mb' }));

// ── Config ──────────────────────────────────────────────
const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
const MODEL_ID = 'eleven_monolingual_v1';
const MAX_CHUNK_CHARS = 4500;

// Railway volume mount path — you'll configure this in Railway's dashboard.
// If not set, falls back to a local ./audio folder (for local dev).
const AUDIO_DIR = process.env.AUDIO_DIR || './audio';

// The public base URL of this Railway service (e.g. https://rialo-narration.up.railway.app)
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : `http://localhost:${process.env.PORT || 3001}`;

// Ensure audio directory exists on startup
await fs.mkdir(AUDIO_DIR, { recursive: true });

// Serve the audio files as static assets
app.use('/audio', express.static(AUDIO_DIR, {
  maxAge: '365d',
  immutable: true,
  setHeaders: (res) => {
    res.set('Content-Type', 'audio/mpeg');
    res.set('Accept-Ranges', 'bytes');
  },
}));

// CORS — allow your Rialo domain to call this service
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Helpers ─────────────────────────────────────────────

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function chunkText(text, maxChars = MAX_CHUNK_CHARS) {
  if (text.length <= maxChars) return [text];

  const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + sentence).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function generateChunkAudio(text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVEN_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs error ${res.status}: ${err}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

function getFilename(postId, hash) {
  return `${postId}_${hash}.mp3`;
}

async function fileExists(filepath) {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

// ── Routes ──────────────────────────────────────────────

/**
 * GET /api/narration/:postId
 *
 * Check if audio exists for a post.
 * Query: ?hash=<textHash>
 *
 * Returns:
 *   { exists: true, url: "https://your-app.up.railway.app/audio/post_abc123.mp3" }
 *   { exists: false }
 */
app.get('/api/narration/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const { hash } = req.query;

    if (!hash) {
      // Without a hash, try to find any file matching this postId
      const files = await fs.readdir(AUDIO_DIR);
      const match = files.find(f => f.startsWith(`${postId}_`) && f.endsWith('.mp3'));

      if (match) {
        return res.json({ exists: true, url: `${BASE_URL}/audio/${match}` });
      }
      return res.json({ exists: false });
    }

    const filename = getFilename(postId, hash);
    const filepath = path.join(AUDIO_DIR, filename);

    if (await fileExists(filepath)) {
      return res.json({ exists: true, url: `${BASE_URL}/audio/${filename}` });
    }

    return res.json({ exists: false });
  } catch (err) {
    console.error('GET /api/narration error:', err);
    res.status(500).json({ error: 'Failed to check narration status' });
  }
});

/**
 * POST /api/narration/:postId/generate
 *
 * Generate + cache audio for a blog post.
 * Body: { text: string }
 *
 * Returns:
 *   { url: "...", cached: boolean }
 */
app.post('/api/narration/:postId/generate', async (req, res) => {
  try {
    const { postId } = req.params;
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "text" field' });
    }

    if (text.length > 50000) {
      return res.status(400).json({ error: 'Article text exceeds 50,000 character limit' });
    }

    const hash = hashText(text);
    const filename = getFilename(postId, hash);
    const filepath = path.join(AUDIO_DIR, filename);

    // Return cached version if it exists
    if (await fileExists(filepath)) {
      return res.json({ url: `${BASE_URL}/audio/${filename}`, cached: true });
    }

    // Generate audio
    const chunks = chunkText(text);
    console.log(`Generating audio for "${postId}": ${chunks.length} chunk(s), ${text.length} chars`);

    const audioBuffers = [];
    for (const chunk of chunks) {
      audioBuffers.push(await generateChunkAudio(chunk));
    }

    const fullAudio = Buffer.concat(audioBuffers);

    // Save to disk
    await fs.writeFile(filepath, fullAudio);

    const url = `${BASE_URL}/audio/${filename}`;
    console.log(`Audio cached: ${url}`);

    res.json({ url, cached: false });
  } catch (err) {
    console.error('POST /api/narration/generate error:', err);
    res.status(500).json({ error: 'Failed to generate narration' });
  }
});

/**
 * POST /api/narration/webhook
 *
 * Pre-generate audio when a post is published.
 * Body: { postId: string, text: string }
 */
app.post('/api/narration/webhook', async (req, res) => {
  try {
    const { postId, text } = req.body;

    if (!postId || !text) {
      return res.status(400).json({ error: 'Missing postId or text' });
    }

    const hash = hashText(text);
    const filename = getFilename(postId, hash);
    const filepath = path.join(AUDIO_DIR, filename);

    if (await fileExists(filepath)) {
      return res.json({ status: 'already_cached', url: `${BASE_URL}/audio/${filename}` });
    }

    const chunks = chunkText(text);
    const audioBuffers = [];
    for (const chunk of chunks) {
      audioBuffers.push(await generateChunkAudio(chunk));
    }

    await fs.writeFile(filepath, Buffer.concat(audioBuffers));

    res.json({ status: 'generated', url: `${BASE_URL}/audio/${filename}` });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Failed to generate narration' });
  }
});

/**
 * GET /health
 * Simple health check for Railway.
 */
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Start ───────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Narration service running on :${PORT}`));
