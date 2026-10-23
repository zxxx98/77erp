const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const text = value => quote(/^\s*[=+\-@]/.test(String(value ?? '')) ? `'${value}` : value);

export function bomCSV(snapshot) {
  const rows = [
    ['BOM', snapshot.name, '仓库', snapshot.warehouse.name].map(text),
    ['成品', snapshot.product.name, '成品编码', snapshot.product.barcode].map(text),
    [text('生产数量'), quote(snapshot.production_quantity), text('成品单位'), text(snapshot.product.unit)],
    [text('基准产量'), quote(snapshot.base_quantity), text('库存读取时间'), text(snapshot.captured_at)],
    ['材料名称', '编码', '规格型号', '单位', '基准净用量', '本次需求（含损耗）', '账面库存', '缺料数量', '备注', '标准损耗率（%）'].map(text),
    ...snapshot.rows.map(row => [text(row.name), text(row.barcode), text(row.specification), text(row.unit),
      quote(row.quantity_fraction ? `${row.quantity_fraction}（约 ${row.quantity}）` : row.quantity), quote(row.required), quote(row.stock), quote(row.shortage), text(row.note), quote(row.loss_rate ?? 0)]),
    ...((snapshot.scraps || []).length ? [
      ['预计废料名称', '编码', '规格型号', '单位', '计算方式', '基准数量或比例', '来源材料编码', '预计产出', '备注'].map(text),
      ...snapshot.scraps.map(row => [text(row.name), text(row.barcode), text(row.specification), text(row.unit),
        text(row.method === 'output' ? '按产量' : '按材料投入比例'), text(row.quantity_fraction ? `${row.quantity_fraction}（约 ${row.quantity}）` : `${row.quantity}${row.method === 'input_ratio' ? '%' : ''}`),
        text(snapshot.rows.find(item => item.product_id === row.source_product_id)?.barcode || ''), quote(row.planned_quantity), text(row.note)]),
    ] : []),
    [text('说明'), text('按单层BOM测算；标准投入＝净用量÷（1－标准损耗率），需求最终向上保留 6 位小数。按投入比例的废料基于含损耗投入计算，不再加到材料需求上。库存为读取时的账面数量，未预留或扣减。')],
  ];
  return '\ufeff' + rows.map(row => row.join(',')).join('\r\n') + '\r\n';
}
