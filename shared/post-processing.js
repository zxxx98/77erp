import { exactRatio, exactCompare, exactQuantity, exactDivide } from './exact-quantity.js';

export const postProcessingUnit = '次';

export function productionOutputCompleted(order, quantity = exactQuantity(order, 'completed_quantity'), confirmed = order.output_completion_confirmed) {
  return order.status !== 'void' && (Boolean(confirmed) || exactCompare(quantity, order.planned_quantity) >= 0);
}

export function postProcessingMaterialRate(perUnit, perRun) {
  if (!perUnit?.length || perUnit.length !== perRun?.length) throw new Error('后处理材料用量配置不完整。');
  let rate;
  for (const material of perUnit) {
    const run = perRun.find(row => row.product_id === material.product_id);
    if (!run) throw new Error('后处理工序绑定材料已变化，请重新选择工序。');
    const current = exactDivide(exactQuantity(material), run.quantity);
    if (rate !== undefined && exactCompare(rate, current) !== 0)
      throw new Error('同一道后处理工序的各材料用量需与工序每次用量保持相同比例，请核对每单位成品用量。');
    rate = current;
  }
  return rate;
}

export function postProcessingMaterialAvailableRuns(materials, items) {
  if (!materials?.length) return null;
  return Math.min(...materials.map(material => {
    const available = exactQuantity(items.find(row => row.product_id === material.product_id), 'available_quantity');
    const [quantity, scale] = exactRatio(exactDivide(available, material.quantity));
    return Math.max(0, Number(quantity / scale));
  }));
}

export function postProcessingLimit(quantity, coefficient, completed, graph) {
  const [output, outputScale] = exactRatio(quantity);
  if (graph?.post_processing_materials_per_unit?.length) {
    const [rate, scale] = exactRatio(postProcessingMaterialRate(graph.post_processing_materials_per_unit, graph.nodes[0].materials));
    const numerator = output * rate, denominator = outputScale * scale;
    return Number(numerator / denominator + (completed && numerator % denominator ? 1n : 0n));
  }
  const [products, coefficientScale] = exactRatio(coefficient);
  const numerator = output * coefficientScale, denominator = outputScale * products;
  return Number(numerator / denominator + (completed && numerator % denominator ? 1n : 0n));
}
