/**
 * StudyLens AI — Premium TTS API
 * Vercel Serverless Function: /api/tts
 *
 * Uses Google Cloud Text-to-Speech (Neural2 voices — premium quality)
 * Returns MP3 audio + per-word timestamps for karaoke highlighting.
 *
 * ── SETUP ─────────────────────────────────────────────────────────────────────
 * 1. Go to console.cloud.google.com
 * 2. Enable "Cloud Text-to-Speech API"
 * 3. Go to APIs & Services → Credentials → Create API Key
 * 4. In Vercel: Settings → Environment Variables → Add GOOGLE_TTS_KEY
 *
 * ── VOICES USED ───────────────────────────────────────────────────────────────
 *  en → en-IN-Neural2-A  (Indian English, female, ultra-clear)
 *  hi → hi-IN-Neural2-A  (Hindi, female, natural)
 *  bn → bn-IN-Wavenet-A  (Bengali, female, best available)
 *  as → as-IN-Standard-A (Assamese, standard — Neural2 not yet available)
 *
 * ── FREE TIER ─────────────────────────────────────────────────────────────────
 *  Standard voices : 4,000,000 chars/month free
 *  WaveNet voices  : 1,000,000 chars/month free
 *  Neural2 voices  : 1,000,000 chars/month free
 *  (Reset every calendar month)
 */

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

// ── Voice map per language ────────────────────────────────────────────────────
const VOICE_MAP = {
  en: { languageCode: 'en-IN', name: 'en-IN-Neural2-A' },
  hi: { languageCode: 'hi-IN', name: 'hi-IN-Neural2-A' },
  bn: { languageCode: 'bn-IN', name: 'bn-IN-Wavenet-A'  },
  as: { languageCode: 'as-IN', name: 'as-IN-Standard-A' },
};

// ── CORS headers ──────────────────────────────────────────────────────────────
// Only StudyLens's own pages may call this from a browser (same-site calls need no header)
function cors(res, req) {
  const origin = String(req?.headers?.origin || '');
  if (/^https:\/\/studylens[a-z0-9-]*\.vercel\.app$/i.test(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// A few read-alouds a minute per visitor (protects the free voice quota)
const recent = new Map();
function tooMany(ip) {
  const now = Date.now(), rec = recent.get(ip) || { n: 0, t: now };
  if (recent.size > 5000) recent.clear();
  if (now - rec.t > 60_000) { recent.set(ip, { n: 1, t: now }); return false; }
  rec.n++; recent.set(ip, rec);
  return rec.n > 10;
}

// Word timings: Google returns them only for <mark/> tags in SSML, and one
// request takes at most 5,000 bytes, so long answers go in a few parts.
const xmlEsc = w => w.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
function ssmlParts(words, maxBytes = 4700, maxParts = 6) {
  const parts = []; let cur = '', bytes = 0;
  words.forEach((w, i) => {
    const piece = `<mark name="${i}"/>${xmlEsc(w)} `, b = Buffer.byteLength(piece);
    if (cur && bytes + b > maxBytes - 40) { parts.push(cur); cur = ''; bytes = 0; }
    cur += piece; bytes += b;
  });
  if (cur) parts.push(cur);
  return parts.slice(0, maxParts).map(p => `<speak>${p}<mark name="end"/></speak>`);
}

// ── Strip markdown so the voice reads clean text ──────────────────────────────
function cleanForSpeech(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')   // bold
    .replace(/\*(.*?)\*/g,     '$1')   // italic
    .replace(/#{1,6}\s/g,      '')     // headings
    .replace(/`{1,3}[^`]*`{1,3}/g,    '') // code
    .replace(/💡|🔹|🔸|•/g,   '. ')  // emoji → pause
    .replace(/\n{2,}/g,        '. ')  // paragraph breaks → pause
    .replace(/\n/g,            ' ')   // single newlines
    .replace(/\s{2,}/g,        ' ')   // double spaces
    .trim()
    .replace(/^([\s\S]{0,4500})\s[\s\S]*$/, (all, head) => all.length > 4500 ? head : all)   // a long answer stops at a whole word
    .slice(0, 4500);                   // safety limit (well within free tier)
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { text, lang = 'en' } = req.body || {};
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (tooMany(ip)) return res.status(429).json({ error: 'busy' });   // the app falls back to the phone's own voice

  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'No text provided' });
  }

  const apiKey = process.env.GOOGLE_TTS_KEY;
  if (!apiKey) {
    // No key configured — tell frontend to use browser fallback
    return res.status(503).json({ error: 'no_key' });
  }

  const voice     = VOICE_MAP[lang] || VOICE_MAP['en'];
  const cleanText = cleanForSpeech(text);

  try {
    const inputWords = cleanText.split(/\s+/).filter(Boolean);
    const speakPart = async (ssml) => {
      const r = await fetch(`https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          input: { ssml },
          voice,
          enableTimePointing: ['SSML_MARK'],   // per-word times for the highlight bar
          audioConfig: {
            audioEncoding:    'MP3',
            speakingRate:     0.90,      // slightly slower = clearer for students
            pitch:            0.0,
            volumeGainDb:     1.0,
            effectsProfileId: ['headphone-class-device'],
          },
        }),
      });
      const data = await r.json();
      if (data.error) throw Object.assign(new Error(data.error.message || 'TTS failed'), { google: data.error });
      return data;
    };

    const results = await Promise.all(ssmlParts(inputWords).map(speakPart));

    // The MP3 parts play back to back; each part's word times move by the parts before it
    let offset = 0;
    const words = [], audio = [];
    for (const data of results) {
      audio.push(Buffer.from(data.audioContent || '', 'base64'));
      let end = offset;
      for (const tp of data.timepoints || []) {
        const t = offset + (tp.timeSeconds || 0);
        if (tp.markName === 'end') { end = t; continue; }
        const word = inputWords[parseInt(tp.markName, 10)];
        if (word) words.push({ word, time: t });
      }
      offset = Math.max(end, offset) + 0.05;
    }

    return res.status(200).json({
      audioBase64: Buffer.concat(audio).toString('base64'),  // MP3
      words,                                                 // [{word, time}] for the highlight bar
    });

  } catch (err) {
    console.error('[TTS] Error:', err.google || err.message);
    return res.status(500).json({ error: 'TTS request failed' });
  }
}
