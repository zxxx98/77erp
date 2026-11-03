import { validUnitPrice, toPriceE4 } from './money.js';
import { quantityUnits, QUANTITY_SCALE } from './quantity.js';

export const PAYROLL_CURRENCIES = ['CNY', 'USD', 'VND', 'HKD', 'TWD', 'EUR', 'GBP', 'JPY', 'KRW', 'SGD', 'THB', 'MYR', 'AUD', 'CAD'];

export function validateOperationPrice(node) {
  if (node.unit_price != null && !validUnitPrice(node.unit_price)) throw new Error('工序单价需为非负数，最多 4 位小数且不超过 99999999。');
  if (node.currency != null && !PAYROLL_CURRENCIES.includes(node.currency) || node.unit_price != null && !PAYROLL_CURRENCIES.includes(node.currency))
    throw new Error('请选择有效的工资币种。');
}

// Round each report once, to two decimal places, using integer arithmetic.
// An absent price is unknown, whereas an explicit zero is a configured free operation.
export function operationWageCents(node, report) {
  validateOperationPrice(node);
  if (node.unit_price == null) return null;
  const numerator = BigInt(toPriceE4(node.unit_price)) * BigInt(quantityUnits(report.quantity)) * BigInt(quantityUnits(report.multiplier ?? 1));
  const denominator = 100n * BigInt(QUANTITY_SCALE) ** 2n;
  const cents = (numerator + denominator / 2n) / denominator;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('工资金额超出安全计算范围，请缩小统计范围或核对单价和倍率。');
  return Number(cents);
}
