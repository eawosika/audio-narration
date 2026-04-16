import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import NodeID3 from 'node-id3';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

const app = express();
app.use(express.json({ limit: '1mb' }));

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
// Flash v2.5: half the credits (0.5 per char vs 1), faster generation, multilingual
const MODEL_ID = 'eleven_flash_v2_5';
const MAX_CHUNK_CHARS = 4500;

const AUDIO_DIR = process.env.AUDIO_DIR || './audio';
const CHUNKS_DIR = path.join(AUDIO_DIR, '.chunks');

const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : `http://localhost:${process.env.PORT || 3001}`;

const RIALO_BASE = 'https://www.rialo.io';

await fs.mkdir(AUDIO_DIR, { recursive: true });
await fs.mkdir(CHUNKS_DIR, { recursive: true });

app.use('/audio', express.static(AUDIO_DIR, {
  maxAge: '365d',
  immutable: true,
  setHeaders: (res) => {
    res.set('Content-Type', 'audio/mpeg');
    res.set('Accept-Ranges', 'bytes');
  },
}));

app.use((req, res, next) => {
  const allowed = (process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '*').split(',');
  const origin = req.headers.origin;
  if (allowed.includes('*') || allowed.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin || '*');
  }
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

// Clean article text to remove things that sound bad when read aloud
function cleanTextForSpeech(text) {
  return text
    // Remove URLs
    .replace(/https?:\/\/[^\s)]+/g, '')
    // Remove markdown-style links but keep the text: [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove image references and alt text patterns
    .replace(/!\[[^\]]*\]/g, '')
    // Remove citation markers like [1], [2], etc.
    .replace(/\[\d+\]/g, '')
    // Remove standalone special characters that don't read well
    .replace(/[│┤├┐┘┌└─═]/g, '')
    // Remove code blocks and inline code
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    // Remove excessive punctuation
    .replace(/\.{3,}/g, '.')
    .replace(/\*{1,3}/g, '')
    // Clean up mathematical notation that doesn't read well
    .replace(/[𝗘𝗽𝗼𝗰𝗵𝗖𝗵𝗮𝗻𝗴𝗲𝗥𝗲𝗮𝗱𝘆𝗗𝗼𝗻𝗲]/g, function(c) {
      // Map bold math chars back to normal ASCII
      const bold = '𝗘𝗽𝗼𝗰𝗵𝗖𝗵𝗮𝗻𝗴𝗲𝗥𝗲𝗮𝗱𝘆𝗗𝗼𝗻𝗲';
      const normal = 'EpochChangeReadyDone';
      const idx = bold.indexOf(c);
      return idx >= 0 ? normal[idx] : c;
    })
    // Strip non-BMP unicode and unpaired surrogates that break ElevenLabs
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/[^\x00-\x7F\xA0-\xFF\u0100-\uFFFF]/g, '')
    // Replace common mathematical bold/italic unicode with ASCII equivalents
    .replace(/[\u{1D400}-\u{1D7FF}]/gu, function(c) {
      var cp = c.codePointAt(0);
      // Bold capitals A-Z: U+1D400 to U+1D419
      if (cp >= 0x1D400 && cp <= 0x1D419) return String.fromCharCode(cp - 0x1D400 + 65);
      // Bold lowercase a-z: U+1D41A to U+1D433
      if (cp >= 0x1D41A && cp <= 0x1D433) return String.fromCharCode(cp - 0x1D41A + 97);
      // Sans-serif bold capitals: U+1D5D4 to U+1D5ED
      if (cp >= 0x1D5D4 && cp <= 0x1D5ED) return String.fromCharCode(cp - 0x1D5D4 + 65);
      // Sans-serif bold lowercase: U+1D5EE to U+1D607
      if (cp >= 0x1D5EE && cp <= 0x1D607) return String.fromCharCode(cp - 0x1D5EE + 97);
      return '';
    })
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
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

async function fixMp3Duration(filepath) {
  const tempPath = filepath + '.tmp.mp3';
  try {
    await execFileAsync('ffmpeg', [
      '-i', filepath,
      '-c', 'copy',
      '-y',
      tempPath
    ]);
    await fs.rename(tempPath, filepath);
    console.log('Fixed MP3 duration header:', filepath);
  } catch (err) {
    console.error('ffmpeg fix failed (non-fatal):', err.message);
    await fs.unlink(tempPath).catch(() => {});
  }
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

async function fetchArticleMetadata(slug) {
  const url = `${RIALO_BASE}/posts/${slug}`;
  const res = await fetch(url);
  if (!res.ok) return {};
  const html = await res.text();

  let title = '';
  let summary = '';
  let imageUrl = '';

  // Extract title from h1
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (titleMatch) {
    title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
  }

  // Extract summary - text after "Summary" heading
  const summaryMatch = html.match(/Summary<\/[^>]+>([\s\S]*?)(?=<(?:h[1-6]|div[^>]*class="[^"]*blog-content))/i);
  if (summaryMatch) {
    summary = summaryMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Extract featured image - first large image in the post content area
  const imageMatches = html.matchAll(/<img[^>]*src="(https:\/\/cdn\.prod\.website-files\.com\/6883572e6ebf68cfe676dd77\/[^"]+)"[^>]*>/gi);
  for (const m of imageMatches) {
    const src = m[1];
    // Skip small icons and logos
    if (!src.includes('logo') && !src.includes('close') && !src.includes('discord') && !src.includes('telegram') && !src.includes('Vector')) {
      imageUrl = src;
      break;
    }
  }

  return { title, summary, imageUrl };
}

async function tagMp3(filepath, metadata) {
  try {
    const tags = {
      title: metadata.title || '',
      artist: 'Rialo',
      album: 'Rialo Blog',
      comment: {
        language: 'eng',
        text: metadata.summary || ''
      },
      userDefinedUrl: [{
        description: 'Source',
        url: metadata.sourceUrl || ''
      }]
    };

    // Download and embed the featured image as cover art
    if (metadata.imageUrl) {
      try {
        const imgRes = await fetch(metadata.imageUrl);
        if (imgRes.ok) {
          const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
          const contentType = imgRes.headers.get('content-type') || 'image/png';
          let mimeType = 'image/png';
          if (contentType.includes('jpeg') || contentType.includes('jpg')) mimeType = 'image/jpeg';
          else if (contentType.includes('webp')) mimeType = 'image/webp';

          tags.image = {
            mime: mimeType,
            type: { id: 3, name: 'front cover' },
            description: 'Article featured image',
            imageBuffer: imgBuffer
          };
        }
      } catch (imgErr) {
        console.error('Failed to download cover image:', imgErr.message);
      }
    }

    NodeID3.write(tags, filepath);
    console.log(`ID3 tags written for: ${metadata.title || filepath}`);
  } catch (err) {
    // Don't fail the whole process if tagging fails
    console.error('Failed to write ID3 tags:', err.message);
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

  // Clean text for speech before returning
  text = cleanTextForSpeech(text);

  return text.slice(0, 50000);
}

async function generateAudio(postId, text, metadata = {}) {
  const hash = hashText(text);
  const filename = getFilename(postId, hash);
  const filepath = path.join(AUDIO_DIR, filename);

  if (await fileExists(filepath)) {
    return { url: `${BASE_URL}/audio/${filename}`, cached: true };
  }

  const chunks = chunkText(text);
  console.log(`Generating audio for "${postId}": ${chunks.length} chunk(s), ${text.length} chars`);

  const audioBuffers = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkHash = hashText(chunks[i]);
    const chunkFile = path.join(CHUNKS_DIR, `${postId}_${hash}_chunk${i}_${chunkHash}.mp3`);

    if (await fileExists(chunkFile)) {
      console.log(`  Chunk ${i + 1}/${chunks.length}: cached`);
      audioBuffers.push(await fs.readFile(chunkFile));
    } else {
      console.log(`  Chunk ${i + 1}/${chunks.length}: generating (${chunks[i].length} chars)`);
      const buffer = await generateChunkAudio(chunks[i]);
      await fs.writeFile(chunkFile, buffer);
      audioBuffers.push(buffer);
    }
  }

  const fullAudio = Buffer.concat(audioBuffers);
  await fs.writeFile(filepath, fullAudio);

  // Fix MP3 duration header for concatenated files
  if (chunks.length > 1) {
    await fixMp3Duration(filepath);
  }

  // Write ID3 tags (title, artist, cover art, etc.)
  if (metadata.title || metadata.imageUrl) {
    await tagMp3(filepath, { ...metadata, sourceUrl: `${RIALO_BASE}/posts/${postId}` });
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunkHash = hashText(chunks[i]);
    const chunkFile = path.join(CHUNKS_DIR, `${postId}_${hash}_chunk${i}_${chunkHash}.mp3`);
    await fs.unlink(chunkFile).catch(() => {});
  }

  const url = `${BASE_URL}/audio/${filename}`;
  console.log(`Audio cached: ${url}`);

  return { url, cached: false };
}

// ── Routes ──────────────────────────────────────────────

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
    const { text, title, summary, imageUrl } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "text" field' });
    }

    if (text.length > 50000) {
      return res.status(400).json({ error: 'Article text exceeds 50,000 character limit' });
    }

    const cleaned = cleanTextForSpeech(text);
    const metadata = { title: title || '', summary: summary || '', imageUrl: imageUrl || '' };
    const result = await generateAudio(postId, cleaned, metadata);
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
    const metadata = await fetchArticleMetadata(postId);
    console.log(`Extracted ${text.length} chars, title: "${metadata.title}"`);

    const result = await generateAudio(postId, text, metadata);

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

app.get('/api/narration/:postId/download', async (req, res) => {
  try {
    const { postId } = req.params;
    const files = await fs.readdir(AUDIO_DIR);
    const match = files.find(f => f.startsWith(`${postId}_`) && f.endsWith('.mp3'));

    if (!match) {
      return res.status(404).json({ error: 'No audio found for this post.' });
    }

    const filepath = path.join(AUDIO_DIR, match);
    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Disposition', `attachment; filename="${postId}.mp3"`);
    const file = await fs.readFile(filepath);
    res.send(file);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Failed to download audio' });
  }
});

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

    // Also clean up any leftover chunks
    const chunkFiles = await fs.readdir(CHUNKS_DIR).catch(() => []);
    const chunkMatches = chunkFiles.filter(f => f.startsWith(`${postId}_`));
    for (const file of chunkMatches) {
      await fs.unlink(path.join(CHUNKS_DIR, file)).catch(() => {});
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
    const cleaned = cleanTextForSpeech(text);
    const result = await generateAudio(postId, cleaned);
    res.json({ status: result.cached ? 'already_cached' : 'generated', url: result.url });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Failed to generate narration' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Narration service running on :${PORT}`));
