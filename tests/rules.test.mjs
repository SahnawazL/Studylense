import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';

const env = await initializeTestEnvironment({
  projectId: 'demo-studylens',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await db.doc('users/u1/history/1').set({ question: 'Q' });
  await db.doc('users/u1/profiles/p1/history/1').set({ question: 'Q' });
  await db.doc('users/u1/bookmarks/data').set({ ids: [] });
  await db.doc('private/x').set({ a: 1 });
});

const owner = env.authenticatedContext('u1', { email: 'student@example.com', email_verified: true }).firestore();
const other = env.authenticatedContext('u2', { email: 'other@example.com', email_verified: true }).firestore();
const admin = env.authenticatedContext('a1', { email: 'balveerdj@gmail.com', email_verified: true }).firestore();
const fake = env.authenticatedContext('a2', { email: 'balveerdj@gmail.com', email_verified: false }).firestore();
const nobody = env.unauthenticatedContext().firestore();

let failed = 0;
const check = async (name, run) => {
  try { await run(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
};
await check('student reads own history', () => assertSucceeds(owner.collection('users/u1/history').get()));
await check('student saves own answer', () => assertSucceeds(owner.doc('users/u1/history/2').set({ question: 'Q' })));
await check('student uses a family profile', () => assertSucceeds(owner.doc('users/u1/profiles/p1/history/2').set({ question: 'Q' })));
await check('student lists profiles', () => assertSucceeds(owner.collection('users/u1/profiles').get()));
await check('student saves bookmarks', () => assertSucceeds(owner.doc('users/u1/profiles/p1/bookmarks/data').set({ ids: [1] })));
await check('student clears own history', () => assertSucceeds(owner.doc('users/u1/history/2').delete()));
await check('another student cannot read', () => assertFails(other.doc('users/u1/history/1').get()));
await check('another student cannot write', () => assertFails(other.doc('users/u1/history/9').set({ a: 1 })));
await check('signed-out visitor cannot read', () => assertFails(nobody.doc('users/u1/history/1').get()));
await check('admin can read any student', () => assertSucceeds(admin.doc('users/u1/profiles/p1/history/1').get()));
await check('admin cannot change student data', () => assertFails(admin.doc('users/u1/history/1').set({ a: 1 })));
await check('unverified admin email is refused', () => assertFails(fake.doc('users/u1/history/1').get()));
await check('other collections stay closed', () => assertFails(admin.doc('private/x').get()));
await env.cleanup();
console.log('failures', failed);
process.exit(failed ? 1 : 0);
