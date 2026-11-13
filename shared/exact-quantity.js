import { MAX_QUANTITY, parseQuantity, parseQuantityFraction, validQuantity } from './quantity.js';

function greatestCommonDivisor(left, right) {
  left = left < 0n ? -left : left;
  while (right) [left, right] = [right, left % right];
  return left;
}

export function exactRatio(value) {
  const raw = String(value).trim();
  if (raw.length > 4096) throw new Error('数量分数超出计算范围。');
  const fraction = raw.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+)$/);
  let numerator, denominator;
  if (fraction) {
    const [top, scale] = exactRatio(fraction[1]);
    numerator = top; denominator = BigInt(fraction[2]) * scale;
  } else {
    const decimal = raw.match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
    if (!decimal) throw new Error('数量需为小数或分数，例如 1/3。');
    const exponent = Number(decimal[4] || 0) - (decimal[3]?.length || 0);
    if (Math.abs(exponent) > 100) throw new Error('数量超出计算范围。');
    numerator = BigInt(`${decimal[1]}${decimal[2]}${decimal[3] || ''}`) * 10n ** BigInt(Math.max(0, exponent));
    denominator = 10n ** BigInt(Math.max(0, -exponent));
  }
  if (denominator <= 0n) throw new Error('分母必须大于零。');
  const divisor = greatestCommonDivisor(numerator, denominator);
  return [numerator / divisor, denominator / divisor];
}

function fromRatio(numerator, denominator) {
  if (!denominator) throw new Error('分母必须大于零。');
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  const divisor = greatestCommonDivisor(numerator, denominator);
  numerator /= divisor; denominator /= divisor;
  if ((numerator * 1000000n) % denominator === 0n && numerator * 1000000n / denominator <= BigInt(Number.MAX_SAFE_INTEGER) && numerator * 1000000n / denominator >= BigInt(Number.MIN_SAFE_INTEGER))
    return Number(numerator * 1000000n / denominator) / 1000000;
  const value = `${numerator}/${denominator}`;
  if (value.length > 4096) throw new Error('数量分数超出计算范围。');
  return value;
}

export function exactQuantity(row, key = 'quantity') {
  return row?.[`${key}_fraction`] || row?.[key] || 0;
}

export function exactNumber(value) {
  const [numerator, denominator] = exactRatio(value);
  return Number(numerator) / Number(denominator);
}

export function quantityFields(value, key = 'quantity') {
  const [numerator, denominator] = exactRatio(value);
  const numeric = Number(numerator) / Number(denominator);
  if (!Number.isFinite(numeric)) throw new Error('数量超出计算范围。');
  return { [key]: numeric, [`${key}_fraction`]: typeof value === 'string' && value.includes('/') ? value.replace(/\s/g, '') : '' };
}

export function exactAdd(left, right) {
  const [leftNumerator, leftDenominator] = exactRatio(left), [rightNumerator, rightDenominator] = exactRatio(right);
  return fromRatio(leftNumerator * rightDenominator + rightNumerator * leftDenominator, leftDenominator * rightDenominator);
}
export function exactSubtract(left, right) {
  return exactAdd(left, exactMultiply(right, -1));
}
export function exactMultiply(left, right) {
  const [leftNumerator, leftDenominator] = exactRatio(left), [rightNumerator, rightDenominator] = exactRatio(right);
  return fromRatio(leftNumerator * rightNumerator, leftDenominator * rightDenominator);
}
export function exactDivide(left, right) {
  const [leftNumerator, leftDenominator] = exactRatio(left), [rightNumerator, rightDenominator] = exactRatio(right);
  return fromRatio(leftNumerator * rightDenominator, leftDenominator * rightNumerator);
}
export function exactCompare(left, right) {
  const [leftNumerator, leftDenominator] = exactRatio(left), [rightNumerator, rightDenominator] = exactRatio(right);
  const difference = leftNumerator * rightDenominator - rightNumerator * leftDenominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
export const exactMin = (left, right) => exactCompare(left, right) <= 0 ? left : right;
export const exactMax = (left, right) => exactCompare(left, right) >= 0 ? left : right;
export const exactSum = (rows, key = 'quantity') => rows.reduce((total, row) => exactAdd(total, exactQuantity(row, key)), 0);

export function exactCeil(value, decimals = 4) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) throw new Error('数量精度无效。');
  const [numerator, denominator] = exactRatio(value), scale = 10n ** BigInt(decimals);
  const scaled = numerator * scale;
  return Number(scaled / denominator + (scaled > 0n && scaled % denominator ? 1n : 0n)) / Number(scale);
}

export function validExactQuantity(value, positive = false) {
  try { return exactCompare(value, 0) >= (positive ? 1 : 0) && exactCompare(value, MAX_QUANTITY) <= 0; }
  catch { return false; }
}

export function parseExactQuantity(value, positive = false) {
  if (typeof value !== 'string' || !value.includes('/')) return parseQuantity(value, positive);
  return parseQuantityFraction(value, positive);
}

export function exactBomQuantity(quantity, output, base, fraction = '', lossRate = 0, lossMethod = 'internal') {
  const net = exactDivide(exactMultiply(fraction || quantity, output), base);
  return lossMethod === 'external' ? exactMultiply(net, exactDivide(exactAdd(100, lossRate), 100)) : exactDivide(net, exactDivide(exactSubtract(100, lossRate), 100));
}

export function formatExactQuantity(value, locale) {
  if (typeof value === 'string' && value.includes('/')) return value;
  return Number(value ?? 0).toLocaleString(locale, { maximumFractionDigits: 6 });
}

export function quantityInput(value) {
  if (validQuantity(value)) return String(value);
  if (typeof value === 'string') {
    if (!value.includes('/')) return value;
    try { return parseQuantityFraction(value); } catch { /* Try an equivalent input ratio. */ }
  }
  const [numerator, denominator] = exactRatio(value);
  // Move factors of 2 and 5 into a decimal numerator when a calculated
  // fraction can be expressed under the input limits (1/15000 -> 0.0002/3).
  const divisor = greatestCommonDivisor(denominator, 10000n);
  const inputDenominator = denominator / divisor, scaled = numerator * (10000n / divisor);
  if (scaled >= 0n && scaled <= BigInt(MAX_QUANTITY) * 10000n && inputDenominator <= 9999n) {
    const digits = (scaled % 10000n).toString().padStart(4, '0').replace(/0+$/, '');
    return `${scaled / 10000n}${digits ? `.${digits}` : ''}/${inputDenominator}`;
  }
  const rounded = exactCeil(value, 4);
  if (validQuantity(rounded)) return String(rounded);
  return `${numerator}/${denominator}`;
}

export function parseProductionQuantity(value, positive = false) {
  if (typeof value !== 'number' && !(typeof value === 'string' && value.includes('/')))
    throw new Error('登记数量需为数值或分数字符串。');
  return parseExactQuantity(value, positive);
}
