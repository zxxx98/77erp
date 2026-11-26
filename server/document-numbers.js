// Daily sequence numbers follow PREFIX + YYYYMMDD + 6-digit counter (expanding past 999999).
// Only numeric suffixes after the date prefix are scanned so historical `-uuid` numbers are ignored.
export function nextDailyDocumentNumber(db, table, prefix, at = new Date().toISOString()) {
  const dateStr = at instanceof Date ? at.toISOString() : String(at);
  const fullPrefix = `${prefix}${dateStr.slice(0, 10).replaceAll('-', '')}`;
  const last = db.prepare(`SELECT MAX(CAST(substr(number, ?) AS INTEGER)) AS sequence FROM ${table} WHERE number GLOB ?`)
    .get(fullPrefix.length + 1, `${fullPrefix}[0-9]*`);
  let seq = (last?.sequence || 0) + 1;
  let number = `${fullPrefix}${String(seq).padStart(6, '0')}`;
  while (db.prepare(`SELECT 1 FROM ${table} WHERE number=?`).get(number)) {
    seq += 1;
    number = `${fullPrefix}${String(seq).padStart(6, '0')}`;
  }
  return number;
}
