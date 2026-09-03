// Self-host Archivo + Inter variable WOFF2 from Google Fonts (both SIL OFL 1.1).
// Run: node scripts/fetch-fonts.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

// requireStretchAxis: when true, the css2 response's @font-face block for this query MUST carry a
// font-stretch RANGE descriptor (two values, e.g. "62.5% 151%") — that's what Google's css2 API
// emits only when the wdth axis was actually granted for the request. tokens.css's Archivo
// @font-face relies on font-stretch: 62% 125% (see its "font hierarchy" doc / --display-stretch-
// wide) to select the "Expanded" cut deterministically; every Tier-1 brand-moment style in
// App.css depends on that axis being present. A wght-only build (what shipped before this repo's
// archivo.woff2 was hand-subsetted with both axes — see tokens.css's font-face comment) would
// pass every other check here while silently regressing every Tier-1 selector to a synthesized
// (browser-faked) stretch instead of the real Expanded glyphs. This assertion fails loudly, before
// any file is overwritten, instead of shipping that regression silently.
async function firstWoff2Url(familyQuery, { requireStretchAxis = false } = {}) {
  const cssUrl = `https://fonts.googleapis.com/css2?${familyQuery}&display=swap`;
  const res = await fetch(cssUrl, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`fonts.googleapis.com ${res.status} for ${familyQuery}`);
  const css = await res.text();
  if (requireStretchAxis && !/font-stretch:\s*[\d.]+%\s+[\d.]+%/.test(css)) {
    throw new Error(
      `${familyQuery} did not return a font-stretch range descriptor — the wdth axis was not ` +
        `granted, and downloading would silently regress tokens.css's Archivo Expanded (Tier-1) ` +
        `styles to a synthesized stretch. Check the axis syntax in the query string above.`,
    );
  }
  const match = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/.exec(css);
  if (!match) throw new Error(`no woff2 URL found for ${familyQuery}`);
  return match[1];
}

const targets = [
  {
    family: 'Inter',
    roman: { query: 'family=Inter:opsz,wght@14..32,100..900' },
    italic: { query: 'family=Inter:ital,opsz,wght@1,14..32,100..900' },
    romanFile: 'inter.woff2',
    italicFile: 'inter-italic.woff2',
  },
  {
    family: 'Archivo',
    // wdth BEFORE wght — Google's css2 API requires axis tags in alphabetical order (ital always
    // first when present). Requesting both axes is what reproduces the shipped hand-subsetted
    // archivo.woff2 (wght 100-900, wdth 62-125); wght-only was the prior, narrower file.
    roman: { query: 'family=Archivo:wdth,wght@62..125,100..900', requireStretchAxis: true },
    // Archivo's italic static instances don't carry a wdth axis (tokens.css's italic @font-face
    // has no font-stretch descriptor either — a known, deliberately deferred gap), so this stays
    // wght-only and isn't stretch-axis-gated.
    italic: { query: 'family=Archivo:ital,wght@1,100..900' },
    romanFile: 'archivo.woff2',
    italicFile: 'archivo-italic.woff2',
  },
];

const outDir = join(process.cwd(), 'frontend', 'public', 'fonts');
mkdirSync(outDir, { recursive: true });

for (const target of targets) {
  for (const [variant, spec, file] of [
    ['roman', target.roman, target.romanFile],
    ['italic', target.italic, target.italicFile],
  ]) {
    const url = await firstWoff2Url(spec.query, { requireStretchAxis: spec.requireStretchAxis });
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`gstatic ${res.status} for ${target.family} ${variant}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const outPath = join(outDir, file);
    writeFileSync(outPath, bytes);
    console.log(`${target.family} ${variant}: ${bytes.length} bytes -> ${file}`);
  }
}
