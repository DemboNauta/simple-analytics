// Writes client/m.js from client/m.src.js: drops comments and indentation, nothing else,
// so the shipped file is still easy to audit. Run with `npm run build`; a test checks
// that m.js is up to date.
import fs from 'node:fs';

export function minify(src) {
  return src
    .split('\n')
    .map((line) => line.replace(/^\s+/, ''))
    .filter((line) => line && !line.startsWith('//'))
    .join('\n') + '\n';
}

if (process.argv[1] && /build.js$/.test(process.argv[1])) {
  const src = fs.readFileSync(new URL('../client/m.src.js', import.meta.url), 'utf8');
  const out = minify(src);
  fs.writeFileSync(new URL('../client/m.js', import.meta.url), out);
  console.log(`client/m.js: ${out.length} bytes`);
}
