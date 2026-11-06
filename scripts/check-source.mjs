import fs from 'node:fs';
import path from 'node:path';
const files = fs.readdirSync('src', { recursive: true }).filter(p => /\.(ts|tsx|css)$/.test(p));
const issues = [];
for (const file of files) {
  const text = fs.readFileSync(path.join('src', file), 'utf8');
  if (/dangerouslySetInnerHTML|eval\s*\(|new Function\s*\(/.test(text)) issues.push(`${file}: unsafe dynamic content`);
  if (/console\.(log|debug)\(/.test(text)) issues.push(`${file}: unreviewed debug logging`);
  if (/\bMediaRecorder\b/.test(text)) issues.push(`${file}: recording is outside scope`);
}
console.log(`Source checks: ${files.length} files, ${issues.length} issues`);
issues.forEach(x => console.log(x));
process.exitCode = issues.length ? 1 : 0;
