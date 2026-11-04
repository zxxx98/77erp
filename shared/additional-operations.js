import { addQuantity, quantityUnits, QUANTITY_SCALE } from './quantity.js';

export function additionalPlannedQuantities(routes = []) {
  const quantities = new Map();
  for (const route of routes) for (const item of typeof route.additional_materials === 'string' ? JSON.parse(route.additional_materials) : route.additional_materials || [])
    quantities.set(item.product_id, addQuantity(quantities.get(item.product_id) || 0, item.quantity));
  return quantities;
}

export function additionalMaterialDefaults(route, quantity) {
  return (route.additional_materials || []).map(item => {
    const step = BigInt(item.unit_round_up ? QUANTITY_SCALE : QUANTITY_SCALE / 10000);
    const numerator = BigInt(quantityUnits(item.quantity)) * BigInt(quantityUnits(quantity));
    const denominator = BigInt(quantityUnits(route.additional_quantity)) * step;
    const rounded = (numerator + denominator - 1n) / denominator * step;
    return { ...item, quantity: String(Number(rounded) / QUANTITY_SCALE), variance_reason: '' };
  });
}
