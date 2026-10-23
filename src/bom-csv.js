const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const text = value => quote(/^\s*[=+\-@]/.test(String(value ?? '')) ? `'${value}` : value);

export function bomCSV(snapshot) {
  const rows = [
    ['用料清单', snapshot.name, '仓库', snapshot.warehouse.name].map(text),
    ['成品', snapshot.product.name, '成品编码', snapshot.product.barcode].map(text),
    [text('生产数量'), quote(snapshot.production_quantity), text('成品单位'), text(snapshot.product.unit)],
    [text('基准产量'), quote(snapshot.base_quantity), text('库存读取时间'), text(snapshot.captured_at)],
    ['材料名称', '编码', '规格型号', '单位', '基准用量', '本次需求', '账面库存', '缺料数量', '备注'].map(text),
    ...snapshot.rows.map(row => [text(row.name), text(row.barcode), text(row.specification), text(row.unit),
      quote(row.quantity_fraction ? `${row.quantity_fraction}（约 ${row.quantity}）` : row.quantity), quote(row.required), quote(row.stock), quote(row.shortage), text(row.note)]),
    [text('说明'), text('按单层用料清单测算；需求向上保留 6 位小数。库存为读取时的账面数量，未预留或扣减。')],
  ];
  return '\ufeff' + rows.map(row => row.join(',')).join('\r\n') + '\r\n';
}
