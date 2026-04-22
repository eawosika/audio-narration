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
const SPOTIFY_MAP_PATH = path.join(AUDIO_DIR, '.spotify.json');
const VOICE_META_PATH = path.join(AUDIO_DIR, '.voice-meta.json');
const JOBS_PATH = path.join(AUDIO_DIR, '.jobs.json');

async function loadVoiceMeta() {
  try { return JSON.parse(await fs.readFile(VOICE_META_PATH, 'utf8')); } catch { return {}; }
}
async function saveVoiceMeta(map) {
  await fs.writeFile(VOICE_META_PATH, JSON.stringify(map, null, 2));
}

// Persistent job store — survives Railway restarts
const jobs = {};

async function loadJobs() {
  try {
    const data = JSON.parse(await fs.readFile(JOBS_PATH, 'utf8'));
    // Only restore terminal states (done/error) — running jobs didn't survive restart
    for (const [key, job] of Object.entries(data)) {
      if (job.status === 'done' || job.status === 'error') {
        jobs[key] = job;
      }
    }
    console.log(`Loaded ${Object.keys(jobs).length} persisted jobs`);
  } catch { /* no jobs file yet, that's fine */ }
}

async function persistJob(jobKey, job) {
  try {
    jobs[jobKey] = job;
    // Read existing, merge, write back
    let existing = {};
    try { existing = JSON.parse(await fs.readFile(JOBS_PATH, 'utf8')); } catch {}
    existing[jobKey] = job;
    await fs.writeFile(JOBS_PATH, JSON.stringify(existing, null, 2));
  } catch (e) {
    console.error('Failed to persist job:', e.message);
  }
}

async function loadActiveMap() {
  try {
    const data = await fs.readFile(ACTIVE_MAP_PATH, 'utf8');
    return JSON.parse(data);
  } catch { return {}; }
}

async function saveActiveMap(map) {
  await fs.writeFile(ACTIVE_MAP_PATH, JSON.stringify(map, null, 2));
}

async function loadSpotifyMap() {
  try {
    const data = await fs.readFile(SPOTIFY_MAP_PATH, 'utf8');
    return JSON.parse(data);
  } catch { return {}; }
}

async function saveSpotifyMap(map) {
  await fs.writeFile(SPOTIFY_MAP_PATH, JSON.stringify(map, null, 2));
}

const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : `http://localhost:${process.env.PORT || 3001}`;

const RIALO_BASE = 'https://www.rialo.io';

await fs.mkdir(AUDIO_DIR, { recursive: true });
await fs.mkdir(CHUNKS_DIR, { recursive: true });
await loadJobs();

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
    // ── HTML entities ──
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')

    // ── Footnotes ──
    .replace(/\[\d+\]/g, '')
    .replace(/¹/g, '').replace(/²/g, '').replace(/³/g, '')
    .replace(/↩/g, '')
    .replace(/↩/g, '')
    .replace(/Footnotes[\s\S]*$/i, '')
    .replace(/\)\s+\d+\b/g, ')')
    .replace(/\b(A\.P\.I\.s?|API)\s+\d+\b/g, '$1')

    // ── Section headers as pauses ──
    .replace(/([.!?])\s*(#{1,6}\s)/g, '$1\n\n.\n\n$2')
    .replace(/\n([A-Z][A-Za-z0-9 :,'\-]{5,80})\n/g, '\n\n.\n\n$1.\n\n')

    // ── Acronyms and abbreviations ──
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
    .replace(/\b([A-Z]{2,4})\b/g, function(match) {
      var skip = ['IT','OR','AN','AT','IN','ON','TO','DO','IF','IS','OF','SO','UP','US','WE','NO','BY','BE','HE','ME','MY','OK','ATM','CEO','CFO','CTO'];
      if (skip.indexOf(match) !== -1) return match;
      if (match.indexOf('.') !== -1) return match;
      return match.split('').join('.') + '.';
    })

    // ── Mathematical notation ──
    .replace(/Σ/g, 'sum of ').replace(/σ/g, 'sigma ')
    .replace(/λ/g, 'lambda ').replace(/Λ/g, 'Lambda ')
    .replace(/α/g, 'alpha ').replace(/β/g, 'beta ')
    .replace(/γ/g, 'gamma ').replace(/Γ/g, 'Gamma ')
    .replace(/δ/g, 'delta ').replace(/Δ/g, 'Delta ')
    .replace(/ε/g, 'epsilon ').replace(/ζ/g, 'zeta ')
    .replace(/θ/g, 'theta ').replace(/Θ/g, 'Theta ')
    .replace(/μ/g, 'mu ').replace(/π/g, 'pi ')
    .replace(/φ/g, 'phi ').replace(/Φ/g, 'Phi ')
    .replace(/ψ/g, 'psi ').replace(/Ψ/g, 'Psi ')
    .replace(/ω/g, 'omega ').replace(/Ω/g, 'Omega ')

    .replace(/[\u{1D400}-\u{1D7FF}]/gu, function(c) {
      var cp = c.codePointAt(0);
      if (cp >= 0x1D400 && cp <= 0x1D419) return String.fromCharCode(cp - 0x1D400 + 65);
      if (cp >= 0x1D41A && cp <= 0x1D433) return String.fromCharCode(cp - 0x1D41A + 97);
      if (cp >= 0x1D434 && cp <= 0x1D44D) return String.fromCharCode(cp - 0x1D434 + 65);
      if (cp >= 0x1D44E && cp <= 0x1D467) return String.fromCharCode(cp - 0x1D44E + 97);
      if (cp >= 0x1D468 && cp <= 0x1D481) return String.fromCharCode(cp - 0x1D468 + 65);
      if (cp >= 0x1D482 && cp <= 0x1D49B) return String.fromCharCode(cp - 0x1D482 + 97);
      if (cp >= 0x1D49C && cp <= 0x1D4B5) return String.fromCharCode(cp - 0x1D49C + 65);
      if (cp >= 0x1D4B6 && cp <= 0x1D4CF) return String.fromCharCode(cp - 0x1D4B6 + 97);
      if (cp >= 0x1D5D4 && cp <= 0x1D5ED) return String.fromCharCode(cp - 0x1D5D4 + 65);
      if (cp >= 0x1D5EE && cp <= 0x1D607) return String.fromCharCode(cp - 0x1D5EE + 97);
      if (cp >= 0x1D7CE && cp <= 0x1D7D7) return String.fromCharCode(cp - 0x1D7CE + 48);
      return '';
    })

    .replace(/[ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ]/g, function(c) {
      var map = {'ᵃ':'a','ᵇ':'b','ᶜ':'c','ᵈ':'d','ᵉ':'e','ᶠ':'f','ᵍ':'g','ʰ':'h','ⁱ':'i','ʲ':'j','ᵏ':'k','ˡ':'l','ᵐ':'m','ⁿ':'n','ᵒ':'o','ᵖ':'p','ʳ':'r','ˢ':'s','ᵗ':'t','ᵘ':'u','ᵛ':'v','ʷ':'w','ˣ':'x','ʸ':'y','ᶻ':'z'};
      return ' to the ' + (map[c] || '');
    })

    .replace(/[₀-₉]/g, function(c) {
      return ' sub ' + (c.charCodeAt(0) - 0x2080);
    })
    .replace(/[ᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥ]/g, function(c) {
      var map = {'ᵢ':'i','ⱼ':'j','ₖ':'k','ₗ':'l','ₘ':'m','ₙ':'n','ₒ':'o','ₚ':'p','ᵣ':'r','ₛ':'s','ₜ':'t','ᵤ':'u','ᵥ':'v'};
      return ' sub ' + (map[c] || '');
    })

    .replace(/[⁰¹²³⁴-⁹]/g, function(c) {
      var map = {'⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9'};
      return ' to the power of ' + (map[c] || '');
    })

    .replace(/≤/g, ' less than or equal to ')
    .replace(/≥/g, ' greater than or equal to ')
    .replace(/≠/g, ' not equal to ')
    .replace(/≈/g, ' approximately ')
    .replace(/∞/g, ' infinity ')
    .replace(/∈/g, ' in ')
    .replace(/∉/g, ' not in ')
    .replace(/⊂/g, ' subset of ')
    .replace(/∪/g, ' union ')
    .replace(/∩/g, ' intersection ')
    .replace(/∑/g, ' sum of ')
    .replace(/∏/g, ' product of ')
    .replace(/∂/g, ' partial ')
    .replace(/∫/g, ' integral of ')
    .replace(/[·•]/g, ' times ')
    .replace(/×/g, ' times ')
    .replace(/÷/g, ' divided by ')
    .replace(/≈/g, ' approximately ')
    .replace(/±/g, ' plus or minus ')
    .replace(/→/g, ' to ')
    .replace(/←/g, ' from ')
    .replace(/⇒/g, ' implies ')
    .replace(/⟹/g, ' implies ')

    .replace(/ℎ/g, 'h')
    .replace(/ℓ/g, 'l')
    .replace(/ℜ/g, 'R')
    .replace(/ℑ/g, 'I')

    .replace(/₊/g, ' plus ')
    .replace(/₋/g, ' minus ')

    .replace(/\b([a-zA-Z])\(([a-zA-Z0-9])\)/g, '$1 of $2')
    .replace(/\.\.\./g, ' and so on ')

    .replace(/(\d+\.?\d*)x\b/g, '$1 times')
    .replace(/([A-Za-z])_([A-Za-z0-9])/g, '$1 sub $2')
    .replace(/([A-Za-z])\^([A-Za-z0-9])/g, '$1 to the $2')
    .replace(/(\d+)-of-(\d+)/g, '$1 of $2')
    .replace(/epoch\s*(\d+)\s*\+\s*(\d+)/gi, 'epoch $1 plus $2')

    // ── URLs ──
    .replace(/https?:\/\/[^\s)]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

    // ── Code and markup ──
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]/g, '')
    .replace(/\*{1,3}/g, '')

    // ── Special characters ──
    .replace(/[│┤├┐┘┌└─═]/g, '')
    .replace(/\.{3,}/g, '.')
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/✨|★|☆|♦|♠|♣|♥/g, '')

    // ── Percentage and currency ──
    .replace(/(\d+)\s*%/g, '$1 percent')
    .replace(/\$(\d[\d,.]*)\s*to\s*\$(\d[\d,.]*)\s*(trillion|billion|million|thousand)\b/gi, '$1 to $2 $3 dollars')
    .replace(/\$(\d[\d,.]*)\s*T\b/gi, '$1 trillion dollars')
    .replace(/\$(\d[\d,.]*)\s*B\b/gi, '$1 billion dollars')
    .replace(/\$(\d[\d,.]*)\s*M\b/gi, '$1 million dollars')
    .replace(/\$(\d[\d,.]*)\s*K\b/gi, '$1 thousand dollars')
    .replace(/\$(\d[\d,.]*)\s*(trillion|billion|million|thousand)\b/gi, '$1 $2 dollars')
    .replace(/\$(\d[\d,.]*)/g, '$1 dollars')
    .replace(/(\d+)\.\s+dollars/g, '$1 dollars')

    // ── Strip non-BMP unicode and unpaired surrogates ──
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/[^\x00-\x7F\xA0-\xFFĀ-￿]/g, '')
    .replace(/[\u{1D400}-\u{1D7FF}]/gu, function(c) {
      var cp = c.codePointAt(0);
      if (cp >= 0x1D400 && cp <= 0x1D419) return String.fromCharCode(cp - 0x1D400 + 65);
      if (cp >= 0x1D41A && cp <= 0x1D433) return String.fromCharCode(cp - 0x1D41A + 97);
      if (cp >= 0x1D5D4 && cp <= 0x1D5ED) return String.fromCharCode(cp - 0x1D5D4 + 65);
      if (cp >= 0x1D5EE && cp <= 0x1D607) return String.fromCharCode(cp - 0x1D5EE + 97);
      return '';
    })

    // ── Fix Webflow italic span artifacts ──
    .replace(/\blaye r\b/g, 'layer')
    .replace(/\blayer s\b/g, 'layers')

    // ── Final cleanup ──
    .replace(/\s+/g, ' ')
    .trim();
}

async function generateChunkAudio(text, voice, retries = 3) {
  const useVoice = voice || VOICE_ID;
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
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
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = attempt * 3000;
        console.warn(`  Chunk attempt ${attempt} failed, retrying in ${delay/1000}s: ${err.message}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
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

  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (titleMatch) {
    title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
  }

  const summaryMatch = html.match(/Summary<\/[^>]+>([\s\S]*?)(?=<(?:h[1-6]|div[^>]*class="[^"]*blog-content))/i);
  if (summaryMatch) {
    summary = summaryMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const imageMatches = html.matchAll(/<img[^>]*src="(https:\/\/cdn\.prod\.website-files\.com\/6883572e6ebf68cfe676dd77\/[^"]+)"[^>]*>/gi);
  for (const m of imageMatches) {
    const src = m[1];
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
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<audio[^>]*>[\s\S]*?<\/audio>/gi, '')
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
      if (endMatch > 0) { content = content.slice(0, endMatch); break; }
    }

    const contentTags = [];
    const tagPattern = /<(p|h[1-6]|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
    let tagMatch;
    while ((tagMatch = tagPattern.exec(content)) !== null) {
      const inner = tagMatch[2]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      if (inner.length > 20) contentTags.push(inner);
    }
    text = contentTags.join(' ')
      .replace(/Listen to this article/gi, '')
      .replace(/Play on Spotify/gi, '')
      .replace(/Download article audio/gi, '')
      .replace(/Share audio/gi, '')
      .replace(/Restart from beginning/gi, '')
      .replace(/Copy header link/gi, '')
      .replace(/Copy link/gi, '')
      .replace(/Explore this article with AI/gi, '')
      .replace(/Rialo Readerbot/gi, '')
      .replace(/Keep reading with AI/gi, '')
      .replace(/Open Readerbot/gi, '')
      .replace(/Ask about this article/gi, '')
      .replace(/Ask AI/gi, '')
      .replace(/Preview on ElevenLabs/gi, '')
      .replace(/\d+:\d+\s*\/\s*\d+:\d+/g, '')
      .replace(/\b\d+:\d+\b/g, '')
      .replace(/(?<!\w)\d+\.?\d*x(?!\w)/gi, '')
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

  text = cleanTextForSpeech(text);

  return text.slice(0, 50000);
}

async function generateAudio(postId, text, metadata = {}, voiceOverride = null, onProgress = null) {
  const hash = hashText(text + (voiceOverride || ''));
  const filename = getFilename(postId, hash);
  const filepath = path.join(AUDIO_DIR, filename);

  if (await fileExists(filepath)) {
    return { url: `${BASE_URL}/audio/${filename}`, cached: true };
  }

  const chunks = chunkText(text);
  const voice = voiceOverride || VOICE_ID;
  console.log(`Generating audio for "${postId}": ${chunks.length} chunk(s), ${text.length} chars, voice: ${voice}`);

  if (onProgress) onProgress(0, chunks.length);

  let completed = 0;
  const audioBuffers = await Promise.all(chunks.map(async (chunk, i) => {
    const chunkHash = hashText(chunk);
    const chunkFile = path.join(CHUNKS_DIR, `${postId}_${hash}_chunk${i}_${chunkHash}.mp3`);
    if (await fileExists(chunkFile)) {
      console.log(`  Chunk ${i + 1}/${chunks.length}: cached`);
      const buf = await fs.readFile(chunkFile);
      completed++;
      if (onProgress) onProgress(completed, chunks.length);
      return buf;
    }
    console.log(`  Chunk ${i + 1}/${chunks.length}: generating (${chunk.length} chars)`);
    const buffer = await generateChunkAudio(chunk, voice);
    await fs.writeFile(chunkFile, buffer);
    completed++;
    if (onProgress) onProgress(completed, chunks.length);
    return buffer;
  }));

  const fullAudio = Buffer.concat(audioBuffers);
  await fs.writeFile(filepath, fullAudio);

  if (chunks.length > 1) {
    await fixMp3Duration(filepath);
  }

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

  try {
    const meta = await loadVoiceMeta();
    meta[filename] = voice;
    await saveVoiceMeta(meta);
  } catch (e) { console.error('Failed to save voice meta:', e.message); }

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
    const activeMap = await loadActiveMap();
    const activeFile = activeMap[postId];
    const existing = activeFile
      ? files.find(f => f === activeFile)
      : files.find(f => f.startsWith(`${postId}_`) && f.endsWith('.mp3'));

    if (existing && !voiceOverride) {
      return res.json({
        status: 'already_cached',
        url: `${BASE_URL}/audio/${existing}`,
        slug: postId
      });
    }

    const jobKey = postId + (voiceOverride || '');
    if (jobs[jobKey] && jobs[jobKey].status === 'running') {
      return res.json({ status: 'running', jobKey });
    }

    const job = { status: 'running', jobKey, startedAt: Date.now() };
    jobs[jobKey] = job;

    res.json({ status: 'started', jobKey });

    (async () => {
      try {
        console.log(`Auto-generating audio for: ${postId}` + (voiceOverride ? ` (voice: ${voiceOverride})` : ''));
        const text = await fetchArticleText(postId);
        const metadata = await fetchArticleMetadata(postId);
        console.log(`Extracted ${text.length} chars, title: "${metadata.title}"`);

        const onProgress = (completed, total) => {
          jobs[jobKey] = { ...jobs[jobKey], completedChunks: completed, totalChunks: total };
        };

        const result = await generateAudio(postId, text, metadata, voiceOverride, onProgress);
        await persistJob(jobKey, {
          status: 'done',
          jobKey,
          url: result.url,
          slug: postId,
          textLength: text.length,
          voice: voiceOverride || VOICE_ID
        });
        console.log(`Job done: ${jobKey}`);
      } catch (err) {
        console.error(`Job failed: ${jobKey}`, err.message);
        await persistJob(jobKey, { status: 'error', jobKey, error: err.message });
      }
    })();
  } catch (err) {
    console.error('Auto-generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/narration/:postId/job-status', adminAuth, (req, res) => {
  const { postId } = req.params;
  const voiceOverride = req.query.voice || null;
  const jobKey = postId + (voiceOverride || '');
  const job = jobs[jobKey];
  if (!job) return res.json({ status: 'not_found' });
  res.json(job);
});

app.get('/api/narration/:postId/download', async (req, res) => {
  try {
    const { postId } = req.params;
    const specificFile = req.query.filename || null;
    const files = await fs.readdir(AUDIO_DIR);

    const match = specificFile
      ? files.find(f => f === specificFile)
      : files.find(f => f.startsWith(`${postId}_`) && f.endsWith('.mp3'));

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

    for (const file of matches) {
      await fs.unlink(path.join(AUDIO_DIR, file));
    }

    const chunkFiles = await fs.readdir(CHUNKS_DIR).catch(() => []);
    const chunkMatches = chunkFiles.filter(f => f.startsWith(`${postId}_`));
    for (const file of chunkMatches) {
      await fs.unlink(path.join(CHUNKS_DIR, file)).catch(() => {});
    }

    const activeMap = await loadActiveMap();
    if (activeMap[postId]) {
      delete activeMap[postId];
      await saveActiveMap(activeMap);
    }

    const voiceMeta = await loadVoiceMeta();
    let voiceMetaChanged = false;
    for (const filename of matches) {
      if (voiceMeta[filename]) { delete voiceMeta[filename]; voiceMetaChanged = true; }
    }
    if (voiceMetaChanged) await saveVoiceMeta(voiceMeta);

    try {
      let jobsFile = {};
      try { jobsFile = JSON.parse(await fs.readFile(JOBS_PATH, 'utf8')); } catch {}
      const jobKeys = Object.keys(jobsFile).filter(k => k.startsWith(postId));
      for (const k of jobKeys) { delete jobsFile[k]; delete jobs[k]; }
      await fs.writeFile(JOBS_PATH, JSON.stringify(jobsFile, null, 2));
    } catch {}

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
    const voiceMeta = await loadVoiceMeta();

    const versions = await Promise.all(matches.map(async (filename) => {
      const filepath = path.join(AUDIO_DIR, filename);
      const stat = await fs.stat(filepath);
      return {
        filename,
        url: `${BASE_URL}/audio/${filename}`,
        size: stat.size,
        created: stat.birthtime || stat.mtime,
        active: filename === activeFile,
        voice: voiceMeta[filename] || null
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

const ARTICLES_CACHE_PATH = path.join(AUDIO_DIR, '.articles.json');

async function loadArticlesCache() {
  try { return JSON.parse(await fs.readFile(ARTICLES_CACHE_PATH, 'utf8')); } catch { return null; }
}

async function saveArticlesCache(articles) {
  try { await fs.writeFile(ARTICLES_CACHE_PATH, JSON.stringify(articles, null, 2)); } catch {}
}

async function scrapeArticles() {
  const seen = new Set();

  for (const page of ['/blog', '/docs']) {
    try {
      const response = await fetch(`${RIALO_BASE}${page}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RialoAudioBot/1.0)', 'Accept': 'text/html' }
      });
      if (!response.ok) continue;
      const html = await response.text();
      const regex = /href="[^"]*\/posts\/([^"#?\/]+)"/gi;
      let match;
      while ((match = regex.exec(html)) !== null) {
        const slug = match[1].trim();
        if (slug) seen.add(slug);
      }
    } catch (err) {
      console.error(`Error scraping ${page}:`, err.message);
    }
  }

  const articles = await Promise.all([...seen].map(async (slug) => {
    const fallback = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    try {
      const res = await fetch(`${RIALO_BASE}/posts/${slug}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RialoAudioBot/1.0)', 'Accept': 'text/html' },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return { slug, title: fallback };
      const html = await res.text();
      const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const title = m ? m[1].replace(/<[^>]+>/g, '').trim() : fallback;
      return { slug, title };
    } catch { return { slug, title: fallback }; }
  }));

  articles.sort((a, b) => a.title.localeCompare(b.title));
  return articles;
}

app.get('/api/articles', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1';

    if (!forceRefresh) {
      const cached = await loadArticlesCache();
      if (cached && cached.length > 0) {
        res.json({ articles: cached, cached: true });
        scrapeArticles().then(fresh => {
          if (fresh.length > 0) saveArticlesCache(fresh);
        }).catch(() => {});
        return;
      }
    }

    const articles = await scrapeArticles();
    if (articles.length > 0) await saveArticlesCache(articles);
    res.json({ articles, cached: false });
  } catch (err) {
    console.error('Articles error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/spotify/:postId', async (req, res) => {
  try {
    const map = await loadSpotifyMap();
    const url = map[req.params.postId] || null;
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/spotify/:postId', adminAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const { url } = req.body;
    const map = await loadSpotifyMap();
    if (url) {
      map[postId] = url;
    } else {
      delete map[postId];
    }
    await saveSpotifyMap(map);
    res.json({ ok: true, url: url || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/spotify', async (req, res) => {
  try {
    const map = await loadSpotifyMap();
    res.json({ spotify: map });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/generate-description', adminAuth, async (req, res) => {
  try {
    const { slug } = req.body;
    if (!slug) return res.status(400).json({ error: 'Missing slug' });

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

    const metadata = await fetchArticleMetadata(slug);
    if (!metadata.title) return res.status(404).json({ error: 'Could not fetch article metadata' });

    const prompt = `Write a Spotify podcast episode description for this article.

Title: ${metadata.title}
Summary: ${metadata.summary || '(not available)'}
Article URL: ${RIALO_BASE}/posts/${slug}

Rules:
- Under 200 words
- Open with the core problem or insight, not "In this episode"
- Write for someone scanning a podcast app, not reading a blog
- Second paragraph gives 2-3 specific topics covered
- Close with a one-sentence CTA pointing to the article
- Tone: serious, precise, editorial
- No em dashes
- No hashtags`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: `Anthropic API error: ${err}` });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    res.json({ description: text });
  } catch (err) {
    console.error('Generate description error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/debug/extract/:postId', adminAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const text = await fetchArticleText(postId);
    res.json({ textLength: text.length, preview: text.slice(0, 500), full: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Narration service running on :${PORT}`));
