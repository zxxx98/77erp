import { remapChecks, needsQualityReview } from '../shared/quality-checks.js';
import express from 'express';
import multer from 'multer';
import { randomUUID, createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { hasPermission } from '../shared/permissions.js';
import { validateDefinition, previewDefinition, parseRegion } from '../shared/quality-template.js';
import { parseAcceptance } from '../shared/quality-acceptance.js';
import { acceptanceSheetResults, sheetUniqueKey } from '../shared/quality-bindings.js';
import { isDeepStrictEqual } from 'node:util';
import { readQualityWorkbook } from './quality-workbook.js';
import { operationRequest, saveOperationRequest } from './operations.js';
import { installQualityCharts, migrateQualityCharts, validateQualityChartsBackup } from './quality-charts.js';

export const qualityTables = ['quality_template_files','quality_templates','quality_template_revisions','quality_template_events','quality_acceptances','quality_charts'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const error = (message, status = 400) => Object.assign(new Error(message), { status });
export function migrateQuality(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS quality_template_files (
    id INTEGER PRIMARY KEY, warehouse_id INTEGER NOT NULL REFERENCES warehouses(id), account_id TEXT NOT NULL, bucket TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, workbook TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS quality_templates (
    id INTEGER PRIMARY KEY, warehouse_id INTEGER NOT NULL REFERENCES warehouses(id), name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    file_id INTEGER NOT NULL REFERENCES quality_template_files(id), definition TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
    published_revision INTEGER, version INTEGER NOT NULL DEFAULT 1, created_by_name TEXT NOT NULL, updated_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS quality_template_revisions (
    id INTEGER PRIMARY KEY, template_id INTEGER NOT NULL REFERENCES quality_templates(id), revision INTEGER NOT NULL,
    file_id INTEGER NOT NULL REFERENCES quality_template_files(id), name TEXT NOT NULL, definition TEXT NOT NULL,
    created_by_name TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(template_id,revision));
    CREATE TABLE IF NOT EXISTS quality_template_events (
    id INTEGER PRIMARY KEY, template_id INTEGER NOT NULL REFERENCES quality_templates(id), action TEXT NOT NULL, version INTEGER NOT NULL,
    created_by_name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS quality_acceptances (
    id INTEGER PRIMARY KEY, warehouse_id INTEGER NOT NULL REFERENCES warehouses(id), number TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', template_id INTEGER NOT NULL REFERENCES quality_templates(id),
    revision_id INTEGER NOT NULL REFERENCES quality_template_revisions(id), file_id INTEGER NOT NULL REFERENCES quality_template_files(id),
    result TEXT NOT NULL, created_by_name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS quality_acceptances_warehouse ON quality_acceptances(warehouse_id,created_at);
    CREATE INDEX IF NOT EXISTS quality_templates_warehouse ON quality_templates(warehouse_id,updated_at);`);
  if (!db.prepare('PRAGMA table_info(quality_acceptances)').all().some(column => column.name === 'bindings'))
    db.exec("ALTER TABLE quality_acceptances ADD COLUMN bindings TEXT NOT NULL DEFAULT '[]'");
  if (!db.prepare('PRAGMA table_info(quality_acceptances)').all().some(column => column.name === 'checks_acknowledged'))
    db.exec('ALTER TABLE quality_acceptances ADD COLUMN checks_acknowledged INTEGER NOT NULL DEFAULT 0');
  migrateQualityCharts(db);
}
export function clearQuality(db) {
  db.exec('DELETE FROM quality_charts; DELETE FROM quality_acceptances; DELETE FROM quality_template_events; DELETE FROM quality_template_revisions; DELETE FROM quality_templates; DELETE FROM quality_template_files;');
}
export function validateQualityBackup(data) {
  const files = new Map(data.quality_template_files.map(row=>[row.id,row]));
  const templates = new Map(data.quality_templates.map(row=>[row.id,row]));
  const products = new Map(data.products.map(row=>[row.id,row]));
  const warehouseIds = new Set(data.warehouses.map(w=>w.id));
  const text = (v,n=200) => typeof v === 'string' && v.length <= n;
  for (const file of files.values()) {
    if (!warehouseIds.has(file.warehouse_id) || !/^[a-f\d]{32}$/i.test(file.account_id) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(file.bucket) ||
        !text(file.object_key,1000) || !/^[a-zA-Z0-9/_-]+\.xlsx$/.test(file.object_key) || file.object_key.startsWith('/') || file.object_key.includes('//') ||
        !text(file.filename,200) || !/\.xlsx$/i.test(file.filename) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 10485760 || !/^[a-f\d]{64}$/.test(file.sha256) ||
        !text(file.workbook,5*1024*1024) || !text(file.created_at,100)) throw error('备份 Excel 文件引用无效。');
    const wb = JSON.parse(file.workbook);
    if (!Array.isArray(wb.sheets) || !wb.sheets.length || wb.sheets.length > 20) throw error('备份工作簿无效。');
    let totalCells = 0;
    const sheetNames = new Set();
    for (const s of wb.sheets) {
      if (!text(s.name,100) || !Number.isInteger(s.rows) || s.rows<1 || s.rows>2000 || !Number.isInteger(s.cols) || s.cols<1 || s.cols>100 || s.rows*s.cols>50000 ||
          !s.cells || typeof s.cells !== 'object' || Array.isArray(s.cells) || !Array.isArray(s.merges) || s.merges.length > 10000 || !Array.isArray(s.widths) ||
          s.widths.length !== s.cols || s.widths.some(w=>typeof w!=='number'||!Number.isFinite(w)||w<40||w>500) ||
          sheetNames.has(s.name) || (totalCells += s.rows*s.cols)>200000) throw error('备份工作表无效。');
      sheetNames.add(s.name);
      for (const [addr,cell] of Object.entries(s.cells)) {
        const r = parseRegion(addr);
        if (r.r1!==r.r2 || r.c1!==r.c2 || r.r2>s.rows || r.c2>s.cols || !cell || !text(cell.text,10000) ||
            !['string','number','boolean'].includes(typeof cell.value) || typeof cell.value==='number'&&!Number.isFinite(cell.value) ||
            !text(cell.format,1000) || cell.error!==undefined&&!text(cell.error,2000) || cell.date!==undefined&&!/^\d{4}-\d{2}-\d{2}$/.test(cell.date)) throw error('备份单元格无效。');
      }
      for (const merge of s.merges) {const r=parseRegion(merge);if(r.r2>s.rows||r.c2>s.cols)throw error('备份合并区域无效。');}
    }
  }
  for (const t of templates.values()) {
    const file = files.get(t.file_id);
    if (!file || file.warehouse_id !== t.warehouse_id || !text(t.name,60) || !t.name.trim() || !text(t.note,1000) || ![0,1].includes(t.enabled) ||
        !Number.isSafeInteger(t.version) || t.version<1 || !text(t.created_by_name,60) || !text(t.updated_by_name,60) || !text(t.created_at,100) || !text(t.updated_at,100)) throw error('备份品质模板无效。');
    validateDefinition(JSON.parse(t.definition),JSON.parse(file.workbook));
    if (t.published_revision !== null && !data.quality_template_revisions.some(r=>r.id===t.published_revision && r.template_id===t.id)) throw error('模板发布版本关联无效。');
    if (t.enabled && t.published_revision === null) throw error('模板缺少启用版本。');
  }
  const revisionKeys = new Set();
  for (const r of data.quality_template_revisions) {
    const t = templates.get(r.template_id), f = files.get(r.file_id), key = `${r.template_id}:${r.revision}`;
    if (!t || !f || t.warehouse_id !== f.warehouse_id || !Number.isSafeInteger(r.revision) || r.revision<1 || revisionKeys.has(key) ||
        !text(r.name,60) || !r.name.trim() || !text(r.created_by_name,60) || !text(r.created_at,100)) throw error('备份品质模板版本无效。');
    revisionKeys.add(key); validateDefinition(JSON.parse(r.definition),JSON.parse(f.workbook),{publish:true});
  }
  for (const e of data.quality_template_events) if (!templates.has(e.template_id) || !['create','save','publish','status','copy'].includes(e.action) ||
      !Number.isSafeInteger(e.version) || e.version<1 || !text(e.created_by_name,60) || !text(e.created_at,100)) throw error('备份品质操作记录无效。');
  const acceptanceNumbers = new Set();
  for (const a of data.quality_acceptances) {
    const t = templates.get(a.template_id), f = files.get(a.file_id);
    const r = data.quality_template_revisions.find(rev => rev.id === a.revision_id && rev.template_id === a.template_id);
    if (!t || !f || !r || a.warehouse_id !== t.warehouse_id || a.warehouse_id !== f.warehouse_id ||
        !text(a.number,60) || acceptanceNumbers.has(a.number) || !/^QA-\d{8}-[A-F0-9]{12}$/.test(a.number) || !text(a.name,100) || !a.name.trim() ||
        !text(a.note,1000) || !text(a.result,5*1024*1024) || !text(a.created_by_name,60) || !text(a.created_at,100))
      throw error('备份验收单关联或字段无效。');
    acceptanceNumbers.add(a.number);
    const snapshot = JSON.parse(a.result);
    if(!snapshot || snapshot.schemaVersion===2&&!Array.isArray(snapshot.sheets))throw error('备份验收单工作表结果无效。');
    const options = snapshot.schemaVersion===2 ? {sheetNames:snapshot.sheets.map(sheet=>sheet.sheetName)} : {};
    options.corrections = (snapshot.sheets || [{sheetName:JSON.parse(r.definition).sheetName,...snapshot}]).flatMap(sheet =>
      (sheet.manualCorrections || []).map(({address,text}) => ({sheetName:sheet.sheetName,address,text})));
    const parsed = parseAcceptance(JSON.parse(r.definition), JSON.parse(files.get(r.file_id).workbook), JSON.parse(f.workbook),options);
    if(![0,1].includes(a.checks_acknowledged)||needsQualityReview(parsed)&&a.checks_acknowledged!==1)throw error('备份验收单缺少核对确认。');
    if (parsed.issues.length || !isDeepStrictEqual(snapshot, parsed)) throw error('备份验收单解析数据不一致。');
    if(!text(a.bindings,1024*1024))throw error('备份验收单物料绑定数据无效。');
    const bindings = JSON.parse(a.bindings);
    const definition = JSON.parse(r.definition), sheets = acceptanceSheetResults(definition, parsed);
    if (!Array.isArray(bindings) || bindings.length && (bindings.length !== sheets.length || new Set(bindings.map(binding=>binding.sheetName)).size !== sheets.length)) throw error('备份验收单物料绑定工作表无效。');
    for (const binding of bindings) {
      const sheet = sheets.find(sheet=>sheet.sheetName===binding.sheetName);
      if (!sheet || Object.keys(binding).length !== 5 || !['none','auto','manual'].includes(binding.mode) || binding.keyValue !== sheetUniqueKey(definition,sheet).keyValue) throw error('备份验收单物料绑定无效。');
      if (binding.mode === 'none') {
        if (binding.product !== null || binding.product_id !== null) throw error('备份验收单未绑定物料的数据无效。');
        continue;
      }
      const product = products.get(binding.product_id);
      const saved = binding.product;
      if (!product || product.warehouse_id !== a.warehouse_id || !saved || Object.keys(saved).length !== 5 || saved.id !== product.id || !text(saved.name,100) || !saved.name.trim() ||
          !text(saved.barcode,100) || !saved.barcode.trim() || !text(saved.specification,500) || !text(saved.unit,100) || binding.mode === 'auto' && !binding.keyValue)
        throw error('备份验收单绑定的物料或快照无效。');
    }
  }

  validateQualityChartsBackup(data);
}
function clientFor(c) {
  return new S3Client({ region:'auto', endpoint:`https://${c.account_id}.r2.cloudflarestorage.com`, credentials:{accessKeyId:c.access_key,secretAccessKey:c.secret_key}, maxAttempts:2 });
}
const storage = {
  async put(c,key,buffer) { const client=clientFor(c); try { await client.send(new PutObjectCommand({Bucket:c.bucket,Key:key,Body:buffer,ContentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',IfNoneMatch:'*'}),{abortSignal:AbortSignal.timeout(60000)}); } finally {client.destroy();} },
  async get(c,key) { const client=clientFor(c); try { const r=await client.send(new GetObjectCommand({Bucket:c.bucket,Key:key}),{abortSignal:AbortSignal.timeout(60000)}); if(r.ContentLength>10485760) {r.Body.destroy();throw error('原文件大小无效。');} return Buffer.from(await r.Body.transformToByteArray()); } finally {client.destroy();} },
  async head(c,key) { const client=clientFor(c); try { await client.send(new HeadObjectCommand({Bucket:c.bucket,Key:key}),{abortSignal:AbortSignal.timeout(15000)}); } finally {client.destroy();} },
  async remove(c,key) { const client=clientFor(c); try { await client.send(new DeleteObjectCommand({Bucket:c.bucket,Key:key}),{abortSignal:AbortSignal.timeout(15000)}); } finally {client.destroy();} },
};
export function installQuality(app, db, options = {}) {
  const router = express.Router(), store = options.qualityStorage || storage;
  const previewSecret = randomBytes(32);
  const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:10485760,files:1,fields:10,fieldSize:2*1024*1024}}).single('file');
  const r2 = () => JSON.parse(db.prepare('SELECT config FROM r2_backup_settings WHERE id=1').get().config);
  const fresh = req => {
    const user = options.sessionUser(req);
    if (!user) throw error('登录已失效，请重新登录。',401);
    if (!hasPermission(user,'quality')) throw error('没有品质管理权限。',403);
    req.user = user;
    if (!db.prepare('SELECT 1 FROM warehouses WHERE id=?').get(req.warehouse.id)) throw error('仓库不存在。',409);
  };
  const config = file => {
    const c = r2();
    if (!c.account_id || !c.bucket || !c.access_key || !c.secret_key) throw error('请管理员先在系统设置中配置 R2 账户、存储桶和访问凭据。',503);
    if (file && (file.account_id!==c.account_id || file.bucket!==c.bucket)) throw error('原文件位于此前的 R2 账户或存储桶，请管理员迁移或恢复连接配置。',503);
    return c;
  };
  const get = req => {
    const id = Number(req.params.id);
    const row = Number.isSafeInteger(id) && db.prepare('SELECT * FROM quality_templates WHERE id=? AND warehouse_id=?').get(id,req.warehouse.id);
    if (!row) throw error('模板不存在或不属于当前仓库。',404);
    return row;
  };
  const versionOf = (req,row) => { if (Number(req.body.version)!==row.version) throw error('模板已被修改，请保留当前内容并重新打开。',409); };
  const owner = req => req.user.name || req.user.username;
  const event = (req,id,action,version) => db.prepare('INSERT INTO quality_template_events(template_id,action,version,created_by_name,created_at) VALUES (?,?,?,?,?)').run(id,action,version,owner(req),new Date().toISOString());
  const detail = row => {
    const file=db.prepare('SELECT filename,workbook FROM quality_template_files WHERE id=?').get(row.file_id);
    const revisions=db.prepare('SELECT id,revision,name,file_id,created_at,created_by_name FROM quality_template_revisions WHERE template_id=? ORDER BY revision DESC').all(row.id);
    const current=row.published_revision && db.prepare('SELECT * FROM quality_template_revisions WHERE id=?').get(row.published_revision);
    return {...row,definition:JSON.parse(row.definition),workbook:JSON.parse(file.workbook),filename:file.filename,revisions,has_draft:!current||current.definition!==row.definition||current.file_id!==row.file_id||current.name!==row.name};
  };
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const result=fn();db.exec('COMMIT');return result;} catch(e){db.exec('ROLLBACK');throw e;} };
  const run = fn => async(req,res,next)=>{try{fresh(req);const result=await fn(req,res);if(!res.headersSent)res.json(result);}catch(e){next(e);}};
  installQualityCharts(router,db,{run,transaction,owner});
  const multipart = (req,res,next)=>upload(req,res,e=>e?next(error(e.code==='LIMIT_FILE_SIZE'?'Excel 文件不能超过 10 MB。':'上传内容无效或过大。')):next());
  const readFile = async req => {
    if (!req.file || !/\.xlsx$/i.test(req.file.originalname)) throw error('请选择 .xlsx 文件。');
    let filename=req.file.originalname;
    const decoded=Buffer.from(filename,'latin1').toString('utf8');
    if (!decoded.includes('\uFFFD')) filename=decoded;
    filename=filename.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,190);
    const workbook=await readQualityWorkbook(req.file.buffer); fresh(req);
    return {filename,workbook,sha256:digest(req.file.buffer)};
  };
  const acceptance = req => {
    const id = Number(req.params.id);
    const row = Number.isSafeInteger(id) && db.prepare('SELECT * FROM quality_acceptances WHERE id=? AND warehouse_id=?').get(id,req.warehouse.id);
    if (!row) throw error('验收单不存在或不属于当前仓库。',404);
    return row;
  };
  const acceptanceDetail = row => {
    const revision = db.prepare('SELECT revision,name,definition FROM quality_template_revisions WHERE id=?').get(row.revision_id);
    const file = db.prepare('SELECT filename FROM quality_template_files WHERE id=?').get(row.file_id);
    return {...row,bindings:JSON.parse(row.bindings),result:JSON.parse(row.result),definition:JSON.parse(revision.definition),revision:revision.revision,template_name:revision.name,filename:file.filename};
  };
  const activeRevision = req => {
    const id = Number(req.body.template_id), revisionId = Number(req.body.revision_id);
    const t = Number.isSafeInteger(id) && db.prepare('SELECT * FROM quality_templates WHERE id=? AND warehouse_id=?').get(id,req.warehouse.id);
    if (!t) throw error('模板不存在或不属于当前仓库。',404);
    if (!t.enabled || !t.published_revision || t.published_revision !== revisionId) throw error('模板已停用或发布版本已变化，请重新选择模板并解析。',409);
    return db.prepare('SELECT * FROM quality_template_revisions WHERE id=? AND template_id=?').get(revisionId,id);
  };
  const dataSheets = (req,file) => {
    if(req.body.sheet_names===undefined)return undefined;
    const names=req.body.sheet_names==='*'?file.workbook.sheets.map(sheet=>sheet.name):JSON.parse(req.body.sheet_names);
    if(!Array.isArray(names)||!names.length||names.length>20||new Set(names).size!==names.length||names.some(name=>typeof name!=='string'||!file.workbook.sheets.some(sheet=>sheet.name===name)))throw error('请选择上传文件中的 1–20 个不重复的数据工作表。');
    return file.workbook.sheets.filter(sheet=>names.includes(sheet.name)).map(sheet=>sheet.name);
  };
  const parseFile = (revision, file, sheetNames, corrections) => {
    const original = db.prepare('SELECT workbook FROM quality_template_files WHERE id=?').get(revision.file_id);
    const parsed = parseAcceptance(JSON.parse(revision.definition),JSON.parse(original.workbook),file.workbook,{sheetNames,corrections});
    if(Buffer.byteLength(JSON.stringify(parsed))>5*1024*1024)throw error('解析结果超过 5 MB，请减少填写内容或模板字段范围。');
    return parsed;
  };
  const productColumns = 'id,name,barcode,specification,unit';
  const matchKeys = (warehouseId, keys) => keys.map(({sheetName,...key})=>{
    const products = key.keyStatus === 'ready' ? db.prepare(`SELECT ${productColumns} FROM products WHERE warehouse_id=? AND active=1 AND
      (barcode=? OR name=? OR EXISTS (SELECT 1 FROM json_each(products.customer_part_numbers) cp WHERE json_extract(cp.value,'$.part_number')=?)) ORDER BY id LIMIT 2`).all(warehouseId,key.keyValue,key.keyValue,key.keyValue) : [];
    const product = products.length === 1 ? products[0] : null;
    return {sheetName,...key,status:key.keyStatus==='ready'?(product?'matched':products.length?'ambiguous':'not_found'):key.keyStatus,
      mode:product?'auto':'manual',product_id:product?.id||null,product};
  });
  const bindingSuggestions = (warehouseId, definition, result) => matchKeys(warehouseId,acceptanceSheetResults(definition,result).map(sheet=>({sheetName:sheet.sheetName,...sheetUniqueKey(definition,sheet)})));
  // Normalize only user choices for idempotency; resolve all material data on the server.
  const bindingChoices = (raw, names) => {
    if (raw === undefined) return undefined; // Historical clients may save without binding.
    let choices;try {choices=JSON.parse(raw);}catch {throw error('物料绑定数据无效。');}
    if (!Array.isArray(choices) || choices.length !== names.length || new Set(choices.map(choice=>choice?.sheetName)).size !== names.length) throw error('请逐个确认所选工作表的物料绑定。');
    return names.map(sheetName=>{
      const choice=choices.find(choice=>choice?.sheetName===sheetName);
      if (!choice || !['none','auto','manual'].includes(choice.mode) || (choice.mode==='none'?choice.product_id!==null:!Number.isSafeInteger(choice.product_id)||choice.product_id<1)) throw error(`请为工作表“${sheetName}”选择物料，或取消绑定。`);
      return {sheetName,mode:choice.mode,product_id:choice.product_id};
    });
  };
  const resolveBindings = (warehouseId, definition, result, choices) => {
    if (choices===undefined) return [];
    const suggestions=bindingSuggestions(warehouseId,definition,result);
    return choices.map(choice=>{
      const suggestion=suggestions.find(suggestion=>suggestion.sheetName===choice.sheetName);
      if(choice.mode==='none')return {...choice,keyValue:suggestion.keyValue,product:null};
      const product=db.prepare(`SELECT ${productColumns} FROM products WHERE id=? AND warehouse_id=? AND active=1`).get(choice.product_id,warehouseId);
      if(!product)throw error(`工作表“${choice.sheetName}”选择的物料不存在、已停用或不属于当前仓库，请重新选择。`);
      if(choice.mode==='auto' && suggestion.product_id!==product.id)throw error(`工作表“${choice.sheetName}”的自动匹配结果已变化，请重新解析或手动选择物料。`,409);
      return {...choice,keyValue:suggestion.keyValue,product};
    });
  };
  const sign = payload => createHmac('sha256',previewSecret).update(payload).digest('base64url');
  const verifyPreview = (req,file,revision) => {
    try {
      const [payload,signature,...extra] = String(req.body.preview_token||'').split('.');
      const expected = Buffer.from(sign(payload)), actual = Buffer.from(signature||'');
      if (extra.length || expected.length !== actual.length || !timingSafeEqual(expected,actual)) throw 0;
      const token = JSON.parse(Buffer.from(payload,'base64url').toString());
      if (token.expires < Date.now() || token.user !== req.user.id || token.warehouse !== req.warehouse.id ||
          token.revision !== revision.id || token.sha256 !== file.sha256 || JSON.stringify(token.sheet_names??null)!==JSON.stringify(req.body.sheet_names??null)) throw 0;
    } catch { throw error('解析预览已失效或文件已变化，请重新上传解析后确认。',409); }
  };
  router.get('/acceptance-templates',run(req=>({templates:db.prepare(`
    SELECT t.id,r.id AS revision_id,r.revision,r.name,f.filename FROM quality_templates t
    JOIN quality_template_revisions r ON r.id=t.published_revision JOIN quality_template_files f ON f.id=r.file_id
    WHERE t.warehouse_id=? AND t.enabled=1 ORDER BY t.updated_at DESC,t.id DESC`).all(req.warehouse.id)})));
  router.get('/acceptance-templates/:id',run(req=>{
    const revision=activeRevision({...req,body:{template_id:req.params.id,revision_id:req.query.revision_id}});
    const original=db.prepare('SELECT workbook FROM quality_template_files WHERE id=?').get(revision.file_id);
    return {definition:JSON.parse(revision.definition),workbook:JSON.parse(original.workbook),template:{id:revision.template_id,revision_id:revision.id,revision:revision.revision,name:revision.name}};
  }));
  // Query material candidates only; save resolves these again from the actual Excel.
  router.post('/binding-suggestions',run(req=>{
    const keys=req.body.keys;
    if(!Array.isArray(keys)||!keys.length||keys.length>20||new Set(keys.map(key=>key?.sheetName)).size!==keys.length||keys.some(key=>!key||typeof key.sheetName!=='string'||!key.sheetName||key.sheetName.length>100||typeof key.keyValue!=='string'||key.keyValue.length>10000||!['ready','missing_key','invalid_key','empty_key','multiple_keys'].includes(key.keyStatus)))throw error('物料匹配条件无效。');
    return {bindings:matchKeys(req.warehouse.id,keys.map(({sheetName,keyValue,keyStatus})=>({sheetName,keyValue,keyStatus})))};
  }));
  router.get('/products',run(req=>{
    const q=String(req.query.q||'').trim(),offset=Number(req.query.offset||0);
    if(q.length>100||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw error('物料搜索条件无效。');
    const where=`warehouse_id=? AND active=1 AND (instr(barcode,?)>0 OR instr(name,?)>0 OR instr(specification,?)>0 OR EXISTS
      (SELECT 1 FROM json_each(products.customer_part_numbers) cp WHERE instr(json_extract(cp.value,'$.part_number'),?)>0))`;
    const args=[req.warehouse.id,q,q,q,q];
    return {products:db.prepare(`SELECT ${productColumns} FROM products WHERE ${where} ORDER BY id LIMIT 20 OFFSET ?`).all(...args,offset),
      total:db.prepare(`SELECT COUNT(*) AS n FROM products WHERE ${where}`).get(...args).n};
  }));
  router.get('/acceptances',run(req=>{
    const q=String(req.query.q||'').slice(0,100),offset=Number(req.query.offset)||0;
    if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw error('分页位置无效。');
    const where='a.warehouse_id=? AND (a.name LIKE ? OR a.number LIKE ?)';
    const args=[req.warehouse.id,`%${q}%`,`%${q}%`];
    return {total:db.prepare(`SELECT COUNT(*) AS n FROM quality_acceptances a WHERE ${where}`).get(...args).n,
      acceptances:db.prepare(`SELECT a.id,a.number,a.name,a.note,a.created_at,a.created_by_name,r.name AS template_name,r.revision,f.filename
        FROM quality_acceptances a JOIN quality_template_revisions r ON r.id=a.revision_id
        JOIN quality_template_files f ON f.id=a.file_id WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT 20 OFFSET ?`).all(...args,offset)};
  }));
  router.post('/acceptances/preview',multipart,run(async req=>{
    const file=await readFile(req),revision=activeRevision(req),sheetNames=dataSheets(req,file),preview=parseFile(revision,file,sheetNames);
    const expires=Date.now()+15*60*1000;
    const payload=Buffer.from(JSON.stringify({expires,user:req.user.id,warehouse:req.warehouse.id,revision:revision.id,sha256:file.sha256,sheet_names:sheetNames})).toString('base64url');
    return {filename:file.filename,definition:JSON.parse(revision.definition),workbook:file.workbook,preview,sheet_names:sheetNames,
      bindings:bindingSuggestions(req.warehouse.id,JSON.parse(revision.definition),preview),
      template:{id:revision.template_id,revision_id:revision.id,revision:revision.revision,name:revision.name},
      preview_token:`${payload}.${sign(payload)}`,expires_at:new Date(expires).toISOString()};
  }));
  router.post('/acceptances',multipart,run(async req=>{
    const file=await readFile(req),sheetNames=dataSheets(req,file);
    let corrections;
    if(req.body.corrections!==undefined){
      try { corrections=JSON.parse(req.body.corrections); } catch { throw error('手动修正数据格式无效。'); }
      if(!Array.isArray(corrections))throw error('手动修正数据必须是数组。');
    }
    const bindingRevision=req.body.bindings===undefined?null:db.prepare('SELECT definition FROM quality_template_revisions WHERE id=?').get(Number(req.body.revision_id));
    const choices=req.body.bindings===undefined?undefined:bindingChoices(req.body.bindings,sheetNames||[bindingRevision?JSON.parse(bindingRevision.definition).sheetName:'']);
    const name=String(req.body.name||'').trim(),note=String(req.body.note||'').trim();
    if(!name||name.length>100||note.length>1000)throw error('请输入 1–100 字验收单名称，备注不超过 1000 字。');
    // Idempotent retries can return an already saved record after preview expiry or a newer publication.
    const checksAcknowledged=req.body.checks_acknowledged==='true';
    const body={...(checksAcknowledged?{checks_acknowledged:true}:{}),...(corrections===undefined?{}:{corrections}),template_id:Number(req.body.template_id),revision_id:Number(req.body.revision_id),name,note,sha256:file.sha256,request_id:req.body.request_id,...(sheetNames===undefined?{}:{sheet_names:sheetNames}),...(choices===undefined?{}:{bindings:choices})};
    const previewToken=req.body.preview_token;req.body=body;
    let request=operationRequest(db,req);
    if(request.previous)return acceptanceDetail(acceptance({...req,params:{id:request.previous.id}}));
    const revision=activeRevision(req);
    // Local previews need no server credential. Keep validation for legacy clients
    // that explicitly submit a signed token; all clients are reparsed below.
    if(previewToken!==undefined){req.body.preview_token=previewToken;verifyPreview(req,file,revision);delete req.body.preview_token;}
    const result=parseFile(revision,file,sheetNames,corrections);
    if(result.issues.length)throw error('验收单仍有解析错误，请在定位面板手动修正，或修正 Excel 并重新上传。');
    if(needsQualityReview(result)&&!checksAcknowledged)throw error('请先核对系统发现的差异及待确认项，再确认保留原报告结果。');
    resolveBindings(req.warehouse.id,JSON.parse(revision.definition),result,choices);
    const c=config(),key=`${c.excel_prefix||'excel'}/${db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value}/acceptances/${randomUUID()}.xlsx`;
    try{await store.put(c,key,req.file.buffer);}catch{throw error('验收单原始 Excel 上传失败，请检查存储连接及写入权限。',502);}
    let committed=false;
    try{
      fresh(req);
      const saved=transaction(()=>{
        request=operationRequest(db,req);if(request.previous)return request.previous;
        activeRevision(req);
        const bindings=resolveBindings(req.warehouse.id,JSON.parse(revision.definition),result,choices);
        const now=new Date().toISOString();
        const fid=Number(db.prepare('INSERT INTO quality_template_files(warehouse_id,account_id,bucket,object_key,filename,size,sha256,workbook,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(req.warehouse.id,c.account_id,c.bucket,key,file.filename,req.file.size,file.sha256,JSON.stringify(file.workbook),now).lastInsertRowid);
        const number=`QA-${now.slice(0,10).replaceAll('-','')}-${randomBytes(6).toString('hex').toUpperCase()}`;
        // Deleted IDs must not be reused: saved operation requests still refer to them.
        const lastDeletedId=Number(db.prepare("SELECT value FROM app_metadata WHERE key='quality_acceptance_last_deleted_id'").get()?.value||0);
        const id=Math.max(lastDeletedId,db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM quality_acceptances').get().id)+1;
        db.prepare('INSERT INTO quality_acceptances(id,warehouse_id,number,name,note,template_id,revision_id,file_id,result,created_by_name,created_at,bindings,checks_acknowledged) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,req.warehouse.id,number,name,note,revision.template_id,revision.id,fid,JSON.stringify(result),owner(req),now,JSON.stringify(bindings),checksAcknowledged?1:0);
        const saved={id};saveOperationRequest(db,request,saved);committed=true;return saved;
      });
      return acceptanceDetail(acceptance({...req,params:{id:saved.id}}));
    }finally{if(!committed)await store.remove(c,key).catch(()=>{});}
  }));
  router.delete('/acceptances/:id',run(req=>transaction(()=>{
    const row=acceptance(req);
    db.prepare("INSERT INTO app_metadata(key,value) VALUES ('quality_acceptance_last_deleted_id',?) ON CONFLICT(key) DO UPDATE SET value=CAST(MAX(CAST(value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT)").run(String(row.id));
    // Keep originals for existing backups, as with reset and template replacement.
    db.prepare('DELETE FROM quality_acceptances WHERE id=?').run(row.id);
    return {ok:true};
  })));
  router.get('/acceptances/:id',run(req=>acceptanceDetail(acceptance(req))));
  router.get('/acceptances/:id/download',run(async(req,res)=>{
    const row=acceptance(req),file=db.prepare('SELECT * FROM quality_template_files WHERE id=?').get(row.file_id);
    let buffer;try{buffer=await store.get(config(file),file.object_key);}catch(e){if(e.status)throw e;throw error('读取验收单原始 Excel 失败，请检查文件及存储连接。',502);}
    fresh(req);acceptance(req);
    if(buffer.length!==file.size||digest(buffer)!==file.sha256)throw error('验收单原始 Excel 校验失败。',502);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(file.filename).send(buffer);
  }));
  router.get('/storage',run(()=>{const c=r2();return {ready:!!(c.account_id&&c.bucket&&c.access_key&&c.secret_key),prefix:c.excel_prefix||'excel'};}));
  router.post('/workbook-preview',multipart,run(readFile));
  router.get('/templates',run(req=>{
    const q=String(req.query.q||'').slice(0,100), status=req.query.status;
    const filters={draft:'t.published_revision IS NULL',enabled:'t.enabled=1',disabled:'t.published_revision IS NOT NULL AND t.enabled=0'};
    const where=`t.warehouse_id=? AND t.name LIKE ?${filters[status]?` AND (${filters[status]})`:''}`;
    const offset=Number(req.query.offset)||0;
    if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw error('分页位置无效。');
    const total=db.prepare(`SELECT COUNT(*) AS n FROM quality_templates t WHERE ${where}`).get(req.warehouse.id,`%${q}%`).n;
    const rows=db.prepare(`SELECT t.*,f.filename,(SELECT revision FROM quality_template_revisions WHERE id=t.published_revision) AS revision,
      (SELECT definition FROM quality_template_revisions WHERE id=t.published_revision) AS published_definition,
      (SELECT file_id FROM quality_template_revisions WHERE id=t.published_revision) AS published_file_id,
      (SELECT name FROM quality_template_revisions WHERE id=t.published_revision) AS published_name
      FROM quality_templates t JOIN quality_template_files f ON f.id=t.file_id WHERE ${where} ORDER BY t.updated_at DESC,t.id DESC LIMIT 20 OFFSET ?`).all(req.warehouse.id,`%${q}%`,offset)
      .map(r=>{const definition=JSON.parse(r.definition);return {id:r.id,name:r.name,filename:r.filename,version:r.version,enabled:!!r.enabled,revision:r.revision,fields:definition.fields.length,sheetName:definition.sheetName,updated_at:r.updated_at,updated_by_name:r.updated_by_name,status:r.published_revision?(r.enabled?'enabled':'disabled'):'draft',has_draft:r.definition!==r.published_definition||r.file_id!==r.published_file_id||r.name!==r.published_name};});
    return {templates:rows,total};
  }));
  router.get('/templates/:id',run(req=>detail(get(req))));
  router.post('/templates',multipart,run(async req=>{
    const file=await readFile(req), name=String(req.body.name||'').trim();
    if(!name||name.length>60)throw error('请输入 1–60 字模板名称。');
    const definition=validateDefinition(JSON.parse(req.body.definition||'null'),file.workbook);
    req.body={name,definition,request_id:req.body.request_id,sha256:file.sha256};
    let request=operationRequest(db,req); if(request.previous)return detail(get({...req,params:{id:request.previous.id}}));
    const c=config(), key=`${c.excel_prefix||'excel'}/${db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value}/templates/${randomUUID()}.xlsx`;
    try {await store.put(c,key,req.file.buffer);}catch{throw error('Excel 上传 R2 失败，请检查连接和目录写入权限。',502);}
    let committed=false;
    try {
      fresh(req);
      const result=transaction(()=>{
        request=operationRequest(db,req);if(request.previous)return request.previous;
        const now=new Date().toISOString();
        const fid=Number(db.prepare('INSERT INTO quality_template_files(warehouse_id,account_id,bucket,object_key,filename,size,sha256,workbook,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(req.warehouse.id,c.account_id,c.bucket,key,file.filename,req.file.size,file.sha256,JSON.stringify(file.workbook),now).lastInsertRowid);
        const id=Number(db.prepare('INSERT INTO quality_templates(warehouse_id,name,file_id,definition,created_by_name,updated_by_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(req.warehouse.id,name,fid,JSON.stringify(definition),owner(req),owner(req),now,now).lastInsertRowid);
        event(req,id,'create',1);const result={id};saveOperationRequest(db,request,result);committed=true;return result;
      });
      return detail(get({...req,params:{id:result.id}}));
    }finally{if(!committed)await store.remove(c,key).catch(()=>{});}
  }));
  router.put('/templates/:id/draft',run(req=>transaction(()=>{
    const row=get(req);versionOf(req,row);
    const name=typeof req.body.name==='string'?req.body.name.trim():'';
    if(!name||name.length>60||typeof req.body.note!=='string'||req.body.note.length>1000)throw error('模板名称或说明无效。');
    const wb=JSON.parse(db.prepare('SELECT workbook FROM quality_template_files WHERE id=?').get(row.file_id).workbook);
    const def=validateDefinition(req.body.definition,wb);
    db.prepare('UPDATE quality_templates SET name=?,note=?,definition=?,version=version+1,updated_by_name=?,updated_at=? WHERE id=?').run(name,req.body.note,JSON.stringify(def),owner(req),new Date().toISOString(),row.id);
    event(req,row.id,'save',row.version+1);return detail(get(req));
  })));
  router.post('/templates/:id/file',multipart,run(async req=>{
    const row=get(req);versionOf(req,row);
    const file=await readFile(req),c=config(),key=`${c.excel_prefix||'excel'}/${db.prepare("SELECT value FROM app_metadata WHERE key='instance_id'").get().value}/templates/${randomUUID()}.xlsx`;
    const definition={schemaVersion:1,sheetName:file.workbook.sheets[0].name,fields:[]};
    try{await store.put(c,key,req.file.buffer);}catch{throw error('Excel 上传 R2 失败，原模板未修改。',502);}
    let committed=false;
    try{
      fresh(req);
      return transaction(()=>{
        const current=get(req);versionOf(req,current);
        const now=new Date().toISOString(),fid=Number(db.prepare('INSERT INTO quality_template_files(warehouse_id,account_id,bucket,object_key,filename,size,sha256,workbook,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(req.warehouse.id,c.account_id,c.bucket,key,file.filename,req.file.size,file.sha256,JSON.stringify(file.workbook),now).lastInsertRowid);
        db.prepare('UPDATE quality_templates SET file_id=?,definition=?,version=version+1,updated_at=?,updated_by_name=? WHERE id=?').run(fid,JSON.stringify(definition),now,owner(req),row.id);
        event(req,row.id,'save',row.version+1);committed=true;return detail(get(req));
      });
    }finally{if(!committed)await store.remove(c,key).catch(()=>{});}
  }));
  router.post('/templates/:id/preview',run(req=>{
    const row=get(req),wb=JSON.parse(db.prepare('SELECT workbook FROM quality_template_files WHERE id=?').get(row.file_id).workbook);
    return previewDefinition(validateDefinition(req.body.definition||JSON.parse(row.definition),wb),wb);
  }));
  router.post('/templates/:id/publish',run(async req=>{
    const row=get(req);versionOf(req,row);
    const file=db.prepare('SELECT * FROM quality_template_files WHERE id=?').get(row.file_id);
    const def=validateDefinition(JSON.parse(row.definition),JSON.parse(file.workbook),{publish:true});
    try{await store.head(config(file),file.object_key);}catch(e){if(e.status)throw e;throw error('R2 原始 Excel 不可读取，暂时不能启用模板。',502);}
    fresh(req);
    return transaction(()=>{
      const current=get(req);versionOf(req,current);
      const published=current.published_revision&&db.prepare('SELECT * FROM quality_template_revisions WHERE id=?').get(current.published_revision);
      if(published&&published.file_id===current.file_id&&published.definition===JSON.stringify(def)&&published.name===current.name){
        if(!current.enabled){db.prepare('UPDATE quality_templates SET enabled=1,version=version+1,updated_at=?,updated_by_name=? WHERE id=?').run(new Date().toISOString(),owner(req),current.id);event(req,current.id,'status',current.version+1);}
        return detail(get(req));
      }
      const revision=db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS n FROM quality_template_revisions WHERE template_id=?').get(row.id).n;
      const id=Number(db.prepare('INSERT INTO quality_template_revisions(template_id,revision,file_id,name,definition,created_by_name,created_at) VALUES (?,?,?,?,?,?,?)').run(row.id,revision,row.file_id,row.name,JSON.stringify(def),owner(req),new Date().toISOString()).lastInsertRowid);
      db.prepare('UPDATE quality_templates SET published_revision=?,enabled=1,version=version+1,updated_at=?,updated_by_name=? WHERE id=?').run(id,new Date().toISOString(),owner(req),row.id);
      event(req,row.id,'publish',row.version+1);return detail(get(req));
    });
  }));
  router.post('/templates/:id/status',run(req=>transaction(()=>{
    const row=get(req);versionOf(req,row);
    if(typeof req.body.enabled!=='boolean'||!row.published_revision)throw error('请先发布模板。');
    db.prepare('UPDATE quality_templates SET enabled=?,version=version+1,updated_by_name=?,updated_at=? WHERE id=?').run(Number(req.body.enabled),owner(req),new Date().toISOString(),row.id);
    event(req,row.id,'status',row.version+1);return detail(get(req));
  })));
  router.post('/templates/:id/copy',run(req=>transaction(()=>{
    const row=get(req), def=JSON.parse(row.definition), ids=new Map();
    for(const field of def.fields)for(const item of [field,...(field.properties||[])])ids.set(item.id,randomUUID());
    const rename=field=>({...field,id:ids.get(field.id),...(field.properties?{properties:field.properties.map(rename)}:{}),
      ...(field.itemRules?{itemRules:field.itemRules.map(rule=>({...rule,matchPropertyId:ids.get(rule.matchPropertyId)}))}:{})});
    def.fields=def.fields.map(rename);
    if(def.checks)def.checks=remapChecks(def.checks,ids);
    const now=new Date().toISOString(), id=Number(db.prepare('INSERT INTO quality_templates(warehouse_id,name,note,file_id,definition,created_by_name,updated_by_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(row.warehouse_id,`${row.name.slice(0,55)} 副本`,row.note,row.file_id,JSON.stringify(def),owner(req),owner(req),now,now).lastInsertRowid);
    event(req,id,'copy',1);return detail(get({...req,params:{id}}));
  })));
  const download=which=>run(async(req,res)=>{
    const row=get(req);let fileId=row.file_id;
    if(which!=='draft') {
      const revision=which==='history'?Number(req.params.revision):row.published_revision;
      const rev=db.prepare('SELECT * FROM quality_template_revisions WHERE id=? AND template_id=?').get(revision||0,row.id);
      if(!rev||which==='active'&&!row.enabled)throw error('该版本尚未启用或已停用。',409);
      fileId=rev.file_id;
    }
    const file=db.prepare('SELECT * FROM quality_template_files WHERE id=?').get(fileId);
    let buffer;try{buffer=await store.get(config(file),file.object_key);}catch(e){if(e.status)throw e;throw error('读取 R2 原始 Excel 失败，请检查文件及连接。',502);}
    fresh(req);get(req);
    if(buffer.length!==file.size||digest(buffer)!==file.sha256)throw error('原始 Excel 校验失败，请联系管理员。',502);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(file.filename).send(buffer);
  });
  router.get('/templates/:id/download',download('active'));
  router.get('/templates/:id/draft/download',download('draft'));
  router.get('/templates/:id/revisions/:revision/download',download('history'));
  router.use((err,req,res,next)=>{if(res.headersSent)return next(err);res.status(err.status||400).json({error:err.status?err.message:err instanceof SyntaxError?'配置格式无效。':err.message||'模板操作失败。'});});
  app.use('/api/quality',router);
}
