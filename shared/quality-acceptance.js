import { evaluateChecks } from './quality-checks.js';
import { cellAddress, logicalRegion, objectHeaders, parseRegion, previewDefinition, regionAddress, regionText } from './quality-template.js';

// Corrections replace source text before parsing; they never bypass template validation.
export function applyAcceptanceCorrections(workbook, corrections = [], sheetNames = workbook.sheets.map(sheet => sheet.name)) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!Array.isArray(corrections) || corrections.length > 1000) fail('手动修正最多支持 1000 个单元格。');
  const seen = new Set(), records = [];
  const sheets = new Map(workbook.sheets.map(sheet => [sheet.name, sheet]));
  for (const correction of corrections) {
    if (!correction || typeof correction.sheetName !== 'string' || typeof correction.address !== 'string' ||
        !/^[A-Z]{1,2}[1-9]\d{0,3}$/.test(correction.address) || typeof correction.text !== 'string' || correction.text.length > 10000)
      fail('手动修正的工作表、单元格或内容无效。');
    const { sheetName, address, text } = correction, sheet = sheets.get(sheetName);
    if (!sheet || !sheetNames.includes(sheetName)) fail('手动修正只能用于所选数据工作表。');
    let region;
    try { region = parseRegion(address); } catch { fail('手动修正单元格地址无效。'); }
    if (region.r1 > sheet.rows || region.c1 > sheet.cols) fail('手动修正单元格超出工作表范围。');
    const logical = logicalRegion(sheet, region.r1, region.c1);
    if (cellAddress(logical.r1, logical.c1) !== address) fail('请修正合并单元格左上角的内容。');
    const key = JSON.stringify([sheetName, address]);
    if (seen.has(key)) fail('同一单元格不能重复提交手动修正。');
    seen.add(key);
    const original = sheet.cells[address]?.text || '';
    if (text === original) continue;
    records.push({ sheetName, address, original, text });
  }
  const corrected = { ...workbook, sheets: workbook.sheets.map(sheet => {
    const changes = records.filter(record => record.sheetName === sheet.name);
    if (!changes.length) return sheet;
    const cells = { ...sheet.cells };
    // Clear cached numeric/date/formula state so conversion uses the edited text.
    for (const { address, text } of changes) cells[address] = { text, value: text, format: '' };
    return { ...sheet, cells };
  }) };
  return { workbook: corrected, corrections: records };
}

export function isManuallyCorrected(parsed, region) {
  const target = parseRegion(region);
  return !!parsed?.manualCorrections?.some(correction => {
    const cell = parseRegion(correction.address);
    return cell.r1 >= target.r1 && cell.r1 <= target.r2 && cell.c1 >= target.c1 && cell.c1 <= target.c2;
  });
}

// The template has one sheet of rules. Each chosen data sheet uses the same coordinates and types.
export function parseAcceptance(definition, templateWorkbook, workbook, { sheetNames, corrections = [] } = {}) {
  const applied = applyAcceptanceCorrections(workbook, corrections, sheetNames || [definition.sheetName]);
  workbook = applied.workbook;
  const template = templateWorkbook.sheets.find(sheet => sheet.name === definition.sheetName);
  const parseSheet = name => {
    const sheet = workbook.sheets.find(sheet => sheet.name === name);
    if (!sheet) return { results: [], value: {}, issues: [{ region: 'A1', message: `缺少工作表“${name}”，请重新选择需要解析的数据工作表。` }] };
    const issues = [];
    const overlaps = (a, b) => a.r1 <= b.r2 && a.r2 >= b.r1 && a.c1 <= b.c2 && a.c2 >= b.c1;
    for (const field of definition.fields) {
      const headers = field.type !== 'object' ? [] : field.headerMode === 'multi'
        ? objectHeaders(template,field.propertyRegion,field.orientation,field.headerMode).paths.flat().map(regionAddress)
        : field.properties.map(property => property.headerCell);
      const anchors = [...new Set([field.labelRegion,...headers].filter(Boolean))];
      for (const region of anchors) if (regionText(template, region) !== regionText(sheet, region))
        issues.push({ fieldId: field.id, region, message: '字段标题或对象属性与模板不一致，请勿移动或修改这些单元格。' });
      const regions = [...anchors, field.valueRegion].map(parseRegion);
      const merges = source => source.merges.filter(merge => regions.some(region => overlaps(parseRegion(merge), region))).sort();
      if (JSON.stringify(merges(template)) !== JSON.stringify(merges(sheet)))
        issues.push({ fieldId: field.id, region: field.valueRegion, message: '配置区域的合并单元格与模板不一致，请使用所选版本的原始 Excel。' });
    }
    const parsed = previewDefinition({ ...definition, sheetName: name }, workbook);
    const result={ ...parsed, issues: [...issues, ...parsed.issues] };
    const manualCorrections = applied.corrections.filter(correction => correction.sheetName === name).map(({sheetName,...record}) => record);
    if (manualCorrections.length) result.manualCorrections = manualCorrections;
    if(definition.checks?.length)result.checks=evaluateChecks(definition,result);
    return result;
  };
  // Keep saved pre-multi-sheet acceptances readable and verifiable without rewriting their snapshots.
  if (sheetNames === undefined) return parseSheet(definition.sheetName);
  if (!Array.isArray(sheetNames) || !sheetNames.length || sheetNames.length > 20 || new Set(sheetNames).size !== sheetNames.length || sheetNames.some(name => typeof name !== 'string' || !name || name.length > 100))
    throw new Error('请选择 1–20 个不重复的数据工作表。');
  const sheets = sheetNames.map(sheetName => ({ sheetName, ...parseSheet(sheetName) }));
  return { schemaVersion: 2, sheets, value: Object.fromEntries(sheets.map(sheet => [sheet.sheetName, sheet.value])), issues: sheets.flatMap(sheet => sheet.issues.map(issue => ({ ...issue, sheetName: sheet.sheetName }))) };
}
