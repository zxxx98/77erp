// Customer IDs are stable; names are resolved on read so renaming a customer
// also updates every material detail without rewriting its archive.
export function validateCustomerPartNumbers(value, contacts, existing = []) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('每种物料最多配置 100 条客户料号。');
  const seen = new Set();
  return value.map(row => {
    if (!row || !Number.isSafeInteger(row.customer_id) || row.customer_id < 1 ||
        typeof row.part_number !== 'string' || !row.part_number.trim() || row.part_number.length > 100)
      throw new Error('请选择客户并填写 1–100 字的客户料号。');
    const customer = contacts.get(row.customer_id);
    const part_number = row.part_number.trim();
    if (!customer || customer.role !== 'customer') throw new Error('客户料号关联的客户不存在或类型无效。');
    if (!customer.active && !existing.some(old => old.customer_id === row.customer_id && old.part_number === part_number))
      throw new Error('不能为已停用的客户新增或修改客户料号。');
    const key = JSON.stringify([row.customer_id, part_number]);
    if (seen.has(key)) throw new Error('同一客户的料号不能重复。');
    seen.add(key);
    return { customer_id: row.customer_id, part_number };
  });
}

export function customerPartNumbersValue(db, body, existing = {}) {
  const previous = JSON.parse(existing.customer_part_numbers || '[]');
  if (body.customer_part_numbers === undefined) return existing.customer_part_numbers || '[]';
  const contacts = new Map(db.prepare('SELECT id,name,role,active FROM contacts').all().map(c => [c.id, c]));
  return JSON.stringify(validateCustomerPartNumbers(body.customer_part_numbers, contacts, previous));
}

export function withCustomerPartNumbers(db, products) {
  const names = new Map(db.prepare("SELECT id,name FROM contacts WHERE role='customer'").all().map(c => [c.id, c.name]));
  return products.map(product => ({ ...product, customer_part_numbers: JSON.parse(product.customer_part_numbers || '[]')
    .map(row => ({ ...row, customer_name: names.get(row.customer_id) || '客户已删除' })) }));
}
