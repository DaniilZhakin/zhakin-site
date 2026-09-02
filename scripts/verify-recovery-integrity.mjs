import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'index.html','about.html','projects.html','publications.html','reception.html','assets','robots.txt','sitemap.xml','CNAME','DISASTER_RECOVERY.md',
  'docs/INDEPENDENT-INFRASTRUCTURE-PLAN.md','docs/INDEPENDENT-INFRASTRUCTURE-MANIFEST.json','docs/security-operations-checklist.md','docs/security-operations-tests.md',
  'docs/intelligence-3.0-collector-contract.schema.json','intelligence/collector-cloudflare','intelligence/collector-reference'
];
for (const relative of required) if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing recovery artifact: ${relative}`);

const cname = fs.readFileSync(path.join(root, 'CNAME'), 'utf8').trim();
if (cname !== 'xn--80alhhq.xn--p1ai') throw new Error(`Unexpected CNAME: ${cname}`);

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/INDEPENDENT-INFRASTRUCTURE-MANIFEST.json'), 'utf8'));
const expected = {unicode:'жакин.рф',punycode:'xn--80alhhq.xn--p1ai',source_repository:'DaniilZhakin/zhakin-site',current_public_delivery:'github-pages',intelligence_production:'BLOCKED',browser_transport:'BLOCKED',dns_cutover:'BLOCKED'};
for (const [key,value] of Object.entries(expected)) { const actual = key === 'unicode' || key === 'punycode' ? manifest.domain?.[key] : manifest[key]; if (actual !== value) throw new Error(`Manifest mismatch for ${key}: ${actual}`); }

const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
if (/noindex/i.test(robots)) throw new Error('robots.txt contains unexpected noindex directive');
const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
if (urls.length === 0) throw new Error('sitemap.xml contains no URLs');
if (!urls.every((url) => url.startsWith('https://xn--80alhhq.xn--p1ai/'))) throw new Error('sitemap.xml contains a non-canonical host');
for (const url of urls) { const pathname = new URL(url).pathname.replace(/^\//,''); if (!fs.existsSync(path.join(root,pathname))) throw new Error(`Sitemap URL has no matching repository path: /${pathname}`); }

const htmlFiles = ['index.html','about.html','projects.html','publications.html','reception.html'];
for (const file of htmlFiles) { const html = fs.readFileSync(path.join(root,file),'utf8'); if (/<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html)) throw new Error(`Core page has noindex: ${file}`); }

// Publication-card integrity: every editorial card must reference an existing reusable cover asset.
const publications = fs.readFileSync(path.join(root,'publications.html'),'utf8');
const imageRefs = [...publications.matchAll(/<img\s+src=["']([^"']+)["'][^>]*alt=["']([^"']+)["'][^>]*>/g)];
if (imageRefs.length !== 11) throw new Error(`Expected 11 publication covers, found ${imageRefs.length}`);
for (const [,src,alt] of imageRefs) {
  if (!src.startsWith('/assets/images/publications/') || !src.endsWith('.svg')) throw new Error(`Invalid publication cover path: ${src}`);
  if (!alt.trim()) throw new Error(`Publication cover has empty alt text: ${src}`);
  const local = path.join(root, src.replace(/^\//,''));
  if (!fs.existsSync(local)) throw new Error(`Publication cover asset missing: ${src}`);
}

const scanRoots = ['assets','intelligence'];
const blockedPattern = /https:\/\/[^\s"']+\/v1\/events/g;
const credentialPattern = /(CF_API_TOKEN|CLOUDFLARE_API_TOKEN|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY)/;
const extensions = new Set(['.js','.mjs','.json','.html','.css','.md','.yml','.yaml','.txt']);
function walk(directory) { const entries = fs.readdirSync(directory,{withFileTypes:true}); const files=[]; for (const entry of entries) { const full=path.join(directory,entry.name); if (entry.isDirectory()) files.push(...walk(full)); else if (extensions.has(path.extname(entry.name)) || !path.extname(entry.name)) files.push(full); } return files; }
for (const rootName of scanRoots) for (const file of walk(path.join(root,rootName))) { const text=fs.readFileSync(file,'utf8'); if (blockedPattern.test(text)) throw new Error(`Production collector endpoint found: ${path.relative(root,file)}`); blockedPattern.lastIndex=0; if (credentialPattern.test(text)) throw new Error(`Potential credential material found: ${path.relative(root,file)}`); }

console.log(`PASS: recovery integrity verified (${urls.length} sitemap URLs; ${imageRefs.length} publication covers)`);
