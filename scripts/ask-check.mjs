// One-time check of real answers from the live site.
const qs = [
  { board:'ASSEB (State)', className:'9th (Class 9)', subject:'General Science', question:'What is diffusion?', lang:'as' },
  { board:'CBSE', className:'6th (Class 6)', subject:'Social Science', question:'What is a democracy?', lang:'hi' },
];
for (const q of qs) {
  const r = await fetch('https://studylens-ai-gamma.vercel.app/api/ask', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ mode:'text', lang:'en', subjectType:'general', ...q }) });
  const d = await r.json().catch(() => ({}));
  console.log(`\n=== ${q.className} | ${q.subject} | ${q.question} [${r.status}]\n${String(d.answer || d.error).slice(0, 700)}\n--- length ${String(d.answer || '').length}`);
}
