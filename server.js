import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const app = express();
app.use(express.json({ limit: '1mb' }));

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

async function fetchArticleText(slug) {
  const url = `${RIALO_BASE}/posts/${slug}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  const html = await res.text();

  let cleaned = html
    .replace(/<aside[^>]*id="panel"[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<button[^>]*id="openBtn"[^>]*>[\s\S]*?<\/button>/gi, '')
    .replace(/<div[^>]*id="miniCard"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<button[^>]*id="mobileAskBtn"[^>]*>[\s\S]*?<\/button>/gi, '')
    .replace(/<div[^>]*id="narration-player"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]*class="[^"]*w-condition-invisible[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, '')
    .replace(/<a[^>]*class="[^"]*heading-link[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/<[^>]*style="[^"]*display:\s*none[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, '');

  const richTextMatch = cleaned.match(/<div[^>]*class="[^"]*w-richtext[^"]*"[^>]*>([\s\S]*)/i);

  let text = '';

  if (richTextMatch) {
    let content = richTextMatch[1];

    const endMarkers = [/<\/main>/i, /<footer/i, /<form/i, /<div[^>]*class="[^"]*w-nav/i];
    for (const marker of endMarkers) {
      const endMatch = content.search(marker);
      if (endMatch > 0) {
        content = content.slice(0, endMatch);
        break;
      }
    }

    text = content
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/Copy header link/gi, '')
      .replace(/Copy link/gi, '')
      .replace(/Explore this article with AI/gi, '')
      .replace(/Rialo Readerbot/gi, '')
      .replace(/Keep reading with AI/gi, '')
      .replace(/Open Readerbot/gi, '')
      .replace(/Ask about this article/gi, '')
      .replace(/Ask AI/gi, '')
      .replace(/Listen to this article/gi, '')
      .replace(/\d+:\d+\s*\/\s*\d+:\d+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (!text || text.length < 50) {
    const paragraphs = [];
    const pMatches = cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    for (const m of pMatches) {
      const clean = m[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
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

app.get('/api/narration/:postId/auto-generate', async (req, res) => {
  try {
    const { postId } = req.params;

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

// Delete cached audio for a post so it can be re-generated
app.get('/api/narration/:postId/delete', async (req, res) => {
  try {
    const { postId } = req.params;
    const files = await fs.readdir(AUDIO_DIR);
    const matches = files.filter(f => f.startsWith(`${postId}_`) && f.endsWith('.mp3'));

    if (matches.length === 0) {
      return res.json({ deleted: 0, message: 'No cached audio found for this post.' });
    }

    for (const file of matches) {
      await fs.unlink(path.join(AUDIO_DIR, file));
    }

    res.json({ deleted: matches.length, files: matches });
  } catch (err) {
    console.error('DELETE /api/narration error:', err);
    res.status(500).json({ error: 'Failed to delete cached audio' });
  }
});

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

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Narration service running on :${PORT}`));
