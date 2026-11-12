import express from 'express';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { hashPassword, verifyPassword, strongPassword } from './password.mjs';

const cookieName = '__Host-isplatty-org-admin';
const digest = value => createHash('sha256').update(value).digest('hex');
const uuid = z.string().uuid();
export const ADMIN_HOST = 'chrisphine3.isplatty.org';
export function normalizedHost(value) {
  try {
    if (!value || /[\s/@\\,]/.test(value)) return '';
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch { return ''; }
}
export function isAdminRequest(req, production, devHost) {
  const host = normalizedHost(req.get('host'));
  return host === ADMIN_HOST || (!production && ((devHost && host === devHost) || ['localhost','127.0.0.1'].includes(host)));
}
export function createAdminRouter({ pool, contentStore, throttle, production, devHost, uploadDir, log }) {
  const router = express.Router();
  const cookie = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' };
  const signIn = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(128) }).strict();
  const pwd = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(16).max(128) }).strict();
  let bootstrapPromise;
  let bootstrapIssue = 'missing_secret';
  let uploadsInFlight = 0;
  async function bootstrap() {
    const existing = await pool.query('SELECT username FROM isplatty_org_admins WHERE username=$1', ['user']);
    if (existing.rowCount) return true;
    const password = process.env.ISPLATTY_ORG_BOOTSTRAP_PASSWORD;
    if (!password) {bootstrapIssue='missing_secret';return false;}
    if (!strongPassword(password)) {bootstrapIssue='weak_secret';return false;}
    const hash = await hashPassword(password);
    await pool.query('INSERT INTO isplatty_org_admins(username,password_hash) VALUES($1,$2) ON CONFLICT DO NOTHING', ['user',hash]);
    // Bootstrap is ignored after creation. Never resets an existing account.
    return true;
  }
  function ensureBootstrap() {
    bootstrapPromise ??= bootstrap().catch(err => { bootstrapPromise = undefined; throw err; });
    return bootstrapPromise;
  }
  function tokenFrom(req) {
    const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
    return raw && /^[a-f0-9]{64}$/.test(raw) ? raw : '';
  }
  async function load(req) {
    const raw = tokenFrom(req);
    if (!raw) return null;
    const result = await pool.query(`SELECT s.*,a.must_change FROM isplatty_org_admin_sessions s
      LEFT JOIN isplatty_org_admins a ON a.username=s.username
      WHERE s.token_hash=$1 AND s.expires_at>now()
      AND (s.username IS NULL OR s.last_seen>now()-interval '30 minutes')`, [digest(raw)]);
    return result.rows[0] || null;
  }
  async function issue(res, db, username, mustChange) {
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(32).toString('hex');
    const seconds = !username || mustChange ? 900 : 7200;
    await db.query(`INSERT INTO isplatty_org_admin_sessions(token_hash,username,csrf_token,expires_at)
      VALUES($1,$2,$3,now()+$4*interval '1 second')`, [digest(token),username,csrf,seconds]);
    res.cookie(cookieName, token, { ...cookie, maxAge: seconds*1000 });
    const available=!!username || await ensureBootstrap();
    return { authenticated: !!username, ...(username ? { username } : {}), mustChangePassword: !!mustChange, csrfToken: csrf, bootstrapAvailable: available, ...(!available ? {bootstrapIssue} : {}) };
  }
  async function audit(db, action, resource) {
    await db.query('INSERT INTO isplatty_org_admin_audit(actor,action,resource) VALUES($1,$2,$3)', ['user',action,resource]);
  }
  async function transaction(operation) {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const result=await operation(client);
      await client.query('COMMIT');
      return result;
    } catch(err) {await client.query('ROLLBACK');throw err;}
    finally {client.release();}
  }
  router.use((req,res,next) => {
    if (!isAdminRequest(req, production, devHost)) return res.status(404).json({ error: 'Not found' });
    res.set({ 'Cache-Control':'no-store', 'X-Robots-Tag':'noindex, nofollow', 'Referrer-Policy':'no-referrer' });
    next();
  });
  // Requests are also rate-limited BEFORE this router's potentially expensive operations.
  router.use(express.json({ limit: '250kb', type: 'application/json' }));
  router.get('/session', async (req,res) => {
    await ensureBootstrap();
    await pool.query('DELETE FROM isplatty_org_admin_sessions WHERE expires_at<now()');
    const session = await load(req);
    if (!session) return res.json(await issue(res,pool,null,false));
    const available=await ensureBootstrap();
    res.json({ authenticated: !!session.username, ...(session.username ? {username:session.username}:{}), mustChangePassword:!!session.must_change, csrfToken:session.csrf_token, bootstrapAvailable:available,...(!available ? {bootstrapIssue}:{}) });
  });
  router.use(async (req,res,next) => {
    req.adminSession = await load(req);
    if (!['GET','HEAD'].includes(req.method)) {
      const origin = req.get('origin');
      const expectedHost = normalizedHost(req.get('host'));
      let originURL;
      try { originURL = new URL(origin); } catch { return res.status(403).json({ error:'Open the administrator website before submitting.' }); }
      const allowed = originURL.protocol === 'https:' && originURL.host.toLowerCase() === req.get('host')?.toLowerCase();
      const csrf = req.get('x-csrf-token') || '';
      if (!allowed || !expectedHost || !req.adminSession || !/^[a-f0-9]{64}$/.test(csrf) ||
        !timingSafeEqual(Buffer.from(csrf),Buffer.from(req.adminSession.csrf_token))) return res.status(403).json({error:'Your secure form session expired. Reload the page and try again.'});
    }
    next();
  });
  router.post('/login', async (req,res) => {
    const parsed = signIn.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({error:'Enter your username and password.'});
    if (!await throttle(req,'admin-login',30)) return res.status(429).json({error:'Too many login attempts. Wait ten minutes.'});
    await ensureBootstrap();
    const client = await pool.connect();
    let response;
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT * FROM isplatty_org_admins WHERE username=$1 FOR UPDATE', ['user']);
      const account = result.rows[0];
      if (!account) { await client.query('ROLLBACK'); return res.status(503).json({error:'Administrator setup is not complete. The owner must configure the private bootstrap secret.'}); }
      if (account.locked_until && new Date(account.locked_until)>new Date()) {
        await client.query('ROLLBACK');
        res.set('Retry-After',String(Math.max(1,Math.ceil((new Date(account.locked_until)-Date.now())/1000))));
        return res.status(429).json({error:'Login temporarily locked. Wait before trying again.'});
      }
      const matches = await verifyPassword(parsed.data.password,account.password_hash);
      if (!matches || parsed.data.username !== 'user') {
        const failures = account.failures+1;
        const delay = failures >= 5 ? Math.min(900,2**Math.min(failures-1,10)) : 0;
        await client.query("UPDATE isplatty_org_admins SET failures=$1,locked_until=CASE WHEN $2>0 THEN now()+$2*interval '1 second' ELSE NULL END WHERE username=$3", [failures,delay,'user']);
        await audit(client,'login_failed','administrator');
        await client.query('COMMIT');
        await new Promise(resolve=>setTimeout(resolve,Math.min(2000,failures*250)));
        return res.status(401).json({error:'Invalid credentials or login unavailable. Please wait before retrying.'});
      }
      await client.query('UPDATE isplatty_org_admins SET failures=0,locked_until=NULL WHERE username=$1', ['user']);
      await client.query('DELETE FROM isplatty_org_admin_sessions WHERE token_hash=$1 OR expires_at<now()', [req.adminSession.token_hash]);
      response = await issue(res,client,'user',account.must_change);
      await audit(client,'login_success','administrator');
      await client.query('COMMIT');
    } catch(err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
    res.json(response);
  });
  router.post('/logout', async (req,res) => {
    await pool.query('DELETE FROM isplatty_org_admin_sessions WHERE token_hash=$1', [req.adminSession.token_hash]);
    res.clearCookie(cookieName,cookie);
    res.sendStatus(204);
  });
  router.use(async (req,res,next) => {
    if (!req.adminSession?.username) return res.status(401).json({error:'Sign in to access corporate administration.'});
    await pool.query('UPDATE isplatty_org_admin_sessions SET last_seen=now() WHERE token_hash=$1', [req.adminSession.token_hash]);
    next();
  });
  router.post('/password', async (req,res) => {
    const parsed = pwd.safeParse(req.body);
    if (!parsed.success || !strongPassword(parsed.data.newPassword)) return res.status(400).json({error:'Use 16–128 characters with uppercase, lowercase, a number and a symbol. Avoid common passwords and the company name.'});
    if (!await throttle(req,'admin-password',10)) return res.status(429).json({error:'Too many password attempts. Please wait ten minutes.'});
    const client = await pool.connect();
    let response;
    try {
      await client.query('BEGIN');
      const result=await client.query('SELECT * FROM isplatty_org_admins WHERE username=$1 FOR UPDATE',['user']);
      const account=result.rows[0];
      if (!await verifyPassword(parsed.data.currentPassword,account.password_hash)) {
        await client.query('ROLLBACK'); return res.status(400).json({error:'Current password is incorrect.'});
      }
      if (await verifyPassword(parsed.data.newPassword,account.password_hash)) {
        await client.query('ROLLBACK'); return res.status(400).json({error:'Choose a different password from the temporary or current password.'});
      }
      await client.query('UPDATE isplatty_org_admins SET password_hash=$1,must_change=false,failures=0,locked_until=NULL,password_changed_at=now() WHERE username=$2', [await hashPassword(parsed.data.newPassword),'user']);
      await client.query('DELETE FROM isplatty_org_admin_sessions WHERE username=$1 OR token_hash=$2',['user',req.adminSession.token_hash]);
      response=await issue(res,client,'user',false);
      await audit(client,'password_changed','administrator');
      await client.query('COMMIT');
    } catch(err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
    res.json(response);
  });
  router.use((req,res,next) => req.adminSession.must_change ? res.status(403).json({error:'Replace the temporary password before accessing dashboard features.'}) : next());
  router.get('/content',async (_req,res)=>res.json(await contentStore.read()));
  router.put('/content',async (req,res)=>res.json(await contentStore.save(req.body,'user')));
  router.get('/inquiries',async (req,res)=>{
    const page=z.coerce.number().int().min(1).max(100000).catch(1).parse(req.query.page);
    const status=z.enum(['all','new','in_progress','resolved']).catch('all').parse(req.query.status);
    const filter=status==='all'?null:status;
    const records=await pool.query("SELECT reference,created_at,name,email,phone,location,service,message,status,notes FROM isplatty_org_inquiries WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT 20 OFFSET $2",[filter,(page-1)*20]);
    const count=await pool.query('SELECT count(*)::int AS total FROM isplatty_org_inquiries WHERE ($1::text IS NULL OR status=$1)',[filter]);
    res.json({items:records.rows,total:count.rows[0].total,page});
  });
  router.patch('/inquiries/:reference',async (req,res)=>{
    const reference=uuid.parse(req.params.reference);
    const data=z.object({status:z.enum(['new','in_progress','resolved']),notes:z.string().max(5000)}).strict().parse(req.body);
    const result=await transaction(async client=>{
      const result=await client.query('UPDATE isplatty_org_inquiries SET status=$1,notes=$2 WHERE reference=$3 RETURNING reference',[data.status,data.notes,reference]);
      if(result.rowCount)await audit(client,'update_inquiry',reference);
      return result;
    });
    if(!result.rowCount) return res.status(404).json({error:'Inquiry not found.'});
    res.json({reference});
  });
  router.delete('/inquiries/:reference',async (req,res)=>{
    const reference=uuid.parse(req.params.reference);
    const result=await transaction(async client=>{
      const result=await client.query('DELETE FROM isplatty_org_inquiries WHERE reference=$1 RETURNING reference',[reference]);
      if(result.rowCount)await audit(client,'delete_inquiry',reference);
      return result;
    });
    if(!result.rowCount)return res.status(404).json({error:'Inquiry not found.'});
    res.sendStatus(204);
  });
  router.get('/media',async (_req,res)=>{
    const result=await pool.query('SELECT * FROM isplatty_org_media ORDER BY created_at DESC LIMIT 500');
    res.json(result.rows.map(row=>({...row,url:`/org-media/${row.id}.webp`})));
  });
  router.post('/media',async(req,res,next)=>{
    if(uploadsInFlight || !await throttle(req,'admin-media',15))return res.status(429).json({error:'Photo processing is busy or the upload limit was reached. Wait before uploading another image.'});
    uploadsInFlight++;
    let released=false;
    const release=()=>{if(!released){released=true;uploadsInFlight--;}};
    res.once('finish',release);res.once('close',release);
    next();
  },express.raw({type:['image/jpeg','image/png','image/webp'],limit:'6mb'}),async (req,res)=>{
    if(!uploadDir)return res.status(503).json({error:'Photo storage is not configured. The owner must set ISPLATTY_ORG_UPLOAD_DIR to a persistent dedicated directory.'});
    if(!Buffer.isBuffer(req.body))return res.status(415).json({error:'Choose a JPEG, PNG or WebP photo.'});
    let sharp;
    try { ({ default: sharp } = await import('sharp')); }
    catch {
      log.error('Corporate photo processing is unavailable on this server');
      return res.status(503).json({error:'Photo uploads are temporarily unavailable on this server. Other administrator features remain available.'});
    }
    const id=randomUUID();
    let buffer;
    try {
      const pipeline=sharp(req.body,{limitInputPixels:20_000_000,animated:false});
      const metadata=await pipeline.metadata();
      if(!['jpeg','png','webp'].includes(metadata.format) || (metadata.pages||1)>1)throw new Error('Invalid image');
      buffer=await pipeline.rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer();
    }catch{return res.status(400).json({error:'The image could not be decoded. Use a JPEG, PNG or WebP smaller than 20 megapixels.'});}
    await mkdir(uploadDir,{recursive:true,mode:0o750});
    const file=path.join(uploadDir,`${id}.webp`);
    await writeFile(file,buffer,{mode:0o640,flag:'wx'});
    let name;
    try{name=decodeURIComponent(req.get('x-file-name')||'Photograph');}catch{name='Photograph';}
    name=name.replace(/[\x00-\x1f\x7f]/g,'').slice(0,150);
    try{
      const result=await transaction(async client=>{
        const result=await client.query('INSERT INTO isplatty_org_media(id,name) VALUES($1,$2) RETURNING *',[id,name]);
        await audit(client,'upload_photo',id);
        return result;
      });
      res.status(201).json({...result.rows[0],url:`/org-media/${id}.webp`});
    }catch(err){await unlink(file).catch(()=>{});throw err;}
  });
  router.delete('/media/:id',async (req,res)=>{
    const id=uuid.parse(req.params.id);
    const url=`/org-media/${id}.webp`;
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('isplatty_org_content'))");
      const document=await contentStore.read(client);
      if(JSON.stringify(document.content).includes(url)){await client.query('ROLLBACK');return res.status(409).json({error:'This photograph is used by published content. Replace it there and save first.'});}
      const removed=await client.query('DELETE FROM isplatty_org_media WHERE id=$1 RETURNING id',[id]);
      if(!removed.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Photograph not found.'});}
      await audit(client,'delete_photo',id);
      await client.query('COMMIT');
      if(uploadDir)await unlink(path.join(uploadDir,`${id}.webp`)).catch(()=>log.warn('An unused corporate photo file could not be removed'));
      res.sendStatus(204);
    }catch(err){await client.query('ROLLBACK');throw err;}
    finally{client.release();}
  });
  router.use((_req,res)=>res.status(404).json({error:'Administrator endpoint not found.'}));
  return router;
}
