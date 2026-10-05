export const imageLimit = 1024 * 1024;

export function productDetails(body, existing = {}) {
  const values = {};
  for (const [key, max] of [['specification', 500], ['note', 2000]]) {
    const value = body[key] === undefined ? (existing[key] ?? '') : body[key];
    if (typeof value !== 'string' || value.length > max)
      throw new Error(`${key === 'note' ? '备注' : '规格'}最多 ${max} 字。`);
    values[key] = value.trim();
  }
  const image = body.image === undefined ? (existing.image ?? '') : body.image;
  if (typeof image !== 'string') throw new Error('商品图片格式无效。');
  if (image) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if (!match || match[2].length > Math.ceil(imageLimit / 3) * 4)
      throw new Error('商品图片需为 PNG、JPEG 或 WebP，大小不超过 1 MB。');
    const bytes = Buffer.from(match[2], 'base64');
    const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid || bytes.length > imageLimit || bytes.toString('base64') !== match[2])
      throw new Error('商品图片内容或大小无效。');
  }
  return { ...values, image };
}

export function categoryPaths(categories) {
  const byId = new Map(categories.map(c => [c.id, c]));
  const paths = new Map();
  const siblings = new Set();
  for (const c of categories) {
    if (!Number.isSafeInteger(c.id) || c.id < 1 || typeof c.name !== 'string' || !c.name.trim() || c.name !== c.name.trim() || c.name.length > 100 ||
        !(c.parent_id === null || byId.has(c.parent_id))) throw new Error('分类名称或上级分类无效。');
    const key = JSON.stringify([c.parent_id, c.name]);
    if (siblings.has(key)) throw new Error('同级分类名称不能重复。');
    siblings.add(key);
    const chain = [], seen = new Set();
    let node = c;
    while (node) {
      if (seen.has(node.id)) throw new Error('分类不能移到自身或下级分类中。');
      seen.add(node.id);
      chain.unshift(node.name);
      if (chain.length > 10) throw new Error('分类最多支持 10 层。');
      node = byId.get(node.parent_id);
    }
    paths.set(c.id, chain.join(' / '));
  }
  return paths;
}

export function migrateCatalog(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER REFERENCES categories(id));
    CREATE UNIQUE INDEX IF NOT EXISTS categories_sibling_name ON categories(COALESCE(parent_id,0),name);`);
  const columns = new Set(db.prepare('PRAGMA table_info(products)').all().map(c => c.name));
  for (const [key, definition] of Object.entries({category_id: 'INTEGER REFERENCES categories(id)', image: "TEXT NOT NULL DEFAULT ''", specification: "TEXT NOT NULL DEFAULT ''", note: "TEXT NOT NULL DEFAULT ''"}))
    if (!columns.has(key)) db.exec(`ALTER TABLE products ADD COLUMN ${key} ${definition}`);
  for (const p of db.prepare('SELECT id,category FROM products WHERE category_id IS NULL').all()) {
    let c = db.prepare('SELECT id FROM categories WHERE parent_id IS NULL AND name=?').get(p.category);
    if (!c) c = {id: Number(db.prepare('INSERT INTO categories(name,parent_id) VALUES (?,NULL)').run(p.category).lastInsertRowid)};
    db.prepare('UPDATE products SET category_id=? WHERE id=?').run(c.id, p.id);
  }
}

export function installCatalog(app, db) {
  const categories = () => db.prepare('SELECT * FROM categories ORDER BY name,id').all();
  const paths = () => categoryPaths(categories());
  // Legacy clients and CSV imports may still send a flat category name.
  function resolveCategory(body) {
    if (body.category_id !== undefined && body.category_id !== null && body.category_id !== '') {
      if (!Number.isSafeInteger(body.category_id) || !paths().has(body.category_id)) throw new Error('请选择有效的商品分类。');
      return body.category_id;
    }
    const name = body.category.trim();
    const matches = [...paths()].filter(([, path]) => path === name);
    if (matches.length === 1) return matches[0][0];
    let c = db.prepare('SELECT id FROM categories WHERE parent_id IS NULL AND name=?').get(name);
    if (!c) {
      if (name.length > 100) throw new Error('分类名称最多 100 字，请选择已有分类。');
      c = { id: Number(db.prepare('INSERT INTO categories(name,parent_id) VALUES (?,NULL)').run(name).lastInsertRowid) };
    }
    return c.id;
  }
  function catalogValues(body, existing) {
    const { image, specification, note } = productDetails(body, existing);
    const id = resolveCategory(body);
    return { path: paths().get(id), values: [id, image, specification, note] };
  }
  const mutate = fn => (req, res) => {
    try {
      db.exec('BEGIN IMMEDIATE');
      const result = fn(req);
      const allPaths = paths();
      const update = db.prepare('UPDATE products SET category=? WHERE category_id=?');
      for (const [id, path] of allPaths) update.run(path, id);
      db.exec('COMMIT');
      res.json(result);
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      res.status(400).json({ error: e.message.includes('UNIQUE') ? '同级分类名称不能重复。' : e.message });
    }
  };
  app.get('/api/categories', (_, res) => res.json(categories()));
  const save = (req, id) => {
    const { name, parent_id = null } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new Error('请填写 1–100 字的分类名称。');
    if (parent_id !== null && (!Number.isSafeInteger(parent_id) || !categories().some(c => c.id === parent_id))) throw new Error('上级分类不存在。');
    if (id) {
      if (!categories().some(c => c.id === id)) throw new Error('分类不存在。');
      db.prepare('UPDATE categories SET name=?,parent_id=? WHERE id=?').run(name.trim(), parent_id, id);
      return { id };
    }
    return { id: Number(db.prepare('INSERT INTO categories(name,parent_id) VALUES (?,?)').run(name.trim(), parent_id).lastInsertRowid) };
  };
  app.post('/api/categories', mutate(req => save(req)));
  app.put('/api/categories/:id', mutate(req => save(req, Number(req.params.id))));
  app.post('/api/categories/:id/delete', mutate(req => {
    const id = Number(req.params.id);
    if (db.prepare('SELECT 1 FROM categories WHERE parent_id=?').get(id) || db.prepare('SELECT 1 FROM products WHERE category_id=?').get(id))
      throw new Error('请先移走下级分类和商品，再删除分类。');
    if (!db.prepare('DELETE FROM categories WHERE id=?').run(id).changes) throw new Error('分类不存在。');
    return { ok: true };
  }));
  return { catalogValues };
}
