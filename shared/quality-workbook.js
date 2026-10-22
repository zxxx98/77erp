import SSF from 'ssf';
import { unzipSync } from 'fflate';
import { cellAddress, parseRegion } from './quality-template.js';
let excelModule;

export async function readQualityWorkbook(buffer) {
  if (!buffer?.length || buffer.length > 10 * 1024 * 1024) throw new Error('请选择不超过 10 MB 的 .xlsx 文件。');
  let size = 0, entries = 0;
  try {
    unzipSync(new Uint8Array(buffer), { filter(file) {
      size += file.originalSize; entries++;
      if (size > 50 * 1024 * 1024 || entries > 3000) throw new Error('limit');
      return false;
    } });
  } catch { throw new Error('Excel 文件无效或解压后过大。'); }
  if (!entries) throw new Error('Excel 文件无效。');
  const ExcelJS = (await (excelModule ||= import('exceljs'))).default;
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); } catch { throw new Error('无法读取 Excel，请使用有效且未加密的 .xlsx 文件。'); }
  if (!workbook.worksheets.length || workbook.worksheets.length > 20) throw new Error('工作簿需要包含 1–20 个工作表。');
  let total = 0;
  const sheets = workbook.worksheets.map(sheet => {
    const rows = Math.max(25, sheet.rowCount + 3), cols = Math.max(8, sheet.columnCount + 2);
    if (rows > 2000 || cols > 100 || rows * cols > 50000 || (total += rows * cols) > 200000) throw new Error('工作表范围过大（最多 2000 行、100 列、50000 格）。');
    const cells = {};
    sheet.eachRow(row => row.eachCell(cell => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      let value = cell.value, error = '', date, datetime;
      if (value && typeof value === 'object') {
        if ('formula' in value || 'sharedFormula' in value) {
          value = value.result;
          if (value === undefined) error = '公式缺少缓存值，请在 Excel 中重新计算并保存。';
        }
        if (value?.error) { error = 'Excel 单元格错误：' + value.error; value = ''; }
        if (value?.richText) value = value.richText.map(t => t.text).join('');
        if (value?.hyperlink) value = value.text || '';
      }
      if (value instanceof Date) {
        datetime = value.toISOString().slice(0,19); date = datetime.slice(0,10);
        const timeFormat = /[hs]/i.test((cell.numFmt || '').replace(/"[^"]*"|\\./g,''));
        value = timeFormat || datetime.slice(11) !== '00:00:00' ? datetime.replace('T',' ') : date;
      }
      if (!['string','number','boolean'].includes(typeof value)) value = '';
      let text = String(value);
      if (typeof value === 'number' && cell.numFmt) {
        try { text = SSF.format(cell.numFmt, value, { date1904: workbook.properties.date1904 }); } catch { /* retain raw value */ }
        if (SSF.is_date(cell.numFmt)) {
          const parts = SSF.parse_date_code(value,{date1904:workbook.properties.date1904});
          if (parts) {
            const pad = n => String(n).padStart(2,'0');
            const candidate = `${String(parts.y).padStart(4,'0')}-${pad(parts.m)}-${pad(parts.d)}T${pad(parts.H)}:${pad(parts.M)}:${pad(parts.S)}`;
            const parsed = new Date(`${candidate}Z`);
            if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,19) === candidate) {
              datetime = candidate; date = candidate.slice(0,10);
            }
          }
        }
      }
      if (text.length > 10000) throw new Error('单元格内容过长。');
      if (text || error) cells[cellAddress(cell.row,cell.col)] = { value, text, format: cell.numFmt || '', ...(date ? {date}:{}), ...(datetime ? {datetime}:{}), ...(error ? {error}:{}) };
    }));
    const merges = sheet.model.merges || [];
    for (const merge of merges) parseRegion(merge);
    return { name:sheet.name, rows, cols, usedRows:sheet.rowCount, usedCols:sheet.columnCount, cells, merges, widths:Array.from({length:cols},(_,i)=>Math.max(72,Math.min(320,(sheet.getColumn(i+1).width || 14)*7))) };
  });
  const result = { sheets };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 5 * 1024 * 1024) throw new Error('表格内容超过 5 MB，请减少工作表内容。');
  return result;
}
