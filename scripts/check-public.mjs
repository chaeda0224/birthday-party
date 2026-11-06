import fs from 'node:fs';
import path from 'node:path';
const ignored = new Set(['node_modules', '.git', '.trail', 'test-results']);
const rules = {
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  phone: /(?<!\d)0\d{1,2}[- .]\d{3,4}[- .]\d{4}(?!\d)/g,
  resident: /(?<!\d)\d{6}[- ]?[1-8]\d{6}(?!\d)/g,
  secret: /(?:sb_secret_|sbp_)[A-Za-z0-9_-]{12,}/g,
};
const findings = []; let count = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    if (ignored.has(entry.name) || entry.name.startsWith('.env')) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(file); continue; }
    if (!/\.(?:ts|tsx|mjs|js|css|html|json|md|sql|toml|yml)$/.test(file)) continue;
    count++;
    const text = fs.readFileSync(file, 'utf8');
    // Dependency bundles contain vendor notices and generated numeric constants; inspect separately.
    if (file.startsWith(`dist${path.sep}`) || entry.name === 'package-lock.json') {
      const n = [...text.matchAll(rules.secret)].length;
      if (n) findings.push({file, type:'secret', count:n});
      continue;
    }
    for (const [type, re] of Object.entries(rules)) {
      const n = [...text.matchAll(re)].length;
      if (n) findings.push({ file, type, count: n });
    }
  }
}
walk('.');
console.log(JSON.stringify({ inspectedTextFiles: count, findings, limits: 'Heuristic text check only. Vendor notices, images, binary content and PCFilter are separate.' }));
process.exitCode = findings.length ? 1 : 0;
