// A global comparison expression: a left-most warehouse (always positive),
// followed by a list of signed warehouse terms, e.g. "A - (B + C)".
export function validateStockExpression(expression, warehouseIds) {
  if (expression === null || expression === undefined) return null;
  const { left, terms } = expression;
  const ids = new Set(warehouseIds);
  if (!Number.isSafeInteger(left) || !ids.has(left))
    throw new Error('对比表达式需要选择一个有效的起始仓库。');
  if (!Array.isArray(terms) || terms.length > 20)
    throw new Error('对比表达式最多支持 20 个仓库项。');
  const seen = new Set([left]);
  const normalized = terms.map(term => {
    const op = term?.op;
    const warehouseId = term?.warehouse_id;
    if (op !== '+' && op !== '-') throw new Error('对比表达式的运算符只能为加或减。');
    if (!Number.isSafeInteger(warehouseId) || !ids.has(warehouseId)) throw new Error('对比表达式包含不存在的仓库。');
    if (seen.has(warehouseId)) throw new Error('对比表达式中同一仓库不能重复。');
    seen.add(warehouseId);
    return { warehouse_id: warehouseId, op };
  });
  return { left, terms: normalized };
}

// Evaluate the expression against a map of warehouse_id -> stock.
export function evaluateStockExpression(expression, stockByWarehouse) {
  if (!expression || !Number.isSafeInteger(expression.left)) return null;
  let total = Number(stockByWarehouse[expression.left]) || 0;
  for (const term of expression.terms || []) {
    const value = Number(stockByWarehouse[term.warehouse_id]) || 0;
    total += term.op === '-' ? -value : value;
  }
  return total;
}

// Human-readable form, e.g. "主仓库 − (分仓A + 分仓B)".
export function describeStockExpression(expression, nameById) {
  if (!expression || !Number.isSafeInteger(expression.left)) return '';
  const name = id => nameById[id] ?? `仓库${id}`;
  let text = name(expression.left);
  for (const term of expression.terms || [])
    text += ` ${term.op === '-' ? '−' : '+'} ${name(term.warehouse_id)}`;
  return text;
}
