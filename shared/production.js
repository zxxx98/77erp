import { calculateBomNodes } from './bom-expansion.js';
import { validQuantity, quantityUnits, QUANTITY_SCALE, validStoredQuantity } from './quantity.js';
import { bomRequiredQuantity } from './bom.js';
import { parseProductionQuantity as parseExactQuantity, exactCompare, exactQuantity, validExactQuantity, exactBomQuantity, exactAdd, exactMultiply, exactSubtract, exactDivide, exactCeil, exactMax, exactSum, exactNumber, quantityFields } from './exact-quantity.js';
import { productionFlowView } from './production-flow.js';
import { pooledProductionStages, productionPoolPathMap } from './production-pools.js';
import { stageInputCanBeZero } from './production-stages.js';

export function productionActualDefault(item, quantity, order) {
  if (item.base_quantity === 0) return 0;
  if (order.snapshot_format !== 2 && !order.multi_level)
    return exactBomQuantity(item.base_quantity, quantity, order.base_quantity, item.base_quantity_fraction, item.loss_rate, order.loss_method);
  const amounts = new Map();
  let total = 0;
  for (const node of order.nodes) {
    let amount = exactBomQuantity(node.quantity, node.parent_path ? amounts.get(node.parent_path) : quantity, node.bom_base_quantity, node.quantity_fraction, node.loss_rate, node.loss_method);
    if (node.supply_fraction) amount = exactMultiply(amount, node.supply_fraction);
    amounts.set(node.path, amount);
    if (node.product_id === item.product_id && node.usage_mode === 'stock') total = exactAdd(total, amount);
  }
  return total;
}

export const productionStatusLabels = { draft: '待生产', awaiting_materials: '待领料', in_progress: '生产中', completed: '已完工', void: '已作废' };
export const productionPlannedQuantity = bomRequiredQuantity;
export function productionItemQuantity(item, quantity, order, standards) {
  if (item.base_quantity === 0) return 0;
  if (order.snapshot_format === 2 || order.multi_level) {
    if (standards) return standards.get(item.product_id);
    const row = calculateBomNodes(order.nodes, quantity, order.quantity_decimals ?? 6).rows.find(row => row.product_id === item.product_id);
    if (!row) throw new Error('生产配方缺少该领料项。');
    return row.required;
  }
  const standard = productionPlannedQuantity(item.base_quantity, quantity, order.base_quantity, item.base_quantity_fraction, item.loss_rate, order.loss_method, order.quantity_decimals ?? 6);
  return item.unit_round_up ? Math.ceil(standard) : standard;
}

// Reuse the saved supply split and rounding rules, removing loss at every level.
export function productionNetPlannedItems(order) {
  const netOrder = { ...order, nodes: order.nodes?.map(node => ({ ...node, loss_rate: 0 })) };
  const standards = order.snapshot_format === 2 || order.multi_level
    ? new Map(calculateBomNodes(netOrder.nodes, order.planned_quantity, order.quantity_decimals ?? 6).rows.map(row => [row.product_id, row.required])) : undefined;
  return order.items.map(item => ({ ...item, ...quantityFields(exactAdd(
    productionItemQuantity({ ...item, loss_rate: 0 }, order.planned_quantity, netOrder, standards),
    item.post_processing_planned_quantity ?? 0), 'net_planned_quantity') }));
}

export function validateProductionPlan(value, stored = false) {
  if (!value || !validQuantity(value.planned_quantity, true, stored ? 6 : 4)) throw new Error('计划产量需为正数，最多 4 位小数。');
  if (typeof value.note !== 'string' || value.note.length > 500) throw new Error('生产备注最多 500 字。');
}

export function validateProductionCompletion(value, items, stored = false) {
  if (!value) throw new Error('请填写合格成品数量。');
  if (stored) { if (!validExactQuantity(exactQuantity(value, 'completed_quantity'), true)) throw new Error('合格成品数量无效。'); }
  else parseExactQuantity(value.completed_quantity, true);
  if (value.finish_order !== undefined && typeof value.finish_order !== 'boolean') throw new Error('请明确本批入库后是否结束生产。');
  if (value.note !== undefined && (typeof value.note !== 'string' || value.note.length > 500)) throw new Error('本批备注最多 500 字。');
  if (!Array.isArray(value.items) || value.items.length !== items.length) throw new Error('请核对全部材料的实际耗料。');
  const expected = new Set(items.map(item => item.product_id)), seen = new Set();
  for (const item of value.items) {
    if (!item || !expected.has(item.product_id) || seen.has(item.product_id) || (stored && !validExactQuantity(exactQuantity(item))))
      throw new Error('实际耗料需为非负数且最多 4 位小数，材料不能重复或增删。');
    if (!stored) parseExactQuantity(item.quantity);
    if (item.variance_reason !== undefined && (typeof item.variance_reason !== 'string' || item.variance_reason.length > 500))
      throw new Error('每种材料的耗料差异原因最多 500 字。');
    seen.add(item.product_id);
  }
  if (!value.items.some(item => exactCompare(exactQuantity(item), 0) > 0)) throw new Error('至少一种材料的实际耗料需大于零。');
}

// Compare against the saved recipe scaled to actual good output, not the plan.
// Derived analysis must never prevent an otherwise valid stock posting. Older
// orders may have actual output whose theoretical requirement exceeds the cap.
export function productionMaterialAnalysis(item, completedQuantity, baseQuantity, actualQuantity, lossMethod = 'internal', nodes, decimals = 4) {
  try {
    if (!validExactQuantity(actualQuantity)) throw new Error('实际耗料无效。');
    if (item.base_quantity_fraction || Array.isArray(nodes) && nodes.some(node => node.quantity_fraction) || typeof actualQuantity === 'string' || typeof completedQuantity === 'string' || !validStoredQuantity(actualQuantity)) {
      const standard = productionActualDefault(item, completedQuantity, {base_quantity:baseQuantity,loss_method:lossMethod, ...(Array.isArray(nodes) ? {snapshot_format:2,nodes} : {})});
      if (!validExactQuantity(standard)) throw new Error('标准耗料无效。');
      const difference = exactSubtract(actualQuantity, standard);
      return {...quantityFields(standard,'standard_quantity'), ...quantityFields(difference,'variance_quantity'),
        variance_rate: exactCompare(standard,0) === 0 ? null : exactNumber(exactMultiply(exactDivide(difference,standard),100)), analysis_error:''};
    }
    const rawStandard = item.base_quantity === 0 ? 0 : nodes instanceof Map ? nodes.get(item.product_id) : nodes ? calculateBomNodes(nodes, completedQuantity, decimals).rows.find(row => row.product_id === item.product_id).required : productionPlannedQuantity(item.base_quantity, completedQuantity, baseQuantity, item.base_quantity_fraction ?? '', item.loss_rate === undefined ? 0 : item.loss_rate, lossMethod, decimals);
    const standard = item.unit_round_up ? Math.ceil(rawStandard) : rawStandard;
    if (!validStoredQuantity(standard, item.base_quantity !== 0)) throw new Error('标准耗料无效。');
    const difference = quantityUnits(actualQuantity) - quantityUnits(standard);
    return { standard_quantity: standard, variance_quantity: difference / QUANTITY_SCALE,
      variance_rate: standard === 0 ? null : difference * 100 / quantityUnits(standard), analysis_error: '' };
  } catch {
    return { standard_quantity: null, variance_quantity: null, variance_rate: null,
      analysis_error: '标准耗料暂无法计算，请核对合格产量、实际耗料和本单配方；标准数量超出上限时仅保留实际记录。' };
  }
}

export function productionFinishPreview(order) {
  if (!order) return null;
  const flow = productionFlowView(order);
  const pendingRegistrations = (order.operation_registrations || []).filter(row => row.status === 'pending');
  const unsettledRegistrations = pendingRegistrations.filter(row => row.kind === 'settlement' || row.acceptance_id != null);
  const uninspectedRegistrations = pendingRegistrations.filter(row => row.kind === 'acceptance' && row.acceptance_id == null);
  const settlementReady = order.flow_progress?.settlement_ready !== false;
  const readyRegistrations = settlementReady ? unsettledRegistrations : [];
  const completedOutput = exactQuantity(flow, 'completed_quantity');
  const hasOutput = exactCompare(completedOutput, 0) > 0;
  const outputRounding = order.status === 'completed'
    ? exactSubtract(exactQuantity(order, 'settled_completed_quantity'), completedOutput)
    : hasOutput ? exactSubtract(exactCeil(completedOutput, order.unit_round_up ? 0 : 4), completedOutput) : 0;
  const settledOutput = exactAdd(completedOutput, outputRounding);
  const materials = (order.items || []).map(item => {
    if (!order.material_workflow) {
      return {
        ...item,
        ...quantityFields(exactQuantity(item, 'actual_quantity'), 'projected_consumed_quantity'),
        ...quantityFields(0, 'projected_available_quantity'),
        ...quantityFields(0, 'rounding_quantity'),
        ...quantityFields(0, 'rounding_shortage_quantity'),
        ...quantityFields(0, 'returnable_quantity'),
      };
    }
    const pendingMaterial = exactSum(readyRegistrations.flatMap(row => (row.actual_inputs || []).filter(input => input.key === `material:${item.product_id}`)));
    const consumed = exactAdd(exactQuantity(item, 'consumed_quantity'), pendingMaterial);
    const available = exactMax(0, exactSubtract(exactQuantity(item, 'available_quantity'), pendingMaterial));
    const rounding = order.status === 'completed' ? 0 : exactSubtract(exactCeil(consumed, item.unit_round_up ? 0 : 4), consumed);
    const shortage = exactCompare(rounding, available) > 0 ? exactSubtract(rounding, available) : 0;
    const returnable = exactCompare(available, rounding) > 0 ? exactSubtract(available, rounding) : 0;
    return {
      ...item,
      ...quantityFields(consumed, 'projected_consumed_quantity'),
      ...quantityFields(available, 'projected_available_quantity'),
      ...quantityFields(rounding, 'rounding_quantity'),
      ...quantityFields(shortage, 'rounding_shortage_quantity'),
      ...quantityFields(returnable, 'returnable_quantity'),
    };
  });
  const scraps = (order.scraps || []).map(scrap => {
    const stockQty = exactQuantity(scrap, 'stock_quantity');
    const stockRounding = order.status === 'completed' ? 0 : exactSubtract(exactCeil(stockQty, scrap.unit_round_up ? 0 : 4), stockQty);
    const discardQty = exactQuantity(scrap, 'discard_quantity');
    const discardRounding = order.status === 'completed' ? 0 : exactSubtract(exactCeil(discardQty, scrap.unit_round_up ? 0 : 4), discardQty);
    return {
      ...scrap,
      ...quantityFields(stockRounding, 'stock_rounding_quantity'),
      ...quantityFields(exactAdd(stockQty, stockRounding), 'settled_stock_quantity'),
      ...quantityFields(discardRounding, 'discard_rounding_quantity'),
      ...quantityFields(exactAdd(discardQty, discardRounding), 'settled_discard_quantity'),
    };
  });
  const semiFinishedBalances = order.stage_workflow
    ? pooledProductionStages(flow).filter(stage => stage.path !== '' && exactCompare(exactQuantity(stage, 'available_quantity'), 0) > 0)
    : [];
  const pendingMaterialDocuments = (order.material_documents || []).filter(doc => doc.status === 'pending');
  const pendingStageReceipts = (order.receipt_documents || []).filter(doc => doc.kind === 'stage' && doc.status === 'pending');
  const postRoutes = (flow.operation_routes || []).filter(route => route.product_coefficient != null);
  const waitingForOutput = postRoutes.length > 0 && !flow.output_completed;
  const postProcessingGaps = postRoutes.flatMap(route => {
    const node = route.operations?.[0];
    return node && node.available_quantity > 0 ? [{ path: route.path, route_name: route.route_name, node_id: node.id, name: node.name, remaining: node.available_quantity }] : [];
  });
  const canonicalStagePaths = order.stage_workflow ? new Set(pooledProductionStages(flow).map(stage => stage.path)) : null;
  const operationWip = [];
  for (const route of (flow.operation_routes || [])) {
    if (route.product_coefficient != null) continue;
    if (canonicalStagePaths && !canonicalStagePaths.has(route.path)) continue;
    const outputNode = route.operations?.find(node => node.is_output);
    if (!outputNode) continue;
    const outputQty = exactQuantity(outputNode, 'completed_quantity');
    const layer = order.stage_workflow ? order.stages?.find(stage => stage.path === route.path) : null;
    for (const node of route.operations || []) {
      const nodeQty = exactQuantity(node, 'completed_quantity');
      if (exactCompare(nodeQty, outputQty) !== 0) {
        operationWip.push({
          path: route.path,
          layer_name: layer?.name || order.product_name,
          route_name: route.route_name,
          node_id: node.id,
          name: node.name,
          unit: layer?.unit || order.unit,
          ...quantityFields(nodeQty, 'completed_quantity'),
          ...quantityFields(outputQty, 'output_quantity'),
          ...quantityFields(exactSubtract(nodeQty, outputQty), 'wip_quantity'),
        });
      }
    }
  }
  const returnableMaterials = materials.filter(item => exactCompare(exactQuantity(item, 'returnable_quantity'), 0) > 0);
  const roundingShortages = materials.filter(item => exactCompare(exactQuantity(item, 'rounding_shortage_quantity'), 0) > 0);
  const roundingMaterials = materials.filter(item => exactCompare(exactQuantity(item, 'rounding_quantity'), 0) > 0);
  const activeBatches = (order.batches || []).filter(batch => batch.status === 'active');
  const reviewMaterials = !order.stage_workflow && activeBatches.length > 0
    ? (order.items || [])
        .filter(item => !item.is_post_processing_only)
        .map(item => {
          const recorded = exactSum(
            activeBatches.map(batch => batch.items?.find(entry => entry.product_id === item.product_id)).filter(Boolean),
            'actual_quantity',
          );
          const available = order.material_workflow
            ? exactQuantity(item, 'available_quantity')
            : exactQuantity(item.product || {}, 'stock');
          return {
            ...item,
            ...quantityFields(recorded, 'recorded_quantity'),
            ...quantityFields(available, 'review_available_quantity'),
            ...quantityFields(exactAdd(recorded, available), 'max_quantity'),
            min_quantity: 0,
          };
        })
    : [];
  const reviewPostProcessingMaterials = !order.stage_workflow && activeBatches.length > 0
    ? (order.items || []).filter(
        item => item.is_post_processing_only && exactCompare(exactQuantity(item, 'post_processing_consumed_quantity'), 0) > 0,
      )
    : [];
  const poolMap = order.stage_workflow ? productionPoolPathMap(order) : new Map();
  const stageByPath = new Map((order.stages || []).map(stage => [stage.path, stage]));
  const orderedStages = order.stage_workflow
    ? [...(order.stages || []).filter(stage => stage.path !== ''), ...(order.stages || []).filter(stage => stage.path === '')]
    : [];
  const reviewStages = orderedStages
    .filter(stage => exactCompare(exactQuantity(stage, 'completed_quantity'), 0) > 0)
    .map(stage => ({
      ...stage,
      items: (stage.items || []).map(node => {
        const recorded = exactQuantity(node, 'actual_quantity');
        const poolPaths = node.usage_mode === 'explode' ? (poolMap.get(node.path) || [node.path]) : null;
        const poolAvailable = poolPaths
          ? exactSum(poolPaths.map(path => stageByPath.get(path)).filter(Boolean), 'available_quantity')
          : exactQuantity(order.items?.find(item => item.product_id === node.product_id) || {}, 'available_quantity');
        return {
          ...node,
          stage_path: stage.path,
          input_path: node.path,
          pool_key: poolPaths ? `semi:${poolPaths.join('|')}` : `raw:${node.product_id}`,
          cannot_be_zero: !stageInputCanBeZero(node, stage.items),
          ...quantityFields(recorded, 'recorded_quantity'),
          ...quantityFields(poolAvailable, 'pool_available_quantity'),
          ...quantityFields(exactAdd(recorded, poolAvailable), 'max_quantity'),
        };
      }),
    }));
  const reviewHasItems = order.stage_workflow
    ? reviewStages.some(stage => stage.items.length > 0)
    : reviewMaterials.length > 0;
  const hasRootUninspected = uninspectedRegistrations.some(row => row.endpoint !== 'operations/report' && row.path === '');
  const step1Blocked = !hasOutput
    || pendingMaterialDocuments.length > 0
    || pendingStageReceipts.length > 0
    || uninspectedRegistrations.length > 0
    || (unsettledRegistrations.length > 0 && !settlementReady)
    || waitingForOutput
    || postProcessingGaps.length > 0
    || operationWip.length > 0;
  const step1HasItems = step1Blocked || unsettledRegistrations.length > 0;
  const step2Blocked = semiFinishedBalances.length > 0 || pendingStageReceipts.length > 0 || roundingShortages.length > 0;
  const step2HasItems = step2Blocked || returnableMaterials.length > 0;
  return {
    has_output: hasOutput,
    settlement_ready: settlementReady,
    can_confirm_output_completion: postRoutes.length > 0 && !flow.output_completed && hasOutput && !order.output_completion_confirmed && !hasRootUninspected,
    product: {
      ...quantityFields(completedOutput, 'completed_quantity'),
      ...quantityFields(outputRounding, 'rounding_quantity'),
      ...quantityFields(settledOutput, 'settled_quantity'),
    },
    materials,
    review_has_items: reviewHasItems,
    review_materials: reviewMaterials,
    review_post_processing_materials: reviewPostProcessingMaterials,
    review_stages: reviewStages,
    returnable_materials: returnableMaterials,
    rounding_shortages: roundingShortages,
    rounding_materials: roundingMaterials,
    scraps,
    semi_finished_balances: semiFinishedBalances,
    pending_material_documents: pendingMaterialDocuments,
    pending_stage_receipts: pendingStageReceipts,
    pending_registrations: pendingRegistrations,
    unsettled_registrations: unsettledRegistrations,
    uninspected_registrations: uninspectedRegistrations,
    waiting_for_output: waitingForOutput,
    post_processing_gaps: postProcessingGaps,
    operation_wip: operationWip,
    step1_blocked: step1Blocked,
    step1_has_items: step1HasItems,
    step2_blocked: step2Blocked,
    step2_has_items: step2HasItems,
  };
}
