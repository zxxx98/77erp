import { bomLossMethodLabels, bomLossMethodFormulas } from '../shared/bom.js';

const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const text = value => quote(/^\s*[=+\-@]/.test(String(value ?? '')) ? `'${value}` : value);

export function bomCSV(snapshot) {
  const lossMethod = snapshot.loss_method ?? 'internal';
  const rows = [
    ['BOM', snapshot.name, '仓库', snapshot.warehouse.name].map(text),
    ['成品', snapshot.product.name, '成品编码', snapshot.product.barcode].map(text),
    [text('生产数量'), quote(snapshot.production_quantity), text('成品单位'), text(snapshot.product.unit)],
    [text('基准产量'), quote(snapshot.base_quantity), text('库存读取时间'), text(snapshot.captured_at), text('标准损耗计算方式'), text(snapshot.multi_level ? '逐层计算，见结构明细' : bomLossMethodLabels[lossMethod]), text('BOM ID'), quote(snapshot.bom_id), text('编辑版本'), quote(snapshot.version)],
    ['材料名称', '编码', '规格型号', '单位', '基准净用量', '本次需求（含损耗）', '账面库存', '缺料数量', '备注', '标准损耗率（%）'].map(text),
    ...snapshot.rows.map(row => [text(row.name), text(row.barcode), text(row.specification), text(row.unit),
      quote(row.quantity_fraction ? `${row.quantity_fraction}（约 ${row.quantity}）` : row.quantity), quote(row.required), quote(row.stock), quote(row.shortage), text(snapshot.multi_level ? `来源路径：${row.sources.join('、')}` : row.note), quote(snapshot.multi_level ? '' : row.loss_rate ?? 0)]),
    ...((snapshot.scraps || []).length ? [
      ['预计废料名称', '编码', '规格型号', '单位', '计算方式', '基准数量或比例', '来源材料编码', '预计产出', '备注'].map(text),
      ...snapshot.scraps.map(row => [text(row.name), text(row.barcode), text(row.specification), text(row.unit),
        text(row.method === 'output' ? '按产量' : '按材料投入比例'), text(row.quantity_fraction ? `${row.quantity_fraction}（约 ${row.quantity}）` : `${row.quantity}${row.method === 'input_ratio' ? '%' : ''}`),
        text(snapshot.rows.find(item => item.product_id === row.source_product_id)?.barcode || ''), quote(row.planned_quantity), text(row.note)]),
    ] : []),
    [text('说明'), text(snapshot.multi_level
      ? '按毛需求展开，中间半成品库存未抵扣；各层使用自己的基准产量和损耗算法。最终领料先合并精确值再向上保留6位，来源见结构明细。库存未预留或扣减。'
      : `按单层BOM测算；${bomLossMethodLabels[lossMethod]}标准投入＝${bomLossMethodFormulas[lossMethod]}，再按生产数量÷基准产量折算，需求最终向上保留 4 位小数。按投入比例的废料基于含损耗投入计算，不再加到材料需求上。库存为读取时的账面数量，未预留或扣减。`)],
  ];
  return '\ufeff' + rows.map(row => row.join(',')).join('\r\n') + '\r\n';
}

export function bomStructureCSV(snapshot) {
  const rows = [
    ['根BOM', snapshot.name, 'BOM ID', snapshot.bom_id, '编辑版本', snapshot.version, '仓库', snapshot.warehouse.name].map(text),
    ['成品', snapshot.product.name, '生产数量', snapshot.production_quantity, '库存读取时间', snapshot.captured_at].map(text),
    ['路径','层级','物料名称','物料编码','单位','用料方式','来源BOM','BOM ID','编辑版本','基准产量','基准单位','基准净用量','损耗率（%）','损耗算法','节点需求','下级BOM ID'].map(text),
    ...(snapshot.nodes || []).map(node => [text(`路径 ${node.path}`), quote(node.path.split('.').length), text(node.name), text(node.barcode), text(node.unit),
      text(node.usage_mode === 'explode' ? '展开下级 BOM' : '领用本物料'), text(node.bom_name), quote(node.bom_id), quote(node.bom_version),
      quote(node.bom_base_quantity), text(node.bom_base_unit), text(node.quantity_fraction ? `${node.quantity_fraction}（约 ${node.quantity}）` : node.quantity),
      quote(node.loss_rate), text(bomLossMethodLabels[node.loss_method]), quote(node.required), quote(node.child_bom_id)]),
    ['说明','按毛需求展开；中间半成品库存未抵扣；节点显示值向上保留6位，最终领料汇总按未舍入值计算。库存未预留或扣减。'].map(text),
  ];
  return '\ufeff' + rows.map(row => row.join(',')).join('\r\n') + '\r\n';
}
