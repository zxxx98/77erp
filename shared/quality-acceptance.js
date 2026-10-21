import { evaluateChecks } from './quality-checks.js';
import { objectHeaders, parseRegion, previewDefinition, regionAddress, regionText } from './quality-template.js';

// The template has one sheet of rules. Each chosen data sheet uses the same coordinates and types.
export function parseAcceptance(definition, templateWorkbook, workbook, { sheetNames } = {}) {
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
