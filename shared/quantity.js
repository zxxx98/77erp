// Keep legacy arithmetic in millionths; new quantities use at most four decimals.
export const QUANTITY_SCALE = 1000000;
export const MAX_QUANTITY = 99999999;

// Input limits do not apply to ratios produced by exact arithmetic. Stored
// integer fractions also retain the previous denominator limit for backups.
export function parseQuantityFraction(value, positive = false, stored = false) {
  const match = typeof value === 'string' && value.length <= 60 && value.match(/^\s*(\d+)(?:\.(\d{1,4}))?\s*\/\s*(\d+)\s*$/);
  const error = () => new Error(`分数的分子最多 4 位小数且不超过 ${MAX_QUANTITY}，分母需为 1–9999 的整数。`);
  if (!match) throw error();
  const digits = match[2] || '';
  const numerator = BigInt(match[1] + digits), scale = 10n ** BigInt(digits.length);
  const denominator = BigInt(match[3]);
  if (numerator > BigInt(MAX_QUANTITY) * scale || positive && numerator === 0n || denominator < 1n ||
      denominator > BigInt(stored && !match[2] ? MAX_QUANTITY : 9999)) throw error();
  const decimal = digits.replace(/0+$/, '');
  return `${BigInt(match[1])}${decimal ? `.${decimal}` : ''}/${denominator}`;
}
export function validQuantity(value, positive = false, decimals = 4) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_QUANTITY || (positive && value === 0)) return false;
  const scaled = value * 10 ** decimals;
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
  if (!/^\d+(\.\d{1,4})?$/.test(raw) || !validQuantity(number, positive))
    throw new Error(`数量需为${positive ? '正数' : '非负数'}，最多 4 位小数，上限为 ${MAX_QUANTITY}。`);
  return number;
}

// Normalize a validated quantity for a material. Ratios in BOM definitions remain exact.
export function materialQuantity(value, product) {
  if (!validStoredQuantity(value)) throw new Error('数量需为非负数，最多 6 位小数。');
  return product?.unit_round_up ? Math.ceil(value) : Math.ceil(quantityUnits(value) / 100) / 10000;
}
export function validStoredQuantity(value, positive = false) {
  return validQuantity(value, positive, 6);
}
