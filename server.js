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

const AUDIO_DIR = process.env.AUDIO_DIR || './audio';

const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : `http://localhost:${process.env.PORT || 3001}`;

const RIALO_BASE = 'https://www.rialo.io';

await fs.mkdir(AUDIO_DIR, { recursive: true });

app.use('/audio', express.static(AUDIO_DIR, {
  maxAge: '365d',
  immutable: true,
  setHeaders: (res) => {
    res.set('Content-Type', 'audio/mpeg');
    res.set('Accept-Ranges', 'bytes');
  },
}));

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

// Fetch a Rialo blog post and extract the article text
async function fetchArticleText(slug) {
  const url = `${RIALO_BASE}/posts/${slug}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }

  const html = await res.text();

  // Extract text from the rich text block
  // Look for content between common Webflow rich text markers
  let text = '';

  // Try to find the rich text content block
  const richTextMatch = html.match(/<div[^>]*class="[^"]*w-richtext[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);

  if (richTextMatch) {
    text = richTextMatch[1]
      // Remove hidden elements and copy-link helpers
      .replace(/<[^>]*class="[^"]*w-condition-invisible[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, '')
      .replace(/<a[^>]*class="[^"]*heading-link[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '')
      .replace(/<[^>]*style="[^"]*display:\s*none[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, '')
      // Remove script and style tags
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      // Strip remaining HTML tags
      .replace(/<[^>]+>/g, ' ')
      // Decode HTML entities
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Clean up "Copy header link" text that might remain
      .replace(/Copy header link/gi, '')
      .replace(/Copy link/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (!text) {
    // Fallback: grab all paragraph text from the page body
    const paragraphs = [];
    const pMatches = html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    for (const m of pMatches) {
      const clean = m[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      if (clean.length > 20) paragraphs.push(clean);
    }
    text = paragraphs.join(' ');
  }

  if (!text || text.length < 50) {
    throw new Error('Could not extract meaningful article text from the page.');
  }

  return text.slice(0, 50000);
}

// Core generate function used by multiple routes
async function generateAudio(postId, text) {
  const hash = hashText(text);
  const filename = getFilename(postId, hash);
  const filepath = path.join(AUDIO_DIR, filename);

  if (await fileExists(filepath)) {
    return { url: `${BASE_URL}/audio/${filename}`, cached: true };
  }

  const chunks = chunkText(text);
  console.log(`Generating audio for "${postId}": ${chunks.length} chunk(s), ${text.length} chars`);

  const audioBuffers = [];
  for (const chunk of chunks) {
    audioBuffers.push(await generateChunkAudio(chunk));
  }

  const fullAudio = Buffer.concat(audioBuffers);
  await fs.writeFile(filepath, fullAudio);

  const url = `${BASE_URL}/audio/${filename}`;
  console.log(`Audio cached: ${url}`);

  return { url, cached: false };
}

// ── Routes ──────────────────────────────────────────────

/**
 * GET /api/narration/:postId
 *
 * Check if audio exists for a post.
 */
app.get('/api/narration/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const { hash } = req.query;

    if (!hash) {
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

    const result = await generateAudio(postId, text);
    res.json(result);
  } catch (err) {
    console.error('POST /api/narration/generate error:', err);
    res.status(500).json({ error: 'Failed to generate narration' });
  }
});

/**
 * GET /api/narration/:postId/auto-generate
 *
 * Fetches the article text from rialo.io automatically and generates audio.
 * No request body needed — just visit the URL in your browser.
 *
 * Example: /api/narration/bringing-private-credit-onchain/auto-generate
 */
app.get('/api/narration/:postId/auto-generate', async (req, res) => {
  try {
    const { postId } = req.params;

    // Check if already cached
    const files = await fs.readdir(AUDIO_DIR);
    const existing = files.find(f => f.startsWith(`${postId}_`) && f.endsWith('.mp3'));
    if (existing) {
      return res.json({
        status: 'already_cached',
        url: `${BASE_URL}/audio/${existing}`,
        slug: postId
      });
    }

    console.log(`Auto-generating audio for: ${postId}`);
    console.log(`Fetching article from: ${RIALO_BASE}/posts/${postId}`);

    const text = await fetchArticleText(postId);
    console.log(`Extracted ${text.length} chars of article text`);

    const result = await generateAudio(postId, text);

    res.json({
      status: result.cached ? 'already_cached' : 'generated',
      url: result.url,
      slug: postId,
      textLength: text.length
    });
  } catch (err) {
    console.error('Auto-generate error:', err);
    res.status(500).json({ error: err.message });
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

    const result = await generateAudio(postId, text);
    res.json({ status: result.cached ? 'already_cached' : 'generated', url: result.url });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Failed to generate narration' });
  }
});

/**
 * GET /health
 */
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Start ───────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Narration service running on :${PORT}`));
