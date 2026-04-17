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
const MODEL_ID = 'eleven_v3';
const MAX_CHUNK_CHARS = 4500;

const AUDIO_DIR = process.env.AUDIO_DIR || './audio';
const CHUNKS_DIR = path.join(AUDIO_DIR, '.chunks');

const ACTIVE_MAP_PATH = path.join(AUDIO_DIR, '.active.json');

async function loadActiveMap() {
  try {
    const data = await fs.readFile(ACTIVE_MAP_PATH, 'utf8');
    return JSON.parse(data);
  } catch { return {}; }
}

async function saveActiveMap(map) {
  await fs.writeFile(ACTIVE_MAP_PATH, JSON.stringify(map, null, 2));
}

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
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function adminAuth(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return next();
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token === password) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.post('/api/admin/auth', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
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

function cleanTextForSpeech(text) {
  return text
    // ── Footnotes ──
    // Remove footnote reference numbers like [1], [2] and superscript markers
    .replace(/\[\d+\]/g, '')
    .replace(/\u00B9/g, '').replace(/\u00B2/g, '').replace(/\u00B3/g, '')
    // Remove entire footnotes section (everything after "Footnotes" heading)
    .replace(/Footnotes[\s\S]*$/i, '')

    // ── Section headers as pauses ──
    // Add a pause before headings so narrator breathes between sections
    .replace(/([.!?])\s*(#{1,6}\s)/g, '$1\n\n.\n\n$2')
    // If headings appear as standalone lines, add pause
    .replace(/\n([A-Z][A-Za-z0-9 :,'\-]{5,80})\n/g, '\n\n.\n\n$1.\n\n')

    // ── Acronyms and abbreviations ──
    // Spell out common technical/finance acronyms
    .replace(/\bEBITDA\b/g, 'E.B.I.T.D.A.')
    .replace(/\bBFT\b/g, 'B.F.T.')
    .replace(/\bSMR\b/g, 'S.M.R.')
    .replace(/\bDKG\b/g, 'D.K.G.')
    .replace(/\bLTV\b/g, 'L.T.V.')
    .replace(/\bNAV\b/g, 'N.A.V.')
    .replace(/\bAPI\b/g, 'A.P.I.')
    .replace(/\bAPIs\b/g, 'A.P.I.s')
    .replace(/\bERP\b/g, 'E.R.P.')
    .replace(/\bRWA\b/g, 'R.W.A.')
    .replace(/\bRWAs\b/g, 'R.W.A.s')
    .replace(/\bMPC\b/g, 'M.P.C.')
    .replace(/\bTPS\b/g, 'T.P.S.')
    .replace(/\bREX\b/g, 'Rex')
    .replace(/\bHTTPS\b/g, 'H.T.T.P.S.')
    .replace(/\bDeFi\b/g, 'DeFi')
    .replace(/\bIPC\b/g, 'I.P.C.')
    .replace(/\bSVM\b/g, 'S.V.M.')
    .replace(/\bEVM\b/g, 'E.V.M.')
    .replace(/\bZK\b/g, 'Z.K.')
    .replace(/\bCDP\b/g, 'C.D.P.')
    .replace(/\bTLS\b/g, 'T.L.S.')
    .replace(/\bPKI\b/g, 'P.K.I.')
    .replace(/\bBCRED\b/g, 'B.C.R.E.D.')
    .replace(/\bHLEND\b/g, 'H.L.E.N.D.')
    // Generic: any remaining 2-4 letter all-caps words get spelled out
    // (but skip common words like "IT", "OR", "AN", "AT", "IN", "ON", "TO", "DO", "IF", "IS", "OF", "SO", "UP", "US", "WE")
    .replace(/\b([A-Z]{2,4})\b/g, function(match) {
      var skip = ['IT','OR','AN','AT','IN','ON','TO','DO','IF','IS','OF','SO','UP','US','WE','NO','BY','BE','HE','ME','MY','OK'];
      if (skip.indexOf(match) !== -1) return match;
      // Check if it's already been spelled out (contains periods)
      if (match.indexOf('.') !== -1) return match;
      return match.split('').join('.') + '.';
    })

    // ── Mathematical notation ──
    // Subscript unicode characters to spoken form
    .replace(/[\u2080-\u2089]/g, function(c) {
      return ' sub ' + (c.charCodeAt(0) - 0x2080);
    })
    // Superscript unicode characters
    .replace(/[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]/g, function(c) {
      var map = {'\u2070':'0','\u00B9':'1','\u00B2':'2','\u00B3':'3','\u2074':'4','\u2075':'5','\u2076':'6','\u2077':'7','\u2078':'8','\u2079':'9'};
      return ' to the power of ' + (map[c] || '');
    })
    // Common math symbols
    .replace(/\u2264/g, ' less than or equal to ')
    .replace(/\u2265/g, ' greater than or equal to ')
    .replace(/\u2260/g, ' not equal to ')
    .replace(/\u2248/g, ' approximately ')
    .replace(/\u221E/g, ' infinity ')
    .replace(/\u2208/g, ' in ')
    .replace(/\u2209/g, ' not in ')
    .replace(/\u2282/g, ' subset of ')
    .replace(/\u222A/g, ' union ')
    .replace(/\u2229/g, ' intersection ')
    // Italic math letters (common in formal CS/math writing)
    .replace(/\u{1D434}/gu, 'E').replace(/\u{1D456}/gu, 'i')
    // Spoken math: "2.0x" becomes "2.0 times", "E_i" becomes "E sub i"
    .replace(/(\d+\.?\d*)x\b/g, '$1 times')
    .replace(/([A-Za-z])_([A-Za-z0-9])/g, '$1 sub $2')
    .replace(/([A-Za-z])\^([A-Za-z0-9])/g, '$1 to the $2')
    // Epoch notation: "epoch i" and "epoch i+1"
    .replace(/epoch\s*(\d+)\s*\+\s*(\d+)/gi, 'epoch $1 plus $2')

    // ── URLs ──
    .replace(/https?:\/\/[^\s)]+/g, '')
    // Markdown links: keep text, drop URL
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

    // ── Code and markup ──
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]/g, '')
    .replace(/\*{1,3}/g, '')

    // ── Special characters ──
    .replace(/[│┤├┐┘┌└─═]/g, '')
    .replace(/\.{3,}/g, '.')

    // ── Percentage and currency ──
    .replace(/(\d+)\s*%/g, '$1 percent')
    .replace(/\$(\d[\d,.]*)\s*(trillion|billion|million|thousand|[TBMK])\b/gi, '$1 $2 dollars')
    .replace(/\$(\d[\d,.]*)/g, '$1 dollars')

    // ── Strip non-BMP unicode and unpaired surrogates ──
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/[^\x00-\x7F\xA0-\xFF\u0100-\uFFFF]/g, '')
    // Bold/italic math unicode to ASCII
    .replace(/[\u{1D400}-\u{1D7FF}]/gu, function(c) {
      var cp = c.codePointAt(0);
      if (cp >= 0x1D400 && cp <= 0x1D419) return String.fromCharCode(cp - 0x1D400 + 65);
      if (cp >= 0x1D41A && cp <= 0x1D433) return String.fromCharCode(cp - 0x1D41A + 97);
      if (cp >= 0x1D5D4 && cp <= 0x1D5ED) return String.fromCharCode(cp - 0x1D5D4 + 65);
      if (cp >= 0x1D5EE && cp <= 0x1D607) return String.fromCharCode(cp - 0x1D5EE + 97);
      return '';
    })

    // ── Final cleanup ──
    .replace(/\s+/g, ' ')
    .trim();
}

async function generateChunkAudio(text, voice) {
  const useVoice = voice || VOICE_ID;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${useVoice}`, {
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
    await execFileAsync('ffmpeg', ['-i', filepath, '-acodec', 'libmp3lame', '-b:a', '192k', '-y', tempPath]);
    const stat = await fs.stat(tempPath);
    if (stat.size > 0) {
      await fs.rename(tempPath, filepath);
      console.log('Re-encoded MP3 for correct duration:', filepath);
    } else {
      await fs.unlink(tempPath).catch(() => {});
      console.log('Re-encode produced empty file, keeping original');
    }
  } catch (err) {
    await fs.unlink(tempPath).catch(() => {});
    console.error('MP3 re-encode failed (non-fatal):', err.message);
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

async function generateAudio(postId, text, metadata = {}, voiceOverride = null) {
  const hash = hashText(text + (voiceOverride || ''));
  const filename = getFilename(postId, hash);
  const filepath = path.join(AUDIO_DIR, filename);

  if (await fileExists(filepath)) {
    return { url: `${BASE_URL}/audio/${filename}`, cached: true };
  }

  const chunks = chunkText(text);
  const voice = voiceOverride || VOICE_ID;
  console.log(`Generating audio for "${postId}": ${chunks.length} chunk(s), ${text.length} chars, voice: ${voice}`);

  const audioBuffers = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkHash = hashText(chunks[i]);
    const chunkFile = path.join(CHUNKS_DIR, `${postId}_${hash}_chunk${i}_${chunkHash}.mp3`);

    if (await fileExists(chunkFile)) {
      console.log(`  Chunk ${i + 1}/${chunks.length}: cached`);
      audioBuffers.push(await fs.readFile(chunkFile));
    } else {
      console.log(`  Chunk ${i + 1}/${chunks.length}: generating (${chunks[i].length} chars)`);
      const buffer = await generateChunkAudio(chunks[i], voice);
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
    const activeMap = await loadActiveMap();

    if (activeMap[postId]) {
      const filepath = path.join(AUDIO_DIR, activeMap[postId]);
      if (await fileExists(filepath)) {
        return res.json({ exists: true, url: `${BASE_URL}/audio/${activeMap[postId]}` });
      }
    }

    const files = await fs.readdir(AUDIO_DIR);
    const match = files.find(f => f.startsWith(`${postId}_`) && f.endsWith('.mp3'));
    if (match) {
      return res.json({ exists: true, url: `${BASE_URL}/audio/${match}` });
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

app.get('/api/narration/:postId/auto-generate', adminAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const voiceOverride = req.query.voice || null;

    const files = await fs.readdir(AUDIO_DIR);
    const existing = files.find(f => f.startsWith(`${postId}_`) && f.endsWith('.mp3'));
    if (existing && !voiceOverride) {
      return res.json({
        status: 'already_cached',
        url: `${BASE_URL}/audio/${existing}`,
        slug: postId
      });
    }

    console.log(`Auto-generating audio for: ${postId}` + (voiceOverride ? ` (voice: ${voiceOverride})` : ''));
    const text = await fetchArticleText(postId);
    const metadata = await fetchArticleMetadata(postId);
    console.log(`Extracted ${text.length} chars, title: "${metadata.title}"`);

    const result = await generateAudio(postId, text, metadata, voiceOverride);

    res.json({
      status: result.cached ? 'already_cached' : 'generated',
      url: result.url,
      slug: postId,
      textLength: text.length,
      voice: voiceOverride || VOICE_ID
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

app.get('/api/narration/:postId/delete', adminAuth, async (req, res) => {
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

app.get('/api/narration/:postId/versions', async (req, res) => {
  try {
    const { postId } = req.params;
    const files = await fs.readdir(AUDIO_DIR);
    const matches = files.filter(f => f.startsWith(`${postId}_`) && f.endsWith('.mp3'));
    const activeMap = await loadActiveMap();
    const activeFile = activeMap[postId] || null;

    const versions = await Promise.all(matches.map(async (filename) => {
      const filepath = path.join(AUDIO_DIR, filename);
      const stat = await fs.stat(filepath);
      return {
        filename,
        url: `${BASE_URL}/audio/${filename}`,
        size: stat.size,
        created: stat.birthtime || stat.mtime,
        active: filename === activeFile
      };
    }));

    versions.sort((a, b) => new Date(b.created) - new Date(a.created));
    res.json({ versions, activeFile });
  } catch (err) {
    console.error('Versions error:', err);
    res.status(500).json({ error: 'Failed to list versions' });
  }
});

app.post('/api/narration/:postId/set-active', adminAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const { filename } = req.body;
    const filepath = path.join(AUDIO_DIR, filename);

    if (!await fileExists(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const activeMap = await loadActiveMap();
    activeMap[postId] = filename;
    await saveActiveMap(activeMap);

    res.json({ ok: true, active: filename });
  } catch (err) {
    console.error('Set active error:', err);
    res.status(500).json({ error: 'Failed to set active version' });
  }
});

app.post('/api/narration/:postId/delete-version', adminAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const { filename } = req.body;
    const filepath = path.join(AUDIO_DIR, filename);

    if (!await fileExists(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    await fs.unlink(filepath);

    const activeMap = await loadActiveMap();
    if (activeMap[postId] === filename) {
      delete activeMap[postId];
      await saveActiveMap(activeMap);
    }

    res.json({ ok: true, deleted: filename });
  } catch (err) {
    console.error('Delete version error:', err);
    res.status(500).json({ error: 'Failed to delete version' });
  }
});

app.get('/api/articles', async (req, res) => {
  try {
    const articles = [];
    const seen = new Set();

    for (const page of ['/blog', '/docs']) {
      const response = await fetch(`${RIALO_BASE}${page}`);
      if (!response.ok) continue;
      const html = await response.text();

      const linkMatches = html.matchAll(/href="https:\/\/www\.rialo\.io\/posts\/([^"]+)"/g);
      for (const m of linkMatches) {
        const slug = m[1].replace(/\/$/, '');
        if (seen.has(slug)) continue;
        seen.add(slug);

        let title = '';
        const titlePattern = new RegExp('href="https://www\\.rialo\\.io/posts/' + slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>[\\s\\S]*?###\\s*([^<\\n]+)', 'i');
        const titleMatch = html.match(titlePattern);
        if (titleMatch) {
          title = titleMatch[1].trim();
        }

        if (!title) {
          const altPattern = new RegExp('<h[23][^>]*>([^<]+)</h[23]>[\\s\\S]{0,500}' + slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          const altMatch = html.match(altPattern);
          if (altMatch) title = altMatch[1].trim();
        }

        if (!title) {
          title = slug.replace(/-/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
        }

        articles.push({ slug, title });
      }
    }

    articles.sort((a, b) => a.title.localeCompare(b.title));
    res.json({ articles });
  } catch (err) {
    console.error('Fetch articles error:', err);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Narration service running on :${PORT}`));
