// One-time live check of Delete account, using a temporary test account only.
import crypto from 'node:crypto';
const sa = JSON.parse(process.env.SA_JSON), project = sa.project_id, KEY = 'AIzaSyCKINcYZ9RVKyK6rfkozVQXjoMVbH5G6zU';
const b64 = v => Buffer.from(v).toString('base64url');
const sign = claims => { const body = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify(claims))}`; return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), sa.private_key.replace(/\\n/g, '\n')).toString('base64url')}`; };
const now = Math.floor(Date.now() / 1000);
const { access_token: token } = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${sign({ iss: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600, scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/datastore' })}` })).json();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const auth = `https://identitytoolkit.googleapis.com/v1/projects/${project}`, db = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
const made = await (await fetch(`${auth}/accounts`, { method: 'POST', headers, body: JSON.stringify({ displayName: 'Delete test' }) })).json();
const uid = made.localId;
console.log('temporary account created:', !!uid);
const custom = sign({ iss: sa.client_email, sub: sa.client_email, aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit', iat: now, exp: now + 3600, uid });
const signedIn = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) })).json();
await fetch(`${db}/users/${uid}/history/1?updateMask.fieldPaths=question`, { method: 'PATCH', headers, body: JSON.stringify({ fields: { question: { stringValue: 'test' } } }) });
const before = await fetch(`${db}/users/${uid}/history/1`, { headers });
const r = await fetch('https://studylens-ai-gamma.vercel.app/api/admin', { method: 'POST', headers: { Authorization: `Bearer ${signedIn.idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteAccount', reason: 'other' }) });
console.log('delete reply:', r.status, (await r.text()).slice(0, 160));
const after = await fetch(`${db}/users/${uid}/history/1`, { headers });
const lookup = await (await fetch(`${auth}/accounts:lookup`, { method: 'POST', headers, body: JSON.stringify({ localId: [uid] }) })).json();
const accountGone = !lookup.users?.length;
console.log('data before', before.status, 'after', after.status, 'account gone', accountGone);
const list = await (await fetch(`${db}/deletions?pageSize=50`, { headers })).json();
const mine = (list.documents || []).filter(d => Date.now() - Number(d.fields.ts.integerValue) < 120000 && d.fields.reason.stringValue === 'other');
console.log('deletion records found:', mine.length);
for (const d of mine) await fetch(`https://firestore.googleapis.com/v1/${d.name}`, { method: 'DELETE', headers });
if (!accountGone) await fetch(`${auth}/accounts:delete`, { method: 'POST', headers, body: JSON.stringify({ localId: uid }) });
process.exit(r.ok && after.status === 404 && accountGone && mine.length === 1 ? 0 : 1);
