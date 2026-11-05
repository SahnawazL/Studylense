// Publishes firestore.rules and storage.rules through the Firebase Rules API.
// Firebase checks each file compiles first, so a broken file changes nothing.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const sa = JSON.parse(process.env.SA_JSON || '{}');
const project = sa.project_id;
if (!project) { console.error('::error::FIREBASE_SERVICE_ACCOUNT is missing or is not valid JSON'); process.exit(1); }

const b64 = v => Buffer.from(v).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify({
  iss: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase',
}))}`;
const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key.replace(/\\n/g, '\n')).toString('base64url');
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${signature}`,
});
const { access_token: token } = await tokenRes.json();
if (!token) { console.error('::error::Google refused the service account key'); process.exit(1); }

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const rulesApi = `https://firebaserules.googleapis.com/v1/projects/${project}`;

async function publish(file, releaseId) {
  const made = await fetch(`${rulesApi}/rulesets`, {
    method: 'POST', headers,
    body: JSON.stringify({ source: { files: [{ name: file, content: readFileSync(file, 'utf8') }] } }),
  });
  if (!made.ok) throw new Error(`${file} was not accepted (${made.status}): ${(await made.text()).slice(0, 300)}`);
  const { name: rulesetName } = await made.json();

  const name = `projects/${project}/releases/${releaseId}`;
  const before = await fetch(`${rulesApi}/releases/${releaseId}`, { headers });
  const previous = before.ok ? (await before.json()).rulesetName : 'none';
  const released = before.ok
    ? await fetch(`${rulesApi}/releases/${releaseId}`, { method: 'PATCH', headers, body: JSON.stringify({ release: { name, rulesetName } }) })
    : await fetch(`${rulesApi}/releases`, { method: 'POST', headers, body: JSON.stringify({ name, rulesetName }) });
  if (!released.ok) throw new Error(`${releaseId} was not released (${released.status}): ${(await released.text()).slice(0, 300)}`);
  console.log(`Published ${file}. Previous version: ${previous}`);
}

await publish('firestore.rules', 'cloud.firestore');

// Storage rules need a bucket. Report what exists either way.
let bucket = null;
for (const name of [`${project}.firebasestorage.app`, `${project}.appspot.com`]) {
  const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${name}`, { headers });
  console.log(`Bucket ${name}: ${r.status}`);
  if (r.ok && !bucket) bucket = name;
}
if (bucket) await publish('storage.rules', `firebase.storage/${bucket}`);
else console.log('::warning::No storage bucket yet, so storage.rules was not published. Firestore rules are live.');
