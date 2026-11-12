// The static corporate bundle has no content API. Keep its embedded defaults
// authoritative instead of retrying an endpoint that static hosting blocks.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const files = [
  'static-site/assets/index-C0lP-tHU.js',
  'public/site/assets/index-C0lP-tHU.js',
];
const apiLoader = 'async function h0(l){const u=await fetch("/org-api/content",{credentials:"same-origin",signal:l,headers:{Accept:"application/json"}});if(!u.ok)throw new Error("Site content could not load.");const s=(await u.json())?.content??{};return{...oi,...s,homepage:{...oi.homepage,...s.homepage??{}},contact:{...oi.contact,...s.contact??{}},pages:{...oi.pages,...s.pages??{}}}}';
const staticLoader = 'async function h0(){return oi}';

for (const relativePath of files) {
  const filePath = path.join(projectRoot, relativePath);
  const bundle = await readFile(filePath, 'utf8');
  const matches = bundle.split(apiLoader).length - 1;
  if (matches === 0 && bundle.includes(staticLoader)) {
    console.log(`Static defaults already configured in ${relativePath}`);
    continue;
  }
  if (matches !== 1) {
    throw new Error(`Expected one content API loader in ${relativePath}; found ${matches}.`);
  }
  await writeFile(filePath, bundle.replace(apiLoader, staticLoader));
  console.log(`Updated static defaults in ${relativePath}`);
}
