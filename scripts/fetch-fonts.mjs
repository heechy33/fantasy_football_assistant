// Self-host Archivo + Inter variable WOFF2 from Google Fonts (both SIL OFL 1.1).
// Run: node scripts/fetch-fonts.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

async function firstWoff2Url(familyQuery) {
  const cssUrl = `https://fonts.googleapis.com/css2?${familyQuery}&display=swap`;
  const res = await fetch(cssUrl, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`fonts.googleapis.com ${res.status} for ${familyQuery}`);
  const css = await res.text();
  const match = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/.exec(css);
  if (!match) throw new Error(`no woff2 URL found for ${familyQuery}`);
  return match[1];
}

const targets = [
  {
    family: 'Inter',
    roman: 'family=Inter:opsz,wght@14..32,100..900',
    italic: 'family=Inter:ital,opsz,wght@1,14..32,100..900',
    romanFile: 'inter.woff2',
    italicFile: 'inter-italic.woff2',
  },
  {
    family: 'Archivo',
    roman: 'family=Archivo:wght@100..900',
    italic: 'family=Archivo:ital,wght@1,100..900',
    romanFile: 'archivo.woff2',
    italicFile: 'archivo-italic.woff2',
  },
];

const outDir = join(process.cwd(), 'frontend', 'public', 'fonts');
mkdirSync(outDir, { recursive: true });

for (const target of targets) {
  for (const [variant, query, file] of [
    ['roman', target.roman, target.romanFile],
    ['italic', target.italic, target.italicFile],
  ]) {
    const url = await firstWoff2Url(query);
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`gstatic ${res.status} for ${target.family} ${variant}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const outPath = join(outDir, file);
    writeFileSync(outPath, bytes);
    console.log(`${target.family} ${variant}: ${bytes.length} bytes -> ${file}`);
  }
}
