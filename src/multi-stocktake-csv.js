import { t, getLocale } from './i18n/index.js';
// Text cells are escaped independently from numeric quantities/differences.
const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const text = value => quote(/^[\s]*[=+\-@]/.test(String(value ?? '')) ? `'${value}` : value);

export function multiStocktakeCSV(snapshot, language = getLocale()) {
  const header = [text(t("warehouse.material.name", { lng: language })), text(t("warehouse.stocktake.code", { lng: language })), text(t("warehouse.unit", { lng: language })), ...snapshot.warehouses.flatMap((w, i) =>
    i === 0 ? [text(t('warehouse.stocktake.quantity', { warehouse: w.name, lng: language }))] : [text(t('warehouse.stocktake.quantity', { warehouse: w.name, lng: language })), text(t('warehouse.stocktake.difference', { warehouse: w.name, lng: language }))])];
  const rows = snapshot.rows.map(row => [text(row.name), text(row.barcode), text(row.unit), ...row.cells.flatMap((cell, i) => {
    const quantity = cell.status === 'missing' ? text(t("warehouse.material.notRegistered", { lng: language })) :
      cell.status === 'unit_mismatch' ? text(t('warehouse.stocktake.mismatch', { quantity: cell.quantity, unit: cell.unit, lng: language })) : quote(cell.quantity);
    return i === 0 ? [quantity] : [quantity, cell.difference === null ? quote('') : quote(cell.difference)];
  })]);
  return '\ufeff' + [header, ...rows].map(row => row.join(',')).join('\r\n') + '\r\n';
}
