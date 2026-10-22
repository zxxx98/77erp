import { cellAddress, objectRecords, parseRegion, regionAddress, preprocessText, hasTextProcessing, convertQualityValue, previewChoice, choiceModeOf, textLines } from './quality-template.js';

// Use the same logical cells and object record boundaries as acceptance parsing.
export function onlineInputCells(definition, workbook) {
  const sheet = workbook.sheets.find(sheet => sheet.name === definition.sheetName);
  if (!sheet) throw new Error('模板工作表不存在。');
  const locked = definition.fields.flatMap(field => [field.labelRegion, field.propertyRegion].filter(Boolean).map(parseRegion));
  const inputs = new Map(), merges = new Map();
  for (const region of sheet.merges) {
    const rect = parseRegion(region);
    for (let row = rect.r1; row <= rect.r2; row++) for (let col = rect.c1; col <= rect.c2; col++) merges.set(cellAddress(row,col),rect);
  }
  const add = (region, field, config, label, record) => {
    const bounds = parseRegion(region);
    for (let row = bounds.r1; row <= bounds.r2; row++) for (let col = bounds.c1; col <= bounds.c2; col++) {
      const rect = merges.get(cellAddress(row,col)) || {r1:row,c1:col,r2:row,c2:col}, address = cellAddress(rect.r1, rect.c1);
      if (rect.r1 < bounds.r1 || rect.c1 < bounds.c1 || rect.r2 > bounds.r2 || rect.c2 > bounds.c2 ||
          locked.some(lock => rect.r1 <= lock.r2 && rect.r2 >= lock.r1 && rect.c1 <= lock.c2 && rect.c2 >= lock.c1))
        throw new Error(`填写区域 ${region} 与标题或合并边界重叠，请先调整模板配置。`);
      if (!inputs.has(address)) inputs.set(address, { address, region: regionAddress(rect), fieldId: field.id, config, label, record,
        simple: regionAddress(bounds) === regionAddress(rect) });
    }
  };
  for (const field of definition.fields) {
    if (field.type !== 'object') add(field.valueRegion, field, field, field.name);
    else objectRecords(sheet, field).forEach((record, index) => record.cells.forEach((rect, i) =>
      add(regionAddress(rect), field, field.properties[i], `${field.name} · 第 ${index + 1} 条 · ${field.properties[i].name}`, index)));
  }
  return [...inputs.values()];
}

export function onlineCellConfig(input, inputs, values) {
  const rule = input.config.itemRules?.find(rule => {
    const match = inputs.find(cell => cell.fieldId === input.fieldId && cell.record === input.record && cell.config.id === rule.matchPropertyId);
    try { return match && preprocessText(values[match.address] || '', match.config).trim() === rule.equals; } catch { return false; }
  });
  return rule ? rule.config : input.config;
}

export function onlineChoiceOptions(config) {
  const markers = [config.checkChar, ...(config.uncheckChars || '').split('\n')].filter(Boolean).sort((a,b) => b.length - a.length);
  return (config.options || '').split('\n').map(text => {
    let label = text.trim();
    for (const marker of markers) {
      if (label.startsWith(marker)) { label = label.slice(marker.length).replace(/^[\uFE0E\uFE0F]/u, '').trim(); break; }
      if (label.endsWith(marker)) { label = label.slice(0, -marker.length).trim(); break; }
    }
    return label;
  }).filter(Boolean);
}

// A configured choice can span several physical cells. Treat them as one value,
// matching regionText's order and omission of empty cells during acceptance parsing.
export function onlineChoiceState(input, inputs, values) {
  const config = onlineCellConfig(input, inputs, values);
  const cells = inputs.filter(cell => cell.fieldId === input.fieldId && cell.record === input.record && cell.config.id === input.config.id);
  const raw = cells.map(cell => values[cell.address] || '').filter(Boolean).join('\n');
  let processed = '';
  try { processed = preprocessText(raw, config); } catch { /* Invalid prefilled content remains editable by choosing an option. */ }
  const special = config.specialValues?.find(rule => rule.text === processed.trim());
  const parsed = special ? null : previewChoice(processed, config);
  const selected = Array.isArray(parsed?.value) ? parsed.value : parsed?.value ? [parsed.value] : [];
  return { config, cells, raw, selected, special };
}

export function onlineChoiceRawText(text, config, raw = '') {
  const special = config.specialValues?.some(rule => rule.text === text);
  // Keep surrounding lines when a template reads one particular line. Choices
  // written into a blank cell need those preceding lines too.
  if (config.parseLine != null && config.parseLine !== 'all' && text) {
    const lines = textLines(raw);
    while (lines.length < config.parseLine) lines.push('');
    lines[config.parseLine - 1] = text;
    text = lines.join('\n');
  }
  if (special && !config.specialValues.some(rule => rule.text === preprocessText(text, config)))
    throw new Error('模板的内容处理与特殊值不兼容，请调整模板规则后重试。');
  return text;
}

export function onlineChoiceText(selected, config, raw = '') {
  const separator = choiceModeOf(config) === 'separator' ? config.separator ?? '\n'
    : config.parseLine != null && config.parseLine !== 'all' ? ' ' : '\n';
  const text = selected.map(label => config.markerPosition === 'after' ? `${label}${config.checkChar}` : `${config.checkChar}${label}`).join(separator);
  const result = onlineChoiceRawText(text, config, raw);
  const processed = preprocessText(result, config);
  const parsed = previewChoice(processed, config);
  const actual = Array.isArray(parsed.value) ? parsed.value : parsed.value ? [parsed.value] : [];
  const mapsToSpecial = selected.length > 0 && config.specialValues?.some(rule => rule.text === processed);
  if (mapsToSpecial || parsed.error || actual.length !== selected.length || selected.some(label => !actual.includes(label)))
    throw new Error('模板的内容处理或分隔符与选项不兼容，请调整模板规则后重试。');
  return result;
}

const rgb = color => /^[A-F\d]{8}$/i.test(color?.argb || '') ? `#${color.argb.slice(2)}` : undefined;
export function cellStyle(cell) {
  const { font = {}, alignment = {}, fill = {}, border = {} } = cell;
  const style = { fontFamily: font.name, fontSize: font.size ? `${font.size}pt` : undefined, fontWeight: font.bold ? 'bold' : undefined,
    fontStyle: font.italic ? 'italic' : undefined, textDecoration: font.underline ? 'underline' : undefined, color: rgb(font.color),
    textAlign: ['left','center','right','justify'].includes(alignment.horizontal) ? alignment.horizontal : undefined,
    verticalAlign: {top:'top',middle:'middle',bottom:'bottom'}[alignment.vertical], backgroundColor: fill.type === 'pattern' ? rgb(fill.fgColor) : undefined };
  for (const edge of ['top','right','bottom','left']) if (border[edge]?.style)
    style[`border${edge[0].toUpperCase()}${edge.slice(1)}`] = `${['medium','thick','double'].includes(border[edge].style) ? 2 : 1}px ${border[edge].style === 'double' ? 'double' : /dott/i.test(border[edge].style) ? 'dotted' : /dash/i.test(border[edge].style) ? 'dashed' : 'solid'} ${rgb(border[edge].color) || '#64748b'}`;
  return Object.fromEntries(Object.entries(style).filter(([,value]) => value !== undefined));
}

// Run only in the Excel worker (or node tests). Never mutate the uploaded template.
export async function createOnlineWorkbook(source, template, { values, keepValues = false } = {}) {
  const inputs = onlineInputCells(template.definition, template.workbook);
  const allowed = new Set(inputs.map(input => input.address));
  if (values !== undefined && (!values || typeof values !== 'object' || Array.isArray(values) || Object.entries(values).some(([address, value]) =>
    !allowed.has(address) || typeof value !== 'string' || value.length > 10000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))))
    throw new Error('填写内容包含无效单元格或内容过长。');
  const ExcelJS = (await import('exceljs')).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(source);
  const sheet = book.getWorksheet(template.definition.sheetName);
  if (!sheet) throw new Error('模板原文件缺少配置的工作表。');
  const next = Object.create(null), styles = {}, heights = {};
  sheet.eachRow(row => {
    if (row.height) heights[row.number] = row.height * 4 / 3;
    row.eachCell({includeEmpty:true}, cell => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      styles[cell.address] = cellStyle(cell);
    });
  });
  // ExcelJS does not calculate formulas. Drop caches instead of exporting stale results.
  const formulas = [];
  for (const worksheet of book.worksheets) worksheet.eachRow(row => row.eachCell(cell => {
    if (cell.isMerged && cell.master.address !== cell.address) return;
    if (cell.type === ExcelJS.ValueType.Formula) formulas.push([cell,cell.formula]);
  }));
  // Expand shared formulas before an editable master cell is replaced.
  for (const [cell,formula] of formulas) cell.value = {formula};
  book.calcProperties.fullCalcOnLoad = true;
  for (const input of inputs) {
    next[input.address] = values?.[input.address] ?? (keepValues ? template.workbook.sheets.find(s => s.name === sheet.name).cells[input.address]?.text || '' : '');
  }
  for (const input of inputs) {
    const text = next[input.address];
    // Codes and '=...' stay literal; numeric fields remain usable as Excel numbers.
    const cell = sheet.getCell(input.address), config = onlineCellConfig(input, inputs, next);
    cell.value = text || null;
    if (input.simple && config.type === 'number' && !hasTextProcessing(config)) {
      try {
        const number = convertQualityValue(text.trim(),config);
        if (typeof number === 'number') {
          cell.value = number;
          if (/%/.test(cell.numFmt || '')) cell.numFmt = 'General';
        }
      } catch { /* Keep invalid input as text so the normal parser reports it. */ }
    }
  }
  const buffer = new Uint8Array(await book.xlsx.writeBuffer());
  if (buffer.length > 10 * 1024 * 1024) throw new Error('生成的 Excel 超过 10 MB，请减少填写内容。');
  return { buffer, online: { inputs, values: next, styles, heights, hasFormulas: formulas.length > 0 } };
}
