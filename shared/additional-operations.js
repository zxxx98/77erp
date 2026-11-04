import { addQuantity, quantityUnits, QUANTITY_SCALE } from './quantity.js';
import { exactQuantity, exactMultiply, exactDivide, quantityInput } from './exact-quantity.js';

export function additionalPlannedQuantities(routes = []) {
  const quantities = new Map();
  for (const route of routes) for (const item of typeof route.additional_materials === 'string' ? JSON.parse(route.additional_materials) : route.additional_materials || [])
    quantities.set(item.product_id, addQuantity(quantities.get(item.product_id) || 0, item.quantity));
  return quantities;
}

export function additionalMaterialDefaults(route, quantity) {
  return (route.additional_materials || []).map(item => {
    return { ...item, quantity: quantityInput(exactDivide(exactMultiply(exactQuantity(item), quantity), route.additional_quantity)), variance_reason: '' };
  });
}
