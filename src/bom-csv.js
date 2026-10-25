import { i18n, getLocale } from './i18n/index.js';

const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const text = value => quote(/^\s*[=+\-@]/.test(String(value ?? '')) ? `'${value}` : value);

export function bomCSV(snapshot, language = getLocale()) {
  const pt = i18n.getFixedT(language);
  const lossMethod = snapshot.loss_method ?? 'internal';
  const rows = [
    ['BOM', snapshot.name, pt("production.export.warehouse"), snapshot.warehouse.name].map(text),
    [pt("production.finishedProduct"), snapshot.product.name, pt("production.export.productCode"), snapshot.product.barcode].map(text),
    [text(pt("production.productionQuantity2")), quote(snapshot.production_quantity), text(pt("production.export.productUnit")), text(snapshot.product.unit)],
    [text(pt("production.baseOutput")), quote(snapshot.base_quantity), text(pt("production.export.stockReadTime")), text(snapshot.captured_at), text(pt("production.standardLossCalculation")), text(snapshot.multi_level ? pt("production.export.calculatedByLevelSeeStructureDetails") : pt('production.loss.' + lossMethod)), text('BOM ID'), quote(snapshot.bom_id), text(pt("production.export.editVersion")), quote(snapshot.version)],
    [pt("production.export.materialName"), pt("production.export.code"), pt("production.export.specification"), pt("production.unit"), pt("production.baseNetUsage"), pt("production.requiredQuantityIncludingLoss"), pt("production.bookStock"), pt("production.shortageQuantity"), pt("production.note"), pt("production.standardLossRate2")].map(text),
    ...snapshot.rows.map(row => [text(row.name), text(row.barcode), text(row.specification), text(row.unit),
      quote(row.quantity_fraction ? pt("production.export.approximately", { v0: row.quantity_fraction, v1: row.quantity }) : row.quantity), quote(row.required), quote(row.stock), quote(row.shortage), text(snapshot.multi_level ? pt("production.export.sourcePaths", { v0: row.sources.join('、') }) : row.note), quote(snapshot.multi_level ? '' : row.loss_rate ?? 0)]),
    ...((snapshot.scraps || []).length ? [
      [pt("production.export.estimatedScrapName"), pt("production.export.code"), pt("production.export.specification"), pt("production.unit"), pt("production.calculationMethod"), pt("production.export.baseQuantityOrRatio"), pt("production.export.sourceMaterialCode"), pt("production.export.estimatedOutput"), pt("production.note")].map(text),
      ...snapshot.scraps.map(row => [text(row.name), text(row.barcode), text(row.specification), text(row.unit),
        text(row.method === 'output' ? pt("production.byOutput") : pt("production.byMaterialInputRatio")), text(row.quantity_fraction ? pt("production.export.approximately", { v0: row.quantity_fraction, v1: row.quantity }) : `${row.quantity}${row.method === 'input_ratio' ? '%' : ''}`),
        text(snapshot.rows.find(item => item.product_id === row.source_product_id)?.barcode || ''), quote(row.planned_quantity), text(row.note)]),
    ] : []),
    [text(pt("production.description")), text(snapshot.multi_level
      ? pt("production.export.expandedByGrossRequirementsWithoutDeductingIntermediateStock")
      : pt("production.export.singleLevelBomCalculationStandardInputScaledBy", { v0: pt('production.loss.' + lossMethod), v1: pt('production.loss.' + lossMethod + 'Formula') }))],
  ];
  return '\ufeff' + rows.map(row => row.join(',')).join('\r\n') + '\r\n';
}

export function bomStructureCSV(snapshot, language = getLocale()) {
  const pt = i18n.getFixedT(language);
  const rows = [
    [pt("production.export.rootBom"), snapshot.name, 'BOM ID', snapshot.bom_id, pt("production.export.editVersion"), snapshot.version, pt("production.export.warehouse"), snapshot.warehouse.name].map(text),
    [pt("production.finishedProduct"), snapshot.product.name, pt("production.productionQuantity2"), snapshot.production_quantity, pt("production.export.stockReadTime"), snapshot.captured_at].map(text),
    [pt("production.export.path"),pt("production.export.level"),pt("production.materialName"),pt("production.materialCode"),pt("production.unit"),pt("production.materialSupplyMethod"),pt("production.export.sourceBom"),'BOM ID',pt("production.export.editVersion"),pt("production.baseOutput"),pt("production.export.baseUnit"),pt("production.baseNetUsage"),pt("production.export.lossRate"),pt("production.export.lossMethod"),pt("production.export.nodeRequirement"),pt("production.export.childBomId")].map(text),
    ...(snapshot.nodes || []).map(node => [text(pt("production.export.path", { v0: node.path })), quote(node.path.split('.').length), text(node.name), text(node.barcode), text(node.unit),
      text(node.usage_mode === 'explode' ? pt("production.expandChildBom") : pt("production.issueThisMaterial")), text(node.bom_name), quote(node.bom_id), quote(node.bom_version),
      quote(node.bom_base_quantity), text(node.bom_base_unit), text(node.quantity_fraction ? pt("production.export.approximately", { v0: node.quantity_fraction, v1: node.quantity }) : node.quantity),
      quote(node.loss_rate), text(pt('production.loss.' + node.loss_method)), quote(node.required), quote(node.child_bom_id)]),
    [pt("production.description"),pt("production.export.expandedByGrossRequirementsWithoutDeductingIntermediateStock")].map(text),
  ];
  return '\ufeff' + rows.map(row => row.join(',')).join('\r\n') + '\r\n';
}
