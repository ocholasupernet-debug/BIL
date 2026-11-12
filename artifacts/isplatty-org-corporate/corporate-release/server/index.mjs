import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import pg from 'pg';
import pino from 'pino';
import { z } from 'zod';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContentStore } from './content.mjs';
import { createAdminRouter, ADMIN_HOST, normalizedHost } from './admin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = pino({ level: 'info' });
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error('A valid PORT is required');
const base = (process.env.BASE_PATH || '/').replace(/\/$/, '');
const apiPath = `${base}/org-api`;
const rawConfig = JSON.parse(await readFile(path.join(root, 'site.config.json'), 'utf8'));
const config = z.object({
  phone: z.string().max(30), email: z.union([z.literal(''), z.string().email()]),
  whatsapp: z.string().regex(/^$|^[1-9]\d{6,14}$/),
  address: z.string().max(300), hours: z.string().max(200),
  coverageAreas: z.array(z.string().min(1).max(150)).max(200),
  publicOrigin: z.union([z.literal(''), z.string().url()]),
}).parse(rawConfig);
if (config.publicOrigin && new URL(config.publicOrigin).hostname !== 'isplatty.org' &&
    new URL(config.publicOrigin).hostname !== 'www.isplatty.org') {
  throw new Error('Only the owner-connected isplatty.org domain may be configured');
}
const publicOrigin = process.env.ISPLATTY_ORG_PUBLIC_ORIGIN || config.publicOrigin;
if (publicOrigin && publicOrigin !== 'https://isplatty.org') throw new Error('Public origin must be https://isplatty.org');
const { publicOrigin: _configuredOrigin, ...initialContact } = config;
// Uses this new project's database only; never imports the shared API, BIL, or its credentials.
if (production && !process.env.ISPLATTY_ORG_DATABASE_URL) throw new Error('Production requires a dedicated ISPLATTY_ORG_DATABASE_URL, never BIL credentials');
const pool = new pg.Pool({ connectionString: process.env.ISPLATTY_ORG_DATABASE_URL || process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
pool.on('error', () => log.error('Independent website database connection failed'));
const contentStore = await createContentStore(pool,root,initialContact);
const devHost = normalizedHost(process.env.REPLIT_DEV_DOMAIN || '');
const uploadDir = process.env.ISPLATTY_ORG_UPLOAD_DIR
  ? path.resolve(process.env.ISPLATTY_ORG_UPLOAD_DIR) : (!production ? path.join(root,'.data/uploads') : null);
const app = express();
app.disable('x-powered-by');
if (process.env.ISPLATTY_ORG_TRUST_LOOPBACK === 'true') app.set('trust proxy','loopback');
// Do not trust arbitrary forwarded IP headers. Per-instance gate supplements DB rate limits.
app.use(helmet({
  contentSecurityPolicy: production ? {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https://images.unsplash.com'],
      connectSrc: ["'self'"], objectSrc: ["'none'"],
      frameAncestors: ["'self'", 'https://*.replit.dev', 'https://*.replit.com', 'https://replit.com'],
      upgradeInsecureRequests: [],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
  frameguard: false,
}));
// Host is supplied by the dedicated Nginx virtual hosts. Never trust X-Forwarded-Host.
// BIL's hosts, port and reverse-proxy configuration are outside this application.
app.use((req,res,next)=>{
  const host=normalizedHost(req.get('host'));
  req.isCorporateAdminHost=host===ADMIN_HOST;
  if(production && ![ADMIN_HOST,'isplatty.org'].includes(host)) return res.status(421).send('Unrecognized corporate hostname.');
  if(req.isCorporateAdminHost) {
    res.set({'X-Robots-Tag':'noindex, nofollow','Cache-Control':'no-store'});
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    if(req.path.startsWith(apiPath)) return res.status(404).json({error:'Not found'});
    if(req.path==='/robots.txt')return res.type('text').send('User-agent: *\nDisallow: /\n');
  } else if(production && (req.path.startsWith('/org-admin-api') || req.path.startsWith('/admin') || req.path.startsWith('/src/admin'))) {
    return res.status(404).send('Not found');
  }
  next();
});
app.get('/_health/live',(_req,res)=>res.json({status:'ok',application:'isplatty-org'}));
app.get('/_health/ready',async (_req,res)=>{
  try {
    await pool.query('SELECT 1 FROM isplatty_org_inquiries LIMIT 1');
    await pool.query('SELECT 1 FROM isplatty_org_admins LIMIT 1');
    await pool.query('SELECT 1 FROM isplatty_org_content LIMIT 1');
    res.json({status:'ready',application:'isplatty-org'});
  } catch {res.status(503).json({status:'not_ready',application:'isplatty-org'});}
});
app.use(apiPath, rateLimit({
  windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many requests. Please try again in a minute.' },
}));
app.use(apiPath, express.json({ limit: '12kb', type: 'application/json' }));
app.use(apiPath, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

const digest = value => createHash('sha256').update(value).digest('hex');
const input = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(30).regex(/^[+\d\s().-]*$/).optional().default(''),
  location: z.string().trim().max(150).optional().default(''),
  service: z.string().trim().min(2).max(100),
  message: z.string().trim().min(10).max(3000),
  consent: z.literal(true),
  token: z.string().regex(/^[a-f0-9]{64}$/),
  website: z.string().max(200).optional().default(''),
}).strict();

async function throttle(req, category, limit) {
  // The proxy socket is conservative: cannot be evaded with forged X-Forwarded-For.
  const window = Math.floor(Date.now() / 600_000);
  const key = digest(`${category}:${req.ip}:${window}`);
  const result = await pool.query(
    `INSERT INTO isplatty_org_rate_limits (key, expires_at, count)
     VALUES ($1, now() + interval '20 minutes', 1)
     ON CONFLICT (key) DO UPDATE SET count = isplatty_org_rate_limits.count + 1
     RETURNING count`, [key]);
  return result.rows[0].count <= limit;
}
function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  const site = req.get('sec-fetch-site');
  if (site === 'cross-site' || !origin) return res.status(403).json({ error: 'Please send requests through the website form.' });
  let host;
  try { host = new URL(origin).host; } catch { return res.status(403).json({ error: 'Invalid request origin.' }); }
  if (host !== req.get('host') && origin !== publicOrigin) return res.status(403).json({ error: 'Invalid request origin.' });
  if (!req.is('application/json')) return res.status(415).json({ error: 'JSON content is required.' });
  next();
}
app.use('/org-admin-api',rateLimit({windowMs:60_000,limit:100,standardHeaders:'draft-8',legacyHeaders:false,validate:{xForwardedForHeader:false},message:{error:'Too many administrator requests. Please wait a minute.'}}));
app.use('/org-admin-api',createAdminRouter({pool,contentStore,throttle,production,devHost,uploadDir,log}));
app.get('/org-media/:name',async(req,res)=>{
  if(!uploadDir || !/^[a-f0-9-]{36}\.webp$/.test(req.params.name))return res.status(404).send('Not found');
  const id=req.params.name.slice(0,-5);
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))return res.status(404).send('Not found');
  const found=await pool.query('SELECT id FROM isplatty_org_media WHERE id=$1',[id]);
  if(!found.rowCount)return res.status(404).send('Not found');
  res.set({'Content-Type':'image/webp','X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=3600'});
  res.sendFile(path.join(uploadDir,req.params.name),err=>{if(err&&!res.headersSent)res.status(404).send('Photograph unavailable');});
});
app.get(`${apiPath}/content`,async(_req,res)=>res.json(await contentStore.read()));
app.get(`${apiPath}/config`, async (_req, res) => res.json((await contentStore.read()).content.contact));
app.get(`${apiPath}/challenge`, async (req, res) => {
  try {
    if (!await throttle(req, 'challenge', 80)) return res.status(429).json({ error: 'Please wait a few minutes before starting another inquiry.' });
    const token = randomBytes(32).toString('hex');
    await pool.query('INSERT INTO isplatty_org_form_tokens (token_hash) VALUES ($1)', [digest(token)]);
    // Clean only short-lived anti-spam data, never submitted inquiries.
    await pool.query("DELETE FROM isplatty_org_form_tokens WHERE created_at < now() - interval '30 minutes'");
    await pool.query('DELETE FROM isplatty_org_rate_limits WHERE expires_at < now()');
    res.json({ token });
  } catch { log.error('Form token could not be issued'); res.status(503).json({ error: 'The inquiry service is temporarily unavailable. Please try again shortly.' }); }
});
app.post(`${apiPath}/inquiries`, sameOrigin, async (req, res) => {
  const parsed = input.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Check your name, email, message and privacy consent, then try again.' });
  const data = parsed.data;
  if (data.website) return res.status(400).json({ error: 'Unable to verify this request. Please refresh the form.' });
  let client;
  try {
    if (!await throttle(req, 'inquiry', 15)) return res.status(429).json({ error: 'Too many inquiries. Please wait ten minutes and try again.' });
    client = await pool.connect();
    await client.query('BEGIN');
    const token = await client.query(
      `DELETE FROM isplatty_org_form_tokens WHERE token_hash = $1
       AND created_at < now() - interval '2 seconds'
       AND created_at > now() - interval '30 minutes' RETURNING token_hash`,
      [digest(data.token)]);
    if (!token.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This form expired or was submitted too quickly. Please reopen it and try again.' });
    }
    const reference = randomUUID();
    await client.query(
      `INSERT INTO isplatty_org_inquiries (reference,name,email,phone,location,service,message,consent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [reference, data.name, data.email, data.phone, data.location, data.service, data.message, true]);
    await client.query('COMMIT');
    res.status(201).json({ reference, message: 'Your inquiry has been securely received. Keep this reference for your records.' });
  } catch {
    if (client) await client.query('ROLLBACK').catch(() => {});
    log.error('Inquiry could not be stored');
    res.status(503).json({ error: 'Your inquiry was not saved. Please try again shortly.' });
  } finally { client?.release(); }
});
app.use(apiPath, (_req, res) => res.status(404).json({ error: 'Not found' }));

const pageMeta = {
  '/': ['ISPLATTY.ORG | Networking, Wi-Fi & IT Services', 'Networking, Wi-Fi installation, MikroTik, fiber optic infrastructure, CCTV and IT support for homes and businesses. Request a service assessment.'],
  '/services': ['Networking, Wi-Fi & Fiber Services | ISPLATTY.ORG', 'Explore LAN/WAN networking, Wi-Fi installation, MikroTik router configuration, fiber optics, ISP infrastructure, CCTV and practical IT support.'],
  '/customer-care': ['Customer Care & Technical Inquiries | ISPLATTY.ORG', 'Request technical support for your networking, Wi-Fi, fiber or IT issue through the secure ISPLATTY.ORG customer-care inquiry form.'],
  '/about': ['About Our Networking Services | ISPLATTY.ORG', 'Learn about ISPLATTY.ORG networking, Wi-Fi installation, telecommunications and IT services for homes and growing businesses.'],
  '/projects': ['Sample Networking Project Portfolio | ISPLATTY.ORG', 'Browse clearly labelled illustrative networking, fiber, wireless and CCTV project photographs. These samples are not completed customer projects.'],
  '/coverage': ['Request a Coverage Assessment | ISPLATTY.ORG', 'Check published service areas or request a site assessment. Networking and Wi-Fi service availability is confirmed individually for each location.'],
  '/contact': ['Contact & Request a Service | ISPLATTY.ORG', 'Send a secure inquiry about networking, Wi-Fi installation, fiber optics, MikroTik, CCTV or IT support. Receive a reference for your request.'],
  '/privacy': ['Privacy Policy | ISPLATTY.ORG', 'How ISPLATTY.ORG handles website inquiries, contact information and privacy requests.'],
  '/terms': ['Website Terms | ISPLATTY.ORG', 'Terms for using the independent ISPLATTY.ORG services website and requesting a technical assessment.'],
};
const escape = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
app.get(`${base}/robots.txt`, (_req, res) => {
  res.type('text').send(publicOrigin ? `User-agent: *\nAllow: /\nDisallow: /org-api/\nSitemap: ${publicOrigin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
});
app.get(`${base}/sitemap.xml`, (_req, res) => {
  if (!publicOrigin) return res.status(503).type('text').send('The owner has not connected the production domain yet.');
  res.type('xml').send(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Object.keys(pageMeta).map(route => `<url><loc>${escape(publicOrigin.replace(/\/$/, '') + route)}</loc></url>`).join('')}</urlset>`);
});
let vite;
if (!production) {
  const { createServer } = await import('vite');
  vite = await createServer({ configFile: path.join(root, 'vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
  app.use(vite.middlewares);
} else {
  app.use(base || '/', (req,res,next)=>{
    if(!req.isCorporateAdminHost && req.path==='/admin.html')return res.status(404).send('Not found');
    if(req.isCorporateAdminHost && !req.path.startsWith('/assets/') && !req.path.startsWith('/images/') && req.path!=='/favicon.svg')return next();
    return express.static(path.join(root,'dist/public'),{index:false,maxAge:'1h'})(req,res,next);
  });
}
app.use(async (req, res, next) => {
  if (req.method !== 'GET') return next();
  try {
    const route = req.path.slice(base.length) || '/';
    const adminPage=req.isCorporateAdminHost || (!production && (route==='/admin' || route.startsWith('/admin/')));
    if(adminPage) {
      if(req.isCorporateAdminHost && !['/','/login','/dashboard','/password','/admin'].includes(route))return res.status(404).send('Not found');
      let adminHtml=await readFile(path.join(root,production?'dist/public/admin.html':'admin.html'),'utf8');
      if(vite)adminHtml=await vite.transformIndexHtml(req.originalUrl,adminHtml);
      return res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}).type('html').send(adminHtml);
    }
    const meta = pageMeta[route];
    let html = await readFile(path.join(root, production ? 'dist/public/index.html' : 'index.html'), 'utf8');
    if (vite) html = await vite.transformIndexHtml(req.originalUrl, html);
    if (meta) {
      html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(meta[0])}</title>`)
        .replace(/<meta\s+(?:name="(?:description|robots|twitter:[^"]+)"|property="og:[^"]+")\s+content="[^"]*"\s*\/?>/g, '');
      const canonical = publicOrigin ? publicOrigin.replace(/\/$/, '') + route : '';
      html = html.replace('</head>', `<meta name="description" content="${escape(meta[1])}"><meta property="og:title" content="${escape(meta[0])}"><meta property="og:description" content="${escape(meta[1])}"><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(meta[0])}"><meta name="twitter:description" content="${escape(meta[1])}">${canonical ? `<link rel="canonical" href="${escape(canonical)}"><meta property="og:url" content="${escape(canonical)}"><meta property="og:image" content="${escape(publicOrigin.replace(/\/$/, '') + '/images/hero-rack.jpg')}"><meta name="twitter:image" content="${escape(publicOrigin.replace(/\/$/, '') + '/images/hero-rack.jpg')}">` : '<meta name="robots" content="noindex,nofollow">'}</head>`);
    }
    res.status(meta ? 200 : 404).type('html').send(html);
  } catch (error) { next(error); }
});
app.use((err, _req, res, _next) => {
  const status = err.type === 'entity.too.large' ? 413 : err instanceof SyntaxError || err instanceof z.ZodError ? 400 : [400,403,404,409].includes(err.status) ? err.status : 500;
  if (status === 500) log.error('Website request failed');
  res.status(status).json({ error: status === 413 ? 'Request too large.' : err instanceof z.ZodError ? 'Check the submitted fields.' : status < 500 && err.status ? err.message : status === 400 ? 'Invalid JSON.' : 'Service temporarily unavailable.' });
});
const server = app.listen(port, process.env.HOST || '0.0.0.0', () => log.info({ port }, 'Independent ISPLATTY.ORG website started'));
process.on('SIGTERM', () => { server.close(async () => { await pool.end(); await vite?.close(); process.exit(0); }); });
