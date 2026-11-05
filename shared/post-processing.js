import { exactRatio, exactCompare, exactQuantity } from './exact-quantity.js';

export const postProcessingUnit = '次';

export function productionOutputCompleted(order, quantity = exactQuantity(order, 'completed_quantity'), confirmed = order.output_completion_confirmed) {
  return order.status !== 'void' && (Boolean(confirmed) || exactCompare(quantity, order.planned_quantity) >= 0);
}

export function postProcessingLimit(quantity, coefficient, completed) {
  const [output, outputScale] = exactRatio(quantity);
  const [products, coefficientScale] = exactRatio(coefficient);
  const numerator = output * coefficientScale, denominator = outputScale * products;
  return Number(numerator / denominator + (completed && numerator % denominator ? 1n : 0n));
}
