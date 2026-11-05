/**
 * StudyLens AI — Admin API
 * Vercel Serverless Function: /api/admin
 *
 * Every request carries the Firebase ID token of the signed-in admin in the
 * Authorization header. Google verifies the token, and only ADMIN_EMAIL gets in.
 *
 * POST { action }:
 *   'stats'    overall usage
 *   'history'  recent questions, without answers (paginated)
 *   'entry'    one question with its answer and photo link
 *   'users'    all accounts with their question counts
 *   'images'   stored photos with 15-minute signed links
 *   'kv'       API key rotation state
 *
 * Needs FIREBASE_SERVICE_ACCOUNT in Vercel. Optional: FIREBASE_STORAGE_BUCKET.
 */

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

const ADMIN_EMAIL = 'balveerdj@gmail.com';
const FIREBASE_WEB_KEY = 'AIzaSyCKINcYZ9RVKyK6rfkozVQXjoMVbH5G6zU';   // public by design: identifies the project
const SCAN_PAGE = 1000, SCAN_MAX = 5000, SCAN_CACHE_MS = 60_000;
const HISTORY_FIELDS = ['id', 'ts', 'mode', 'question', 'subject', 'className', 'imageStorageUrl'];

// Google checks the token's signature and expiry; this checks who it belongs to.
async function requireAdmin(req) {
  const idToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!idToken) return { status: 401, error: 'Please sign in.' };
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
  });
  if (!r.ok) return { status: 401, error: 'Your session has expired. Please sign in again.' };
  const user = (await r.json()).users?.[0];
  if (!user || !user.emailVerified || String(user.email).toLowerCase() !== ADMIN_EMAIL) {
    return { status: 403, error: 'This account does not have admin access.' };
  }
  return null;
}

// ── Firestore via REST API ────────────────────────────────────────────────────
async function firestoreRequest(path, method = 'GET', body = null) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!serviceAccount.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT not configured');

  const token = await getFirebaseToken(serviceAccount);
  const projectId = serviceAccount.project_id;
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

  const res = await fetch(`${baseUrl}/${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Firestore error ${res.status}: ${err}`);
  }
  return res.json();
}

// ── Every question in the project, wherever it lives ──────────────────
// Students have no users/{uid} document of their own, and family profiles keep
// history one level deeper, so this reads all 'history' collections directly.
let scanCache = null, scanCacheAt = 0;
async function scanHistory(fresh) {
  if (!fresh && scanCache && Date.now() - scanCacheAt < SCAN_CACHE_MS) return scanCache;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!sa.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT not configured');
  const token = await getFirebaseToken(sa);
  const root = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
  const entries = [];
  let last = null, capped = false;
  for (;;) {
    const structuredQuery = {
      from: [{ collectionId: 'history', allDescendants: true }],
      select: { fields: HISTORY_FIELDS.map(fieldPath => ({ fieldPath })) },
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: SCAN_PAGE,
      ...(last ? { startAt: { values: [{ referenceValue: last }], before: false } } : {}),
    };
    const r = await fetch(`${root}:runQuery`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery }),
    });
    if (!r.ok) throw new Error(`Firestore error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const docs = (await r.json()).filter(row => row.document).map(row => row.document);
    for (const doc of docs) {
      const path = doc.name.split('/documents/')[1];
      entries.push({ ...parseDoc(doc), path, uid: path.split('/')[1] });
    }
    if (docs.length < SCAN_PAGE) break;
    last = docs[docs.length - 1].name;
    if (entries.length >= SCAN_MAX) { capped = true; break; }
  }
  entries.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  scanCache = { entries: dropPhotoCopies(entries), capped };
  scanCacheAt = Date.now();
  return scanCache;
}

// A photo question is saved twice, by the app and by the server that stores the
// image. Count it once, and keep the copy that knows about the image.
function dropPhotoCopies(entries) {
  const seen = new Map(), out = [];
  for (const e of entries) {
    if (e.mode !== 'photo') { out.push(e); continue; }
    const key = `${e.uid}|${e.subject}|${e.question}`, twin = seen.get(key);
    if (twin && Math.abs((twin.ts || 0) - (e.ts || 0)) < 120_000) {
      if (e.imageStorageUrl && !twin.imageStorageUrl) twin.imageStorageUrl = e.imageStorageUrl;
      continue;
    }
    seen.set(key, e);
    out.push(e);
  }
  return out;
}

// All sign-ups from Firebase Authentication.
async function listAccounts() {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  const token = await getFirebaseToken(sa);
  const accounts = [];
  let pageToken = '';
  do {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:batchGet?maxResults=500${pageToken ? `&nextPageToken=${encodeURIComponent(pageToken)}` : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`Accounts error ${r.status}`);
    const data = await r.json();
    accounts.push(...(data.users || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return accounts;
}

// Newer Firebase projects use .firebasestorage.app, older ones .appspot.com.
function storageBuckets(sa) {
  return [process.env.FIREBASE_STORAGE_BUCKET, `${sa.project_id}.firebasestorage.app`, `${sa.project_id}.appspot.com`].filter(Boolean);
}

// ── Get Firebase access token using service account JWT ──────────────────────
let cachedToken = null, cachedTokenUntil = 0;
async function getFirebaseToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedTokenUntil) return cachedToken;   // one sign-in serves every call
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/devstorage.read_only https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/identitytoolkit',
  };

  const encode = obj => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const toSign = `${encode(header)}.${encode(payload)}`;

  const keyData = sa.private_key.replace(/\\n/g, '\n');
  const pemBody = keyData.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(toSign)
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${toSign}.${sigB64}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Could not get Firebase token: ' + JSON.stringify(tokenData));
  cachedToken = tokenData.access_token;
  cachedTokenUntil = now + 3000;
  return cachedToken;
}

// ── Parse Firestore document fields into plain JS object ─────────────────────
function parseDoc(doc) {
  if (!doc || !doc.fields) return {};
  const result = {};
  for (const [key, val] of Object.entries(doc.fields)) {
    if (val.stringValue !== undefined)    result[key] = val.stringValue;
    else if (val.integerValue !== undefined) result[key] = parseInt(val.integerValue);
    else if (val.doubleValue !== undefined)  result[key] = val.doubleValue;
    else if (val.booleanValue !== undefined) result[key] = val.booleanValue;
    else if (val.timestampValue !== undefined) result[key] = val.timestampValue;
    else if (val.mapValue !== undefined)   result[key] = parseDoc(val.mapValue);
    else if (val.arrayValue !== undefined) result[key] = (val.arrayValue.values || []).map(v => parseDoc({ fields: { _: v } })._);
    else result[key] = null;
  }
  return result;
}

// ── Get Upstash KV state ──────────────────────────────────────────────────────
async function getKVState() {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/studylens:rotations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch (e) {
    return null;
  }
}

// ── Generate a V4 Signed URL for a private Firebase Storage object ─────────────
async function generateSignedUrl(sa, bucket, objectName, expiresInSeconds = 900) {
  const serviceEmail = sa.client_email;
  const privateKey   = sa.private_key.replace(/\\n/g, '\n');

  const now          = new Date();
  const dateStamp    = now.toISOString().replace(/[-:]/g, '').slice(0, 8);
  const dateTimeStamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

  const credentialScope = `${dateStamp}/auto/storage/goog4_request`;
  const credential      = `${serviceEmail}/${credentialScope}`;
  const host            = 'storage.googleapis.com';
  const encodedObject   = objectName.split('/').map(encodeURIComponent).join('/');
  const resourcePath    = `/${bucket}/${encodedObject}`;

  const queryParams = new URLSearchParams({
    'X-Goog-Algorithm':     'GOOG4-RSA-SHA256',
    'X-Goog-Credential':    credential,
    'X-Goog-Date':          dateTimeStamp,
    'X-Goog-Expires':       String(expiresInSeconds),
    'X-Goog-SignedHeaders': 'host',
  });
  const canonicalQueryString = queryParams.toString();

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders    = 'host';

  const canonicalRequest = [
    'GET',
    resourcePath,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const encoder    = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalRequest));
  const hashHex    = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

  const stringToSign = [
    'GOOG4-RSA-SHA256',
    dateTimeStamp,
    credentialScope,
    hashHex,
  ].join('\n');

  const pemBody   = privateKey.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    encoder.encode(stringToSign)
  );
  const sigHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');

  return `https://${host}${resourcePath}?${canonicalQueryString}&X-Goog-Signature=${sigHex}`;
}

// ── List images from Firebase Storage ───────────────────────────
async function listStorageImages(sa, maxResults = 60) {
  if (!sa.project_id) return { images: [], problem: 'FIREBASE_SERVICE_ACCOUNT not configured' };
  const token = await getFirebaseToken(sa);
  let bucket = null, data = null, status = 0;
  for (const name of storageBuckets(sa)) {
    const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(name)}/o?prefix=question-images/&maxResults=500`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    status = r.status;
    if (r.ok) { bucket = name; data = await r.json(); break; }
  }
  if (!bucket) {
    return { images: [], problem: status === 404
      ? 'No Firebase Storage bucket exists for this project, so question photos cannot be saved yet.'
      : `Firebase Storage refused the request (${status}).` };
  }

  // Storage keeps only the file: the question record says who sent it and for what subject.
  const { entries } = await scanHistory();
  const byFile = new Map(entries.filter(e => e.imageStorageUrl).map(e => [e.imageStorageUrl.split('/').pop(), e]));
  const items = (data.items || []).sort((a, b) => String(b.timeCreated).localeCompare(String(a.timeCreated))).slice(0, maxResults);
  const images = await Promise.all(items.map(async item => {
    const file = item.name.split('/').pop(), entry = byFile.get(file);
    return {
      name: item.name, created: item.timeCreated, size: parseInt(item.size),
      uid: entry?.uid || file.split('_')[0], subject: entry?.subject || '', className: entry?.className || '',
      url: await generateSignedUrl(sa, bucket, item.name, 900),
    };
  }));
  return { images, bucket };
}

// ── Main Handler ──────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const refused = await requireAdmin(req);
    if (refused) return res.status(refused.status).json({ error: refused.error });

    const { action, path, fresh, limit = 50, offset = 0 } = req.body || {};
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

    switch (action) {

      case 'users': {
        const { entries } = await scanHistory(fresh);
        const counts = new Map();
        for (const e of entries) {
          const c = counts.get(e.uid) || { questions: 0, photos: 0, last: 0 };
          c.questions++;
          if (e.mode === 'photo') c.photos++;
          c.last = Math.max(c.last, e.ts || 0);
          counts.set(e.uid, c);
        }
        let accounts = [], accountsProblem = null;
        try { accounts = await listAccounts(); } catch (e) { accountsProblem = e.message; }
        const known = new Set(accounts.map(a => a.localId));
        const users = accounts.map(a => {
          const c = counts.get(a.localId);
          return {
            uid: a.localId, name: a.displayName || '', email: a.email || '', photo: a.photoUrl || '',
            joined: Number(a.createdAt) || 0, lastLogin: Number(a.lastLoginAt) || 0,
            historyCount: c?.questions || 0, photoCount: c?.photos || 0, lastSeen: c?.last || 0,
          };
        });
        for (const [uid, c] of counts) {
          if (!known.has(uid)) users.push({ uid, name: '', email: '', historyCount: c.questions, photoCount: c.photos, lastSeen: c.last });
        }
        return res.status(200).json({ users, accountsProblem });
      }

      case 'history': {
        const { entries, capped } = await scanHistory(fresh);
        return res.status(200).json({
          total: entries.length, capped,
          entries: entries.slice(offset, offset + limit).map(e => ({
            path: e.path, uid: e.uid, id: e.id, ts: e.ts, mode: e.mode,
            question: (e.question || '').slice(0, 160), subject: e.subject || '',
            className: e.className || '', hasImage: !!e.imageStorageUrl,
          })),
        });
      }

      // One question in full, read only when it is opened.
      case 'entry': {
        if (!/^users\/[^/]+\/(profiles\/[^/]+\/)?history\/[^/]+$/.test(String(path))) {
          return res.status(400).json({ error: 'Invalid entry.' });
        }
        const e = parseDoc(await firestoreRequest(path.split('/').map(encodeURIComponent).join('/')));
        let imageUrl = null;
        const file = /^https:\/\/storage\.googleapis\.com\/([^/]+)\/(.+)$/.exec(e.imageStorageUrl || '');
        if (file) { try { imageUrl = await generateSignedUrl(serviceAccount, file[1], decodeURIComponent(file[2]), 900); } catch (_) {} }
        return res.status(200).json({ question: e.question || '', answer: e.answer || '', imageUrl });
      }

      case 'stats': {
        const { entries, capped } = await scanHistory(fresh);
        const subjectCounts = {}, classCounts = {}, dailyCounts = {};
        let totalPhotoQ = 0, totalTextQ = 0;
        for (const e of entries) {
          if (e.mode === 'photo') totalPhotoQ++; else totalTextQ++;
          if (e.subject) subjectCounts[e.subject] = (subjectCounts[e.subject] || 0) + 1;
          if (e.className) classCounts[e.className] = (classCounts[e.className] || 0) + 1;
          if (e.ts) {
            const day = new Date(e.ts).toISOString().slice(0, 10);
            dailyCounts[day] = (dailyCounts[day] || 0) + 1;
          }
        }
        let totalUsers = new Set(entries.map(e => e.uid)).size;
        try { totalUsers = (await listAccounts()).length; } catch (_) {}
        return res.status(200).json({
          totalUsers, totalQuestions: entries.length, totalPhotoQ, totalTextQ, capped,
          topSubjects: Object.entries(subjectCounts).sort((a, b) => b[1] - a[1]).slice(0, 10),
          topClasses:  Object.entries(classCounts).sort((a, b) => b[1] - a[1]).slice(0, 10),
          recentDays:  Object.entries(dailyCounts).sort((a, b) => (a[0] > b[0] ? -1 : 1)).slice(0, 14),
          kvState: await getKVState(),
        });
      }

      case 'images':
        return res.status(200).json(await listStorageImages(serviceAccount, limit));

      case 'kv':
        return res.status(200).json({ kvState: await getKVState() });

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    console.error('[Admin API Error]', e);
    return res.status(500).json({ error: e.message });
  }
}
