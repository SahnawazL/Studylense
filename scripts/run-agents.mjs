// Wakes the StudyLens agents, then sends whatever email they have queued.
// Called by .github/workflows/agents.yml. The server checks the signature on each
// call against Google's published keys for the project's service account.
import crypto from 'node:crypto';

const APP = process.env.APP_URL || 'https://studylens-ai-gamma.vercel.app';
const sa = JSON.parse(process.env.SA_JSON || '{}');
if (!sa.private_key) { console.error('::error::FIREBASE_SERVICE_ACCOUNT is missing'); process.exit(1); }

const b64 = v => Buffer.from(v).toString('base64url');
function ticket() {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }))}.${b64(JSON.stringify({ iss: sa.client_email, aud: 'studylens-agents', iat: now, exp: now + 300 }))}`;
  return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), sa.private_key.replace(/\\n/g, '\n')).toString('base64url')}`;
}
async function call(body) {
  const r = await fetch(`${APP}/api/admin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Agent ${ticket()}` }, body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${body.action} ${body.agent || ''}: ${r.status} ${data.error || ''}`);
  return data;
}

const plan = { watch: ['watchdog', 'reviewer'], daily: ['quality', 'digest'] }[process.env.TASK] || ['watchdog', 'reviewer'];
let failed = 0;
for (const agent of plan) {
  try { console.log(agent, JSON.stringify(await call({ action: 'agents', agent }))); }
  catch (e) { failed++; console.error(`::error::${e.message}`); }
}

const { mail = [] } = await call({ action: 'outbox' });
console.log('emails waiting:', mail.length);
if (mail.length) {
  const user = process.env.GMAIL_USER, pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
  if (!user || !pass) {
    console.log('::warning::Add the GMAIL_USER and GMAIL_APP_PASSWORD secrets to send email. Emails stay queued.');
    await call({ action: 'mailResult', ok: false, error: 'Email secrets are not set.' });
  } else {
    try {
      const { default: nodemailer } = await import('nodemailer');
      const smtp = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
      for (const m of mail) await smtp.sendMail({ from: `StudyLens Agents <${user}>`, to: process.env.REPORT_EMAIL || user, subject: m.subject, html: m.html });
      await call({ action: 'mailResult', ok: true, count: mail.length });
      console.log('emails sent:', mail.length);
    } catch (e) {
      failed++;
      console.error('::error::Email failed:', e.message);
      await call({ action: 'mailResult', ok: false, error: 'Gmail refused the login. Check the app password.' });
    }
  }
}
process.exit(failed ? 1 : 0);
