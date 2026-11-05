// One-time check of real answers from the live site.
const qs = [
  { board:'ASSEB (State)', className:'5th (Class 5)', subject:'General Science', question:'Why do we need to drink water?' },
  { board:'ASSEB (State)', className:'5th (Class 5)', subject:'Social Studies', question:'What is the capital of Assam?' },
  { board:'CBSE', className:'12th (Class 12)', stream:'Science', subject:'Mathematics', question:'2x+5=?' },
  { board:'CBSE', className:'7th (Class 7)', subject:'Mathematics', question:'Solve 2x + 5 = 11' },
  { board:'ICSE / ISC', className:'10th (Class 10)', subject:'History & Civics', question:'What is the Speaker of the Lok Sabha?' },
  { board:'ASSEB (State)', className:'KG 2 (LKG/UKG)', subject:'Maths (Numbers up to 100)', question:'What comes after 9?' },
  { board:'ASSEB (State)', className:'9th (Class 9)', subject:'General Science', question:'What is osmosis?', lang:'as' },
];
for (const q of qs) {
  const r = await fetch('https://studylens-ai-gamma.vercel.app/api/ask', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ mode:'text', lang:'en', subjectType:'general', ...q }) });
  const d = await r.json().catch(() => ({}));
  console.log(`\n=== ${q.className} | ${q.subject} | ${q.question} [${r.status}]\n${String(d.answer || d.error).slice(0, 700)}\n--- length ${String(d.answer || '').length}`);
}
