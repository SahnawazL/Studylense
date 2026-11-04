// Checks the real answer formatter (fmt, injectSVGs) with the real KaTeX, using
// answers shaped like the AI's, for every subject. Run by .github/workflows/render-test.yml
import fs from 'fs'; import path from 'path'; import { createRequire } from 'module'; import { chromium } from 'playwright';
const req = createRequire(import.meta.url);
const src = fs.readFileSync('index.html', 'utf8');
const piece = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
const code = piece('function fmt(t) {', '// ── QUIZ ME ──') + piece('function _previewChunkedText(rawText) {', 'function _previewChunkedText(rawText) {'.length ? '/*none*/' : '');
const previewStart = src.indexOf('function _previewChunkedText'); const previewEnd = src.indexOf('\n}\n', previewStart) + 3;
const dist = path.join(path.dirname(req.resolve('katex/package.json')), 'dist');
const S = {
 maths_quadratic: 'Using the **Quadratic Formula**:\n\n1. Identify $a=2$, $b=-7$, $c=3$\n$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$\n2. Substitute:\n$$x = \\frac{7 \\pm \\sqrt{49-24}}{4} = \\frac{7 \\pm 5}{4}$$\n3. So $x=3$ or $x=\\frac{1}{2}$\n\n💡 Key Takeaway: Always find $a$, $b$, $c$ first.',
 maths_brackets: 'Let \\( f(x) = 2x^2 + 3 \\). Then \\( f(2) = 11 \\). Also \\( g(x)=\\sin(x)\\cos(x) \\) and \\[ \\int_0^{\\pi} \\sin(x)\\,dx = 2 \\]',
 maths_aligned: '$$\\begin{aligned} 2x + 3 &= 11 \\\\ 2x &= 8 \\\\ x &= 4 \\end{aligned}$$\nand \\begin{align} a &= b \\\\ c &= d \\end{align}\nInline $\\begin{align} p &= q \\end{align}$ too.',
 maths_matrix: '$$A = \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix},\\quad |A| = \\begin{vmatrix} 1 & 2 \\\\ 3 & 4 \\end{vmatrix} = -2$$\n$$f(x)=\\begin{cases} x^2 & x\\ge 0 \\\\ -x & x<0 \\end{cases}$$',
 maths_compare: 'If x<y and y>z then 3 < 5. Check 2 * 3 * 4 = 24 and 5*6=30. A&B means both. AT&T.',
 maths_bare: 'The value is \\frac{3}{4} and \\sqrt{16} = 4, also 2 \\times 3 = 6 and angle is 90^\\circ and \\theta = 30^{\\circ}.\n\\frac{a}{b} = \\frac{c}{d}',
 maths_long: '$$\\frac{(x+1)^2 + (x+2)^2 + (x+3)^2 + (x+4)^2 + (x+5)^2 + (x+6)^2 + (x+7)^2 + (x+8)^2 + (x+9)^2}{(y+1)(y+2)(y+3)(y+4)(y+5)(y+6)(y+7)(y+8)(y+9)(y+10)}$$\nInline: $a_1 + a_2 + a_3 + a_4 + a_5 + a_6 + a_7 + a_8 + a_9 + a_{10} + a_{11} + a_{12} + a_{13} + a_{14} + a_{15}$ end.',
 maths_geometry: 'In $\\triangle ABC$, $\\angle B = 90^\\circ$, so $\\overline{AC}$ is the hypotenuse, $AB \\perp BC$, $\\sin\\theta = \\dfrac{3}{5}$, $\\therefore \\cos\\theta = \\dfrac{4}{5}$ and $\\lim_{x\\to 0}\\frac{\\sin x}{x}=1$.',
 maths_money: 'A pen costs $5 and a book costs $12. Rupees: ₹100. Written \\$20 too. Math $x+1$ here and $2 + 3 = 5$ and $3 \\times 4$ and $7.14 \\, \\text{mM/min}$.',
 maths_table: '| $x$ | $x^2$ | $|x|$ |\n|---|---|---|\n| $-2$ | $4$ | $2$ |\n| $3$ | $9$ | $3$ |\n\nNo outer pipes:\n\nName | Marks\n---|---\nAsha | 90',
 stats: 'Mean: $\\bar{x} = \\frac{\\sum f_i x_i}{\\sum f_i}$. Variance $\\sigma^2$, $\\binom{5}{2}=10$, $^5C_2$.',
 physics: 'Using $F = ma$: $$a = \\frac{F}{m} = \\frac{20\\,\\text{N}}{5\\,\\text{kg}} = 4\\,\\text{m/s}^2$$\nEnergy $E = \\frac{1}{2}mv^2$, $\\vec{F} = q\\vec{v}\\times\\vec{B}$, $\\lambda = 500\\,\\text{nm}$, $R = 10\\,\\Omega$, $T = 25\\,^\\circ\\text{C}$, $1.6\\times10^{-19}\\,\\text{C}$, $\\hbar$, $\\nabla\\cdot\\vec{E}=\\frac{\\rho}{\\varepsilon_0}$, $5\\,\\mu\\text{F}$.',
 chemistry: 'Water: \\ce{H2O}, acid \\ce{H2SO4}.\n\\ce{2H2 + O2 -> 2H2O}\nEquilibrium: \\ce{N2 + 3H2 <=> 2NH3}\n$$K_c = \\frac{[\\ce{NH3}]^2}{[\\ce{N2}][\\ce{H2}]^3}$$\nIon \\ce{SO4^2-}, \\ce{Fe^3+}, \\ce{CaCO3 ->[\\Delta] CaO + CO2 ^}, \\ce{Ag+ + Cl- -> AgCl v}, hydrate \\ce{CuSO4.5H2O}, $\\ce{CH3COOH}$.',
 biology: '## Photosynthesis\n\\ce{6CO2 + 6H2O ->[light] C6H12O6 + 6O2}\n- **Chlorophyll** absorbs light\n- Happens in *chloroplasts*\n\n[SVG:<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 200" width="360" height="200"><rect width="360" height="200" fill="#1a1f30" rx="8"/><circle cx="90" cy="100" r="40" stroke="#4f8ef7" fill="none"/><text x="60" y="170" fill="#e0e8ff" font-size="11">Light & Water</text></svg>]\n\n💡 Key Takeaway: Plants make food.',
 svg_amp: '[SVG:<svg viewBox="0 0 200 100"><rect width="200" height="100" fill="#1a1f30"/><text x="10" y="50" fill="#fff">Force & Motion</text><line x1="0" y1="0" x2="100" y2="90" stroke="#fff"/></svg>]',
 svg_fenced: 'Here:\n```svg\n<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" stroke="black" fill="none"/></svg>\n```\nDone.',
 svg_raw: 'Look: <svg width="120" height="80"><rect x="5" y="5" width="50" height="50" stroke="red" fill="none"/></svg> ok',
 svg_wide: '[SVG:<svg viewBox="0 0 300 200"><rect width="300" height="200" fill="#1a1f30"/><rect x="260" y="80" width="110" height="40" stroke="#fc0" fill="none"/><text x="275" y="105" fill="#fff">f prime</text></svg>]',
 svg_cut: 'Before.\n[SVG:<svg viewBox="0 0 100 100"><g><circle cx="50" cy="50" r="30" fill="red"/><line x1="0" y1="0" x2="10"',
 svg_nasty: '[SVG:<svg viewBox="0 0 50 50" onload="alert(1)"><script>alert(2)</script><circle cx="9" cy="9" r="5"/></svg>]',
 kids_drawing: '## How to draw a mango 🥭\n1. Draw a big oval\n2. Add a small stem\n[SVG:<svg viewBox="0 0 300 220"><ellipse cx="150" cy="120" rx="80" ry="60" fill="#ffc107"/><path d="M150 60 q5 -30 25 -35" stroke="green" fill="none" stroke-width="4"/><text x="110" y="205" font-size="13">Step 1 mango</text></svg>]\nGood job! 🎉',
 english: '**Noun:** a naming word.\n\n*Example:* "The **cat** sat."\n\n> A quote line.\n\n---\n\n#### Small heading\n1) one\n2) two',
 history_html: 'In 1857<br>the revolt began.<br/>Water H<sub>2</sub>O. <b>Bold tag</b> stays as text.',
 code: 'Python:\n```python\nif a<b and b>c:\n    print("$x$ **no** format")\n```\nInline `a<b` and `$5`.',
 bengali: 'উত্তর: $x = 5$। **ধাপ ১:** $$২x + ৩ = ১৩$$\nসূত্র: $\\text{ক্ষেত্রফল} = দৈর্ঘ্য \\times প্রস্থ$',
 hindi: 'उत्तर: **क्षेत्रफल** $= \\frac{1}{2} \\times$ आधार × ऊंचाई। $$\\text{चाल} = \\frac{\\text{दूरी}}{\\text{समय}}$$',
 assamese: 'উত্তৰ: পানীৰ সংকেত \\ce{H2O}। $v = u + at$',
 math_tricky: 'A $T = 25\\,^\\circ\\text{C}$ B $37^{\\circ}C$ C $30°$ D $\\degree$ E $50%$ F $\\text{ m/s}^2$ G $\\mathrm{kg}$ H $\\overrightarrow{AB}$ I $\\cancel{x}$ J $\\xrightarrow{heat}$ K $\\underbrace{a+b}_{n}$ L $\\boxed{5}$ M $\\operatorname{sin}x$ N $\\log_2 8$ O $\\mathbb{R}$ P $\\implies$ Q $\\iff$ R $\\oint$ S $\\ell$ T $\\dots$ U $x ≤ 5$ V $2 × 3$ W $x²$ X $H₂O$ Y $\\textbf{bold}$ Z $a\\_b$ a $\\text{speed}=\\frac{d}{t}$ b $\\ohm$ c $\\sqrt[3]{8}$ d $\\frac12$ e $10^{-3}$ f $\\sim$ g $\\parallel$ h $\\perp$ i $\\%$ j $\\pm$ k $π r^2$ l $\\vec{v}_0$ m $\\mathcal{L}$ n $\\tan^{-1}$ o $\\overset{\\Delta}{\\to}$ p $\\pu{5 m/s}$',
 broken_math: 'Bad: $\\frac{1}{2$ and $\\left( x$ and $$\\unknowncommand{x}$$ end.',
 empty: '',
};
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 360, height: 800 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.setContent('<!doctype html><html><head><meta charset="utf8"></head><body style="margin:0;background:#0f1117;color:#e8ecf5;font-family:sans-serif"><div id="o" style="padding:12px"></div></body></html>');
await p.addStyleTag({ content: src.match(/<style>([\s\S]*?)<\/style>/)[1] });
await p.addStyleTag({ path: path.join(dist, 'katex.min.css') });
await p.addScriptTag({ path: path.join(dist, 'katex.min.js') }); await p.addScriptTag({ path: path.join(dist, 'contrib/mhchem.min.js') });
await p.addScriptTag({ content: src.slice(src.indexOf('function fmt(t) {'), src.indexOf('// ── QUIZ ME ──')) + src.slice(previewStart, previewEnd) + ';window.fmt=fmt;window.injectSVGs=injectSVGs;window._pv=_previewChunkedText;' });
let bad = 0;
for (const [name, text] of Object.entries(S)) {
  const r = await p.evaluate(([text]) => {
    const o = document.getElementById('o'); o.innerHTML = '<div class="answer-body" style="width:336px">' + fmt(text) + '</div>'; const box = o.firstChild; injectSVGs(box);
    const walk = n => n.nodeType === 3 ? n.textContent : (n.classList && (n.classList.contains('katex') || n.tagName === 'CODE' || n.tagName === 'PRE' || n.tagName === 'svg')) ? '' : [...n.childNodes].map(walk).join('');
    const visible = walk(box); const issues = [];
    if (/\\(frac|sqrt|times|ce\{|begin|theta|text\{|\(|\[)/.test(visible)) issues.push('raw LaTeX');
    if (/\*\*|%%|^#{1,6} |\$\$/m.test(visible)) issues.push('raw markers');
    if (box.querySelector('.katex-error')) issues.push('katex error: ' + box.querySelector('.katex-error').textContent.slice(0, 40));
    if (box.querySelector('.ans-math-raw') && !/Bad:/.test(text)) issues.push('formula fell back to text: ' + [...box.querySelectorAll('.ans-math-raw')].map(c => c.textContent).join(' ¦ ').slice(0, 160));
    if (box.querySelector('.svg-placeholder')) issues.push('svg stuck');
    if (box.querySelector('script') || box.querySelector('[onload]')) issues.push('unsafe svg');
    if (box.scrollWidth > box.clientWidth + 1) { const w = [...box.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > box.getBoundingClientRect().right + 2 && !e.closest('.ans-formula,.ans-table-wrap,.ans-svg-wrap,.ans-code-block'))[0]; if (w) issues.push('overflow: ' + w.className); }
    return { issues, svgs: box.querySelectorAll('svg').length, math: box.querySelectorAll('.katex').length, tables: box.querySelectorAll('table').length, text: visible.replace(/\s+/g, ' ').slice(0, 90) };
  }, [text]);
  if (r.issues.length) bad++;
  console.log((r.issues.length ? 'FAIL ' : 'ok   ') + name, JSON.stringify(r));
  await p.screenshot({ path: `shots/${name}.png`, fullPage: true });
}
for (const part of ['Start [SVG:<svg viewBox="0 0 9 9"><circle', 'Text $$x = \\frac{1', 'A \\( x', 'Done [SVG:<svg><rect/></svg>] more', 'Value $x$ ok **bo']) {
  console.log('preview', JSON.stringify(await p.evaluate(t => { const d = document.createElement('div'); d.innerHTML = _pv(t); return d.textContent; }, part)));
}
console.log('page errors', errs, 'failures', bad);
await b.close(); process.exit(bad || errs.length ? 1 : 0);
