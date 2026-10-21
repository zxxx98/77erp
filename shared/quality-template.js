import { parseMeasurements, validateChecks, evaluateChecks } from './quality-checks.js';
import { regexRule, replaceRegexText } from './quality-regex.js';
export const qualityTypes = ['string', 'uniqueKey', 'number', 'date', 'single', 'multi', 'measurements'];
export const qualityTypeLabels = { string: '字符串', uniqueKey: '唯一 KEY', number: '数字', date: '日期', single: '单选', multi: '多选', measurements: '测量值列表', object: '对象' };
export function cellAddress(row, col) {
  let name = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name + row;
}
export function parseRegion(value) {
  const parts = String(value || '').trim().toUpperCase().split(':');
  if (parts.length > 2) throw new Error('区域格式应为 A1 或 A1:F3。');
  const points = parts.map(part => {
    const match = /^([A-Z]{1,3})([1-9]\d{0,3})$/.exec(part);
    if (!match) throw new Error('区域格式应为 A1 或 A1:F3。');
    const col = [...match[1]].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0), row = Number(match[2]);
    if (col > 100 || row > 2000) throw new Error('区域不能超过 2000 行、100 列。');
    return { row, col };
  });
  const a = points[0], b = points[1] || a;
  return { r1: Math.min(a.row, b.row), c1: Math.min(a.col, b.col), r2: Math.max(a.row, b.row), c2: Math.max(a.col, b.col) };
}
export function regionAddress(rect) {
  const a = cellAddress(rect.r1, rect.c1), b = cellAddress(rect.r2, rect.c2);
  return a === b ? a : `${a}:${b}`;
}
export const containsCell = (rect, row, col) => row >= rect.r1 && row <= rect.r2 && col >= rect.c1 && col <= rect.c2;
export function objectOrientation(field) {
  if (['horizontal','vertical'].includes(field.orientation)) return field.orientation;
  const headers = parseRegion(field.propertyRegion);
  return headers.r1 !== headers.r2 ? 'vertical' : 'horizontal';
}
export function logicalRegion(sheet, row, col) {
  return (sheet.merges || []).map(parseRegion).find(rect => containsCell(rect, row, col)) || { r1: row, c1: col, r2: row, c2: col };
}
export function adjacentRegion(sheet, labelRegion, direction) {
  const r = parseRegion(labelRegion);
  const point = { up: [r.r1 - 1, r.c1], down: [r.r2 + 1, r.c1], left: [r.r1, r.c1 - 1], right: [r.r1, r.c2 + 1] }[direction];
  if (!point || point[0] < 1 || point[1] < 1 || point[0] > sheet.rows || point[1] > sheet.cols) return null;
  return regionAddress(logicalRegion(sheet, ...point));
}
export function regionText(sheet, region, { preserveLines = false } = {}) {
  const r = parseRegion(region), seen = new Set(), out = [];
  for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) {
    const merge = logicalRegion(sheet, row, col), addr = cellAddress(merge.r1, merge.c1);
    if (seen.has(addr)) continue;
    seen.add(addr);
    const source = String(sheet.cells[addr]?.text ?? '');
    const text = preserveLines ? source : source.trim();
    if (text) out.push(text);
  }
  return out.join('\n');
}
// Merges define logical cells only inside the regions explicitly selected by the user.
export function objectHeaders(sheet, region, orientation, headerMode = 'single') {
  const rect = parseRegion(region);
  if (!['single','multi'].includes(headerMode)) throw new Error('对象表头模式无效。');
  if (headerMode === 'multi') {
    if (!['horizontal','vertical'].includes(orientation)) throw new Error('请选择多级表头的排列方向。');
    const vertical = orientation === 'vertical', cells = [], paths = [];
    const start = vertical ? rect.r1 : rect.c1, end = vertical ? rect.r2 : rect.c2;
    for (let index = start; index <= end;) {
      const leaf = logicalRegion(sheet, vertical ? index : rect.r2, vertical ? rect.c2 : index);
      if (vertical ? leaf.r1 !== index || leaf.r2 > rect.r2 || leaf.c1 < rect.c1 || leaf.c2 !== rect.c2
        : leaf.c1 !== index || leaf.c2 > rect.c2 || leaf.r1 < rect.r1 || leaf.r2 !== rect.r2)
        throw new Error('多级表头须完整框选，末级属性单元格必须对齐表头末端。');
      const path = [];
      let parent = rect;
      for (let level = vertical ? rect.c1 : rect.r1; level <= (vertical ? rect.c2 : rect.r2);) {
        const cell = logicalRegion(sheet, vertical ? index : level, vertical ? level : index);
        if (vertical ? cell.c1 !== level || cell.c2 > rect.c2 || cell.r1 < parent.r1 || cell.r2 > parent.r2 || cell.r1 > leaf.r1 || cell.r2 < leaf.r2
          : cell.r1 !== level || cell.r2 > rect.r2 || cell.c1 < parent.c1 || cell.c2 > parent.c2 || cell.c1 > leaf.c1 || cell.c2 < leaf.c2)
          throw new Error('多级表头的父子分组须完整包含，不能交叉或跨越不同分组。');
        path.push(cell); parent = cell; level = (vertical ? cell.c2 : cell.r2) + 1;
        if (path.length > 20) throw new Error(`多级表头最多支持 20 层，当前表头选区为 ${regionAddress(rect)}。请检查是否选入明细数据：先仅框选表头并确认属性，再选择值区域；明细记录数不受此表头层数限制。`);
      }
      cells.push(leaf); paths.push(path); index = (vertical ? leaf.r2 : leaf.c2) + 1;
    }
    return { orientation, cells, paths };
  }
  const collect = vertical => {
    const cells = [];
    for (let index = vertical ? rect.r1 : rect.c1; index <= (vertical ? rect.r2 : rect.c2);) {
      const cell = logicalRegion(sheet, vertical ? index : rect.r1, vertical ? rect.c1 : index);
      if (vertical ? cell.r1 !== index || cell.c1 !== rect.c1 || cell.c2 !== rect.c2 || cell.r2 > rect.r2
        : cell.c1 !== index || cell.r1 !== rect.r1 || cell.r2 !== rect.r2 || cell.c2 > rect.c2) return null;
      cells.push(cell); index = (vertical ? cell.r2 : cell.c2) + 1;
    }
    return cells;
  };
  const horizontal = collect(false), vertical = collect(true);
  const direction = orientation || (horizontal ? 'horizontal' : 'vertical');
  const cells = direction === 'vertical' ? vertical : horizontal;
  if (!cells) throw new Error('请框选连续的一行或一列逻辑属性单元格；合并单元格须完整选中且排列对齐。');
  return { orientation: direction, cells };
}
export function objectRecords(sheet, field) {
  const { orientation, cells: headers } = objectHeaders(sheet, field.propertyRegion, objectOrientation(field), field.headerMode);
  const vertical = orientation === 'vertical', values = parseRegion(field.valueRegion), records = [];
  for (let index = vertical ? values.c1 : values.r1; index <= (vertical ? values.c2 : values.r2);) {
    const cells = headers.map(header => logicalRegion(sheet, vertical ? header.r1 : index, vertical ? index : header.c1));
    const end = vertical ? cells[0].c2 : cells[0].r2;
    const mismatch = cells.findIndex((cell, i) => vertical
      ? cell.r1 !== headers[i].r1 || cell.r2 !== headers[i].r2 || cell.c1 !== index || cell.c2 !== end || cell.c2 > values.c2
      : cell.c1 !== headers[i].c1 || cell.c2 !== headers[i].c2 || cell.r1 !== index || cell.r2 !== end || cell.r2 > values.r2);
    if (mismatch !== -1)
      throw new Error(`对象值区域的合并单元格须与属性对齐：值单元格 ${regionAddress(cells[mismatch])} 与表头 ${regionAddress(headers[mismatch])} 不对应。每条记录必须完整，不能跨越不同属性或记录；请检查是否选入备注或合计行。`);
    records.push({ index, cells }); index = end + 1;
  }
  return records;
}
const fail = message => { throw new Error(message); };
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const normalizeChoiceMarker = value => String(value||'').replace(/[\uFE0E\uFE0F]/g,'');
export const choiceModeOf = config => config.choiceMode ?? (config.separator && config.separator !== '\n' ? 'separator' : 'markers');
export const choiceUncheckText = config => config.uncheckChars ?? '';
function choiceRules(config) {
  const mode = choiceModeOf(config), separator=config.separator ?? '\n';
  if (!['markers','separator'].includes(mode)) fail('选项拆分方式无效。');
  if (!['before','after'].includes(config.markerPosition || 'before')) fail('选项标记位置无效。');
  if (!config.checkChar) fail('请填写勾选字符。');
  if (mode==='separator' && !separator) fail('请填写选项分隔符。');
  const uncheckText=choiceUncheckText(config);
  if(typeof uncheckText!=='string'||uncheckText.length>500)fail('未选中标记无效。');
  const unchecked=uncheckText.split('\n').map(s=>s.trim()).filter(Boolean);
  if(unchecked.length>20||unchecked.some(s=>s.length>10))fail('未选中标记最多 20 个，每个最多 10 个字符。');
  if(unchecked.some(s=>normalizeChoiceMarker(s)===normalizeChoiceMarker(config.checkChar)))fail('未选中标记不能与勾选字符相同。');
  const markers = [...new Set([config.checkChar,...unchecked])].sort((a,b)=>b.length-a.length);
  const pattern = `(?:${markers.map(escapePattern).join('|')})[\uFE0E\uFE0F]?`;
  const allowed = config.options.split('\n').map(s=>s.trim()).filter(Boolean).map(s=>s.replace(new RegExp(config.markerPosition==='after'?`\\s*${pattern}$`:`^${pattern}\\s*`,'u'),'').trim());
  if (!allowed.length || allowed.some(s=>!s)) fail('允许选项请填写实际选项文字，不能只有勾选符号。');
  if (new Set(allowed).size !== allowed.length) fail('允许选项去除勾选符号后不能重复。');
  return { allowed, pattern, mode, separator };
}
const cleanText = (value, limit, label, empty = false) => {
  if (typeof value !== 'string' || value.length > limit || (!empty && !value.trim())) fail(`${label}无效。`);
  return value.trim();
};
export const textLines = raw => String(raw ?? '').replace(/\r\n?/g, '\n').split('\n');
export const hasTextProcessing = config => (config.parseLine != null && config.parseLine !== 'all') || !!config.ignoreContent || !!config.regexPattern || !!config.regexReplacement;
// Select lines, remove literal ignored text, then apply the explicit regex rule.
export function preprocessText(raw, config) {
  if (!hasTextProcessing(config)) return raw;
  let text = raw;
  if (config.parseLine != null && config.parseLine !== 'all') {
    const lines = textLines(raw);
    if (raw.trim() && config.parseLine > lines.length) fail(`内容只有 ${lines.length} 行，无法读取第 ${config.parseLine} 行。`);
    text = lines[config.parseLine - 1] ?? '';
  }
  for (const ignored of textLines(config.ignoreContent).filter(Boolean)) text = text.split(ignored).join('');
  if(config.regexPattern||config.regexReplacement)text=replaceRegexText(text,config);
  return text.trim();
}
export function validateDefinition(input, workbook, { publish = false } = {}) {
  if(input?.sheets!==undefined || input?.schemaVersion!==undefined && input.schemaVersion!==1)fail('模板仅支持配置一个工作表。');
  if (!input || !Array.isArray(input.fields) || input.fields.length > 200) fail('模板最多配置 200 个字段。');
  const sheet = workbook.sheets.find(s => s.name === input.sheetName);
  if (!sheet) fail('工作表不存在。');
  const ids = new Set(), names = new Set();
  const idOf = value => {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value) || ids.has(value)) fail('字段 ID 无效或重复。');
    ids.add(value); return value;
  };
  const regionOf = value => {
    const r = parseRegion(value);
    if (r.r2 > sheet.rows || r.c2 > sheet.cols || (r.r2-r.r1+1)*(r.c2-r.c1+1) > 50000) fail('选区超出工作表范围。');
    for (const m of (sheet.merges || []).map(parseRegion)) {
      const intersects = r.r1 <= m.r2 && r.r2 >= m.r1 && r.c1 <= m.c2 && r.c2 >= m.c1;
      if (intersects && !(r.r1 <= m.r1 && r.r2 >= m.r2 && r.c1 <= m.c1 && r.c2 >= m.c2)) fail('选区必须包含完整合并单元格。');
    }
    return regionAddress(r);
  };
  let uniqueKeyCount = 0;
  const basic = field => {
    if (!qualityTypes.includes(field.type)) fail('字段类型无效。');
    if (field.type === 'uniqueKey' && ++uniqueKeyCount > 1) fail('整个模板只能配置一个唯一 KEY（含对象属性）。');
    const separator=field.separator ?? '\n';
    if(typeof separator!=='string'||separator.length>10)fail('分隔符无效。');
    if(field.type==='measurements'&&(!separator||separator.length>10||/[\d.+-]/.test(separator)))fail('测量值分隔符不能为空或包含数字、正负号、小数点。');
    const choice=['single','multi'].includes(field.type);
    if(field.markerPosition!==undefined&&!['before','after'].includes(field.markerPosition))fail('选项标记位置无效。');
    if(field.specialValues!==undefined&&(!Array.isArray(field.specialValues)||field.specialValues.length>20))fail('特殊值映射最多 20 项。');
    const specialValues=(field.specialValues||[]).map(rule=>{
      if(!rule||!['not_applicable','missing'].includes(rule.status))fail('特殊值状态无效。');
      return {text:cleanText(rule.text,200,'特殊值'),status:rule.status};
    });
    if(new Set(specialValues.map(rule=>rule.text)).size!==specialValues.length)fail('特殊值不能重复。');
    if(field.type==='uniqueKey'&&specialValues.length)fail('唯一 KEY 不支持特殊值映射。');
    if (field.parseLine != null && field.parseLine !== 'all' && (!Number.isSafeInteger(field.parseLine) || field.parseLine < 1 || field.parseLine > 32767)) fail('解析行须为所有行或有效的文字行号。');
    if (field.ignoreContent != null && (typeof field.ignoreContent !== 'string' || field.ignoreContent.length > 2000)) fail('忽略内容最多 2000 个字符。');
    const regex=regexRule(field);
    const processing = { ...(field.parseLine != null && field.parseLine !== 'all' ? { parseLine: field.parseLine } : {}), ...(field.ignoreContent ? { ignoreContent: field.ignoreContent } : {}), ...(regex?{regexPattern:regex.pattern,regexReplacement:regex.replacement}:{}) };
    if(choice&&!['markers','separator'].includes(choiceModeOf(field)))fail('选项拆分方式无效。');
    return { ...processing, ...(specialValues.length?{specialValues}:{}), ...(choice&&field.markerPosition==='after'?{markerPosition:'after'}:{}), type: field.type, required: field.required === true, unit: cleanText(field.unit || '', 30, '单位', true), dateFormat: ['YYYY-MM-DD', 'YYYY/MM/DD', 'YYYY年MM月DD日'].includes(field.dateFormat) ? field.dateFormat : 'YYYY-MM-DD', checkChar: cleanText(field.checkChar || '', 10, '勾选字符', true), separator, options: cleanText(field.options || '', 2000, '选项', true), ...(choice?{choiceMode:choiceModeOf(field),uncheckChars:cleanText(choiceUncheckText(field),500,'未选中标记',true)}:{}) };
  };
  const fields = input.fields.map(field => {
    const name = cleanText(field.name, 60, '字段名称');
    if (names.has(name)) fail('顶层字段名称不能重复。');
    names.add(name);
    const base = { id: idOf(field.id), name, labelRegion: regionOf(field.labelRegion), labelText: regionText(sheet,regionOf(field.labelRegion)), valueRegion: regionOf(field.valueRegion), configured: field.configured !== false };
    if (publish && !base.configured) fail(`请完成“${name}”的配置。`);
    if (field.type === 'object') {
      const propertyRegion = regionOf(field.propertyRegion), headers = parseRegion(propertyRegion), values = parseRegion(base.valueRegion);
      if (field.orientation !== undefined && !['horizontal','vertical'].includes(field.orientation)) fail('对象属性排列方向无效。');
      const layout = objectHeaders(sheet, propertyRegion, field.orientation, field.headerMode), vertical = layout.orientation === 'vertical';
      if (vertical) {
        if (headers.r1 !== values.r1 || headers.r2 !== values.r2 || values.c1 <= headers.c2) fail(`竖向对象的值区域须位于属性列右侧且起止行一致。已确认表头 ${propertyRegion}，当前值区域 ${base.valueRegion}；请选择第 ${headers.r1}～${headers.r2} 行、${cellAddress(1,headers.c2).replace('1','')} 列右侧的值。若需读取其他行，请返回重选属性。`);
      } else if (headers.c1 !== values.c1 || headers.c2 !== values.c2 || values.r1 <= headers.r2) fail(`横向对象的值区域须位于属性行下方且起止列一致。已确认表头 ${propertyRegion}，当前值区域 ${base.valueRegion}；请选择 ${cellAddress(1,headers.c1).replace('1','')}～${cellAddress(1,headers.c2).replace('1','')} 列、第 ${headers.r2} 行下方的值。若需读取其他列，请返回重选属性。`);
      objectRecords(sheet, { propertyRegion, valueRegion: base.valueRegion, orientation: layout.orientation, headerMode: field.headerMode });
      if (!Array.isArray(field.properties) || field.properties.length !== layout.cells.length) fail('对象属性数量与选区不符。');
      const propertyNames = new Set();
      const properties = field.properties.map((p, i) => {
        const propName = cleanText(p.name, 60, '属性名称');
        if (propertyNames.has(propName)) fail('同一对象内的属性名称不能重复。');
        propertyNames.add(propName);
        const config = basic(p);
        if (publish && ['single', 'multi'].includes(config.type) && (!config.checkChar || !config.options)) fail('选择类型请配置勾选字符和允许选项。');
        if (publish && ['single', 'multi'].includes(config.type)) choiceRules(config);
        const cell = layout.cells[i], headerCell = cellAddress(cell.r1, cell.c1);
        const headerPath = layout.paths?.[i].map(cell => ({region:regionAddress(cell),text:regionText(sheet,regionAddress(cell))}));
        if (headerPath && p.headerPath !== undefined && JSON.stringify(p.headerPath) !== JSON.stringify(headerPath)) fail('多级表头路径与所选区域不一致，请重新框选属性。');
        return { id: idOf(p.id), name: propName, headerCell, headerText: regionText(sheet, headerCell), ...(headerPath?{headerPath}:{}), ...(vertical ? { rowOffset: cell.r1 - headers.r1 } : { columnOffset: cell.c1 - headers.c1 }), ...config };
      });
      for(let i=0;i<properties.length;i++){
        const rules=field.properties[i].itemRules;
        if(rules===undefined)continue;
        if(!Array.isArray(rules)||rules.length>100)fail('每个属性最多配置 100 条项目规则。');
        if(!rules.length)continue;
        if(properties[i].type!=='string')fail('按项目配置的属性须使用字符串作为默认类型。');
        const keys=new Set();
        properties[i].itemRules=rules.map(rule=>{
          const match=properties.find(p=>p.id===rule?.matchPropertyId);
          if(!match||match.id===properties[i].id||!['string','uniqueKey'].includes(match.type)||field.properties.find(p=>p.id===match.id)?.itemRules?.length)fail('匹配属性须为没有项目规则的其他字符串或唯一 KEY 属性。');
          const equals=cleanText(rule.equals,200,'项目匹配文字');
          if(keys.has(equals)||keys.size&&rules[0].matchPropertyId!==match.id)fail('同一属性的项目规则不能重复或使用不同匹配属性。');
          keys.add(equals);
          if(!rule.config||rule.config.type==='uniqueKey'||rule.config.itemRules!==undefined)fail('项目规则类型无效。');
          const config=basic(rule.config);
          if(publish&&['single','multi'].includes(config.type))choiceRules(config);
          return {matchPropertyId:match.id,equals,config};
        });
      }
      return { ...base, type: 'object', collection: true, required: field.required === true, propertyRegion, ...(field.headerMode==='multi'?{headerMode:'multi'}:{}), ...(vertical ? { orientation: 'vertical' } : headers.r1 !== headers.r2 || field.headerMode==='multi' ? { orientation: 'horizontal' } : {}), properties };
    }
    const config = basic(field), r = parseRegion(base.valueRegion), logical = logicalRegion(sheet, r.r1, r.c1);
    if (['number', 'date', 'measurements'].includes(config.type) && regionAddress(r) !== regionAddress(logical)) fail('数字、日期和测量值列表只能读取一个逻辑单元格。');
    if (publish && ['single', 'multi'].includes(config.type) && (!config.checkChar || !config.options)) fail('选择类型请配置勾选字符和允许选项。');
    if (publish && ['single', 'multi'].includes(config.type)) choiceRules(config);
    const direction = ['up','down','left','right'].includes(field.direction) ? field.direction : null;
    if (direction && adjacentRegion(sheet,base.labelRegion,direction)!==base.valueRegion) fail('方向与取值区域不一致，请重新选择或改为自定义区域。');
    return { ...base, ...config, selectionMode: direction ? 'direction' : 'manual', direction };
  });
  if (publish && !fields.length) fail('请至少配置一个字段。');
  const checks=validateChecks(input.checks,fields);
  return { schemaVersion: 1, sheetName: sheet.name, fields, ...(checks.length?{checks}:{}) };
}
function convert(raw, config, cell) {
  if (!raw) return config.type === 'multi' ? [] : ['string', 'uniqueKey'].includes(config.type) ? '' : null;
  if (cell?.error) fail(cell.error);
  if (['string', 'uniqueKey'].includes(config.type)) return raw;
  if (config.type === 'measurements') return parseMeasurements(raw,config.separator);
  if (config.type === 'number') {
    if (typeof cell?.value === 'number' && !/%/.test(cell.format || '')) return cell.value;
    let text = raw;
    if (config.unit && text.endsWith(config.unit)) text = text.slice(0, -config.unit.length).trim();
    text = text.replace(/^[￥¥$]\s*/, '');
    if (!/^[+-]?(?:\d+|\d{1,3}(?:[,，]\d{3})+)(?:\.\d+)?$/.test(text)) fail('数字格式无效，请明确单一数值。');
    const n = Number(text.replace(/[,，]/g,''));
    if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER) fail('数值超出支持范围。');
    return n;
  }
  if (config.type === 'date') {
    if (cell?.date) return cell.date;
    const patterns = { 'YYYY-MM-DD': /^(\d{4})-(\d{2})-(\d{2})$/, 'YYYY/MM/DD': /^(\d{4})\/(\d{2})\/(\d{2})$/, 'YYYY年MM月DD日': /^(\d{4})年(\d{2})月(\d{2})日$/ };
    const match = (patterns[config.dateFormat] || patterns['YYYY-MM-DD']).exec(raw);
    const result = match && `${match[1]}-${match[2]}-${match[3]}`;
    if (!result || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0,10) !== result) fail('日期格式无效。');
    return result;
  }
  const parsed = previewChoice(raw, config);
  if (parsed.error) fail(parsed.error);
  return parsed.value;
}
// The editor and conversion use the same split results; preview details are not stored in acceptance snapshots.
export function previewChoice(raw, config) {
  const parts = [], mode = choiceModeOf(config);
  try {
    if (!raw) return { mode, parts, value: config.type === 'multi' ? [] : null };
    if (!config.checkChar || !config.options) fail('请选择勾选字符及允许选项。');
    const { allowed, pattern, separator } = choiceRules(config);
    const add = (text, label, marker = '', error) => {
      const status = !text.trim() ? 'empty' : !marker ? 'unmarked'
        : normalizeChoiceMarker(marker) === normalizeChoiceMarker(config.checkChar) ? 'selected' : 'unselected';
      const part = { raw: text, label, marker, status, matched: allowed.includes(label), ...(error ? { error } : {}) };
      parts.push(part); return part;
    };
    const chunks = mode === 'separator' ? (separator === '\n' ? raw.replace(/\r\n/g,'\n') : raw).split(separator) : [raw];
    for (const chunk of chunks) {
      const marks = [...chunk.matchAll(new RegExp(pattern,'gu'))];
      if (mode === 'separator') {
        if (marks.length > 1) {
          parts.push({ raw: chunk, label: '', marker: '', status: 'invalid', matched: false, error: '分隔符与原文不匹配：拆分后仍包含多个选项标记，请检查分隔符。' });
          continue;
        }
        const mark = marks[0];
        if (!mark) { add(chunk, chunk.trim()); continue; }
        const before = chunk.slice(0,mark.index).trim(), after = chunk.slice(mark.index+mark[0].length).trim();
        const error = before && after && normalizeChoiceMarker(mark[0]) === normalizeChoiceMarker(config.checkChar)
          ? '勾选标记应位于选项文字前或后，请检查分隔符。' : undefined;
        add(chunk, before && after ? `${before} ${after}` : before || after, mark[0], error);
        continue;
      }
      if (!marks.length) { add(chunk,chunk.trim()); continue; }
      if(config.markerPosition==='after'){
        let start=0;
        for(const mark of marks){
          const end=mark.index+mark[0].length;
          add(chunk.slice(start,end),chunk.slice(start,mark.index).trim(),mark[0]);start=end;
        }
        if(chunk.slice(start).trim())add(chunk.slice(start),chunk.slice(start).trim(),'', '后置标记后存在未标记文字，请检查解析行或标记位置。');
        continue;
      }
      const before = chunk.slice(0,marks[0].index).trim();
      const suffix = marks.length === 1 && !chunk.slice(marks[0].index+marks[0][0].length).trim();
      const placementError = marks.length > 1 && before && marks.some(mark=>normalizeChoiceMarker(mark[0])===normalizeChoiceMarker(config.checkChar))
        ? '同一行的选项标记应放在选项文字前，或使用分隔符拆开各选项。' : undefined;
      if (before && !suffix) add(chunk.slice(0,marks[0].index),before);
      for (let i=0;i<marks.length;i++) {
        const mark = marks[i], end = marks[i+1]?.index ?? chunk.length;
        const label = suffix ? before : chunk.slice(mark.index+mark[0].length,end).trim();
        add(suffix ? chunk : chunk.slice(mark.index,end),label,mark[0],placementError);
      }
    }
    const splitError = parts.find(part=>part.error)?.error;
    if (splitError) fail(splitError);
    if(config.markerPosition==='after'&&mode==='markers'&&parts.some(part=>part.status!=='empty'&&(!part.marker||!part.matched)))fail('后置标记的选项文字或标记不匹配，请检查配置。');
    const selected = parts.filter(part=>part.status === 'selected');
    for (const part of selected) if (!part.matched) part.error = '命中了未配置的选项，请检查选项文字与勾选符号。';
    if (selected.some(part=>part.error)) fail(selected.find(part=>part.error).error);
    if (config.type === 'single' && selected.length > 1) fail('单选命中多个选项。');
    const values = [...new Set(selected.map(part=>part.label))];
    return { mode, parts, value: config.type === 'multi' ? values : values[0] ?? null };
  } catch (error) { return { mode, parts, value: null, error: error.message }; }
}

export function previewDefinition(definition, workbook) {
  const sheet = workbook.sheets.find(s => s.name === definition.sheetName);
  if (!sheet) fail('工作表不存在。');
  const issues = [], results = [];
  function read(config, region, fieldId, row, column) {
    const raw = regionText(sheet, region, { preserveLines: hasTextProcessing(config) }), r = parseRegion(region), logical = logicalRegion(sheet, r.r1, r.c1), cell = sheet.cells[cellAddress(logical.r1, logical.c1)];
    let value = null;
    try {
      const seen = new Set();
      for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) {
        const logical = logicalRegion(sheet, row, col), address = cellAddress(logical.r1, logical.c1);
        if (seen.has(address)) continue;
        seen.add(address);
        if (sheet.cells[address]?.error) fail(`${address}：${sheet.cells[address].error}`);
      }
      const processed = preprocessText(raw, config);
      const special=config.specialValues?.find(rule=>rule.text===processed.trim());
      if(special){
        if(special.status==='missing'&&config.required)fail('必填值为空。');
        return {raw,value:null,status:special.status};
      }
      value = convert(processed, config, processed === raw ? cell : undefined);
      if (config.required && (value === null || value === '' || Array.isArray(value) && !value.length)) fail('必填值为空。');
    } catch (e) { issues.push({ fieldId, propertyId: config.id, row, ...(column === undefined ? {} : { column }), region, message: e.message }); }
    return { raw, value };
  }
  for (const field of definition.fields) {
    if (field.type !== 'object') {
      results.push({ id: field.id, name: field.name, region: field.valueRegion, ...read(field, field.valueRegion, field.id) });
      continue;
    }
    const rows = [], vertical = objectOrientation(field) === 'vertical';
    let records;
    try { records = objectRecords(sheet,field); } catch (e) {
      issues.push({fieldId:field.id,region:field.valueRegion,message:e.message});
      results.push({id:field.id,name:field.name,region:field.valueRegion,rows:[],value:[]});continue;
    }
    for (const { index, cells: regions } of records) {
      const address = i => regionAddress(regions[i]);
      if (!field.properties.some((_, i) => regionText(sheet, address(i)) || sheet.cells[cellAddress(regions[i].r1,regions[i].c1)]?.error)) continue;
      const cells = field.properties.map((p,i) => {
        const ruleIndex=(p.itemRules||[]).findIndex(rule=>{
          const keyIndex=field.properties.findIndex(key=>key.id===rule.matchPropertyId),key=field.properties[keyIndex];
          if(!key)return false;
          try{return preprocessText(regionText(sheet,address(keyIndex),{preserveLines:hasTextProcessing(key)}),key).trim()===rule.equals;}catch{return false;}
        });
        const config=ruleIndex<0?p:{...p.itemRules[ruleIndex].config,id:p.id};
        return {id:p.id,name:p.name,region:address(i),...(ruleIndex<0?{}:{ruleIndex}),...read(config,address(i),field.id,vertical ? regions[i].r1 : index,vertical ? index : undefined)};
      });
      rows.push({ ...(vertical ? { column: index } : { row: index }), cells, value: Object.fromEntries(cells.map(c => [c.name,c.value])) });
    }
    if (field.required && !rows.length) issues.push({ fieldId:field.id, region:field.valueRegion, message:'对象至少需要一条记录。' });
    results.push({ id:field.id, name:field.name, region:field.valueRegion, rows, value:rows.map(r=>r.value) });
  }
  const parsed={ results, value:Object.fromEntries(results.map(r=>[r.name,r.value])), issues };
  if(definition.checks?.length)parsed.checks=evaluateChecks(definition,parsed);
  return parsed;
}
