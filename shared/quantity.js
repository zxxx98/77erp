// Quantities use millionths; monetary values continue to use integer cents.
export const QUANTITY_SCALE = 1000000;
export const MAX_QUANTITY = 99999999;
export function validQuantity(value, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_QUANTITY || (positive && value === 0)) return false;
  const scaled = value * QUANTITY_SCALE;
  const units = Math.round(scaled);
  return Number.isSafeInteger(units) && (value === 0 || units > 0) &&
    Math.abs(scaled - units) <= Number.EPSILON * Math.abs(scaled);
}
export function quantityUnits(value) {
  return Math.round(value * QUANTITY_SCALE);
}
export function addQuantity(left, right) {
  return (quantityUnits(left) + quantityUnits(right)) / QUANTITY_SCALE;
}
export function parseQuantity(value, positive = false) {
  const raw = String(value).trim();
  const number = Number(raw);
  if (!/^\d+(\.\d{1,6})?$/.test(raw) || !validQuantity(number, positive))
    throw new Error(`数量需为${positive ? '正数' : '非负数'}，最多 6 位小数，上限为 ${MAX_QUANTITY}。`);
  return number;
}
