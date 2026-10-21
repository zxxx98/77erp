import { parseRegion } from './quality-template.js';

// Trim the displayed grid without changing source coordinates or validation bounds.
export function sheetPreviewBounds(sheet, regions = []) {
  if (!sheet) return null;
  let rows = 1, cols = 1;
  const include = address => {
    if (!address) return;
    try {
      const region = parseRegion(address);
      rows = Math.max(rows, region.r2);
      cols = Math.max(cols, region.c2);
    } catch { /* A manually edited region may still be incomplete. */ }
  };
  for (const [address, cell] of Object.entries(sheet.cells)) {
    if (cell.error || String(cell.text ?? '').trim() || String(cell.value ?? '').trim()) include(address);
  }
  for (const merge of sheet.merges) include(merge);
  for (const region of regions) include(region);
  rows = Math.min(rows, sheet.rows);
  cols = Math.min(cols, sheet.cols);
  return { rows, cols, widths: sheet.widths.slice(0, cols) };
}
