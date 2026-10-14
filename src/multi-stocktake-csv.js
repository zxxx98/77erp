// Text cells are escaped independently from numeric quantities/differences.
const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const text = value => quote(/^[\s]*[=+\-@]/.test(String(value ?? '')) ? `'${value}` : value);

export function multiStocktakeCSV(snapshot) {
  const header = [text('物料名称'), text('编号'), text('单位'), ...snapshot.warehouses.flatMap((w, i) =>
    i === 0 ? [text(`${w.name}数量`)] : [text(`${w.name}数量`), text(`${w.name}差值`)])];
  const rows = snapshot.rows.map(row => [text(row.name), text(row.barcode), text(row.unit), ...row.cells.flatMap((cell, i) => {
    const quantity = cell.status === 'missing' ? text('未建档') :
      cell.status === 'unit_mismatch' ? text(`${cell.quantity} ${cell.unit}（单位不同）`) : quote(cell.quantity);
    return i === 0 ? [quantity] : [quantity, cell.difference === null ? quote('') : quote(cell.difference)];
  })]);
  return '\ufeff' + [header, ...rows].map(row => row.join(',')).join('\r\n') + '\r\n';
}
