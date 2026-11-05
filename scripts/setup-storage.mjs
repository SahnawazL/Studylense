// One-time: creates the project's default Cloud Storage for Firebase bucket.
import crypto from 'node:crypto';

const sa = JSON.parse(process.env.SA_JSON || '{}'), project = sa.project_id;
const b64 = v => Buffer.from(v).toString('base64url'), now = Math.floor(Date.now() / 1000);
const unsigned = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify({
  iss: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase',
}))}`;
const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key.replace(/\\n/g, '\n')).toString('base64url');
const { access_token: token } = await (await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${signature}`,
})).json();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const api = `https://firebasestorage.googleapis.com/v1beta/projects/${project}`;

const billing = await fetch(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`, { headers });
console.log('Billing check:', billing.status, (await billing.text()).slice(0, 200).replace(/\s+/g, ' '));
const existing = await fetch(`${api}/defaultBucket`, { headers });
console.log('Default bucket now:', existing.status, (await existing.text()).slice(0, 300).replace(/\s+/g, ' '));
if (existing.status === 200) process.exit(0);
const made = await fetch(`${api}/defaultBucket`, { method: 'POST', headers, body: JSON.stringify({ location: process.env.BUCKET_LOCATION || 'US-CENTRAL1', storageClass: 'STANDARD' }) });
console.log('Create result:', made.status, (await made.text()).slice(0, 700).replace(/\s+/g, ' '));
process.exit(made.ok ? 0 : 1);
