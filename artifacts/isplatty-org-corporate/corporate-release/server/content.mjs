import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const text = z.string().trim().min(1).max(300);
const body = z.string().trim().min(1).max(6000);
const image = z.string().regex(/^$|^\/images\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$|^\/org-media\/[a-f0-9-]{36}\.webp$/);
const sections = z.array(z.object({ title: text, body }).strict()).min(1).max(30);
const page = z.object({ title: text, intro: body }).strict();
export const contentSchema = z.object({
  homepage: z.object({ headline: text, accentHeadline: text, description: body, eyebrow: text, image, primaryLabel: text, secondaryLabel: text }).strict(),
  contact: z.object({
    phone: z.string().max(30).regex(/^[+\d\s().-]*$/),
    email: z.union([z.literal(''), z.string().email().max(254)]),
    whatsapp: z.string().regex(/^$|^[1-9]\d{6,14}$/),
    address: z.string().max(300), hours: z.string().max(200),
    coverageAreas: z.array(text).max(200),
  }).strict(),
  services: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]{1,60}$/), code: text, title: text,
    icon: z.enum(['network','wifi','router','cable','server','shield','wrench','radio']),
    image, short: body, items: z.array(text).max(30),
  }).strict()).min(1).max(40),
  projects: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]{1,60}$/), img: image, tag: text, title: text, note: body, isSample: z.boolean(),
  }).strict()).max(100),
  pages: z.object({ services: page, 'customer-care': page, about: page, projects: page, coverage: page, contact: page }).strict(),
  aboutBody: z.array(body).min(1).max(30), whyChoose: sections, faq: sections,
  privacy: sections, terms: sections,
}).strict().superRefine((value, ctx) => {
  for (const group of ['services', 'projects']) {
    if (new Set(value[group].map(i => i.id)).size !== value[group].length)
      ctx.addIssue({ code: 'custom', message: `Each ${group} item needs a unique id.`, path: [group] });
  }
});

export async function createContentStore(pool, root, initialContact = {}) {
  const defaults = JSON.parse(await readFile(path.join(root, 'server/content-defaults.json'), 'utf8'));
  defaults.contact = { ...defaults.contact, ...initialContact };
  const builtInImages = new Set((await readdir(path.join(root, 'public/images')).catch(() => []))
    .map(name => `/images/${name}`));
  // The release includes public images under dist/public, not public/.
  for (const name of await readdir(path.join(root, 'dist/public/images')).catch(() => [])) builtInImages.add(`/images/${name}`);
  async function read(db = pool) {
    const result = await db.query('SELECT content, version, updated_at FROM isplatty_org_content WHERE singleton = true');
    if (!result.rowCount) return { content: structuredClone(defaults), version: 0, updatedAt: null };
    return { content: result.rows[0].content, version: result.rows[0].version, updatedAt: result.rows[0].updated_at };
  }
  async function save(data, actor) {
    const parsed = contentSchema.safeParse(data.content);
    if (!parsed.success) throw Object.assign(new Error(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).slice(0, 4).join('; ')), { status: 400 });
    if (!Number.isInteger(data.version) || data.version < 0) throw Object.assign(new Error('Invalid content version.'), { status: 400 });
    const content = parsed.data;
    const paths = [content.homepage.image, ...content.services.map(s => s.image), ...content.projects.map(p => p.img)];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('isplatty_org_content'))");
      for (const item of new Set(paths.filter(Boolean))) {
        if (item.startsWith('/images/') && !builtInImages.has(item))
          throw Object.assign(new Error(`Photo not found: ${item}`), { status: 400 });
        if (item.startsWith('/org-media/')) {
          const found = await client.query('SELECT id FROM isplatty_org_media WHERE id = $1', [item.split('/').pop().replace('.webp','')]);
          if (!found.rowCount) throw Object.assign(new Error('An uploaded photo was not found. Reload the media library.'), { status: 400 });
        }
      }
      const current = await read(client);
      if (current.version !== data.version) throw Object.assign(new Error('Someone saved a newer version. Reload before saving; your changes have not been published.'), { status: 409 });
      await client.query(`INSERT INTO isplatty_org_content (singleton,content,version) VALUES (true,$1,$2)
        ON CONFLICT(singleton) DO UPDATE SET content=EXCLUDED.content,version=EXCLUDED.version,updated_at=now()`,
      [JSON.stringify(content), current.version + 1]);
      await client.query('INSERT INTO isplatty_org_admin_audit (actor,action,resource) VALUES ($1,$2,$3)', [actor,'publish_content',String(current.version+1)]);
      const result = await read(client);
      await client.query('COMMIT');
      return result;
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  }
  return { read, save };
}
