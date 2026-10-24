const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function positiveId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('生产登记二维码的单据或仓库编号无效。');
  return Number(value);
}
function validatedOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('生产登记地址无效。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('生产登记地址必须是无账号密码的 HTTP(S) 网站地址。');
  return url.origin;
}
function identity(number, sourceId) {
  if (typeof number !== 'string' || !number.trim() || number.length > 200 || /[\u0000-\u001f]/.test(number)) throw new Error('生产登记二维码的单号无效。');
  if (typeof sourceId !== 'string' || !uuid.test(sourceId)) throw new Error('生产登记二维码的系统标识无效。');
}
export function productionRegistrationUrl({ origin, warehouseId, orderId, number, sourceId }) {
  origin = validatedOrigin(origin); warehouseId = positiveId(warehouseId); orderId = positiveId(orderId); identity(number, sourceId);
  return `${origin}/?warehouse_id=${warehouseId}#production?${new URLSearchParams({ register: orderId, warehouse: warehouseId, number, source: sourceId })}`;
}
export function parseProductionRegistrationUrl(value, { origin, sourceId } = {}) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('请扫描或粘贴完整的生产登记二维码链接。'); }
  validatedOrigin(url.origin);
  if (url.username || url.password || url.pathname !== '/' || !url.hash.startsWith('#production?')) throw new Error('这不是有效的生产登记二维码地址。');
  if (origin !== undefined && url.origin !== validatedOrigin(origin)) throw new Error('二维码的网站地址与当前地址不同，请打开对应网站后重试。');
  const params = new URLSearchParams(url.hash.slice('#production?'.length));
  for (const key of ['register', 'warehouse', 'number', 'source']) if (params.getAll(key).length !== 1) throw new Error('生产登记二维码字段缺失或重复。');
  if (url.searchParams.getAll('warehouse_id').length !== 1) throw new Error('生产登记二维码仓库编号无效。');
  const warehouseId = positiveId(params.get('warehouse')), orderId = positiveId(params.get('register'));
  if (positiveId(url.searchParams.get('warehouse_id')) !== warehouseId) throw new Error('生产登记二维码仓库编号不一致。');
  const number = params.get('number'), parsedSource = params.get('source'); identity(number, parsedSource);
  if (sourceId !== undefined && parsedSource.toLowerCase() !== String(sourceId).toLowerCase()) throw new Error('二维码来自其他系统或已恢复前的数据，请重新导出生产单。');
  return { warehouseId, orderId, number, sourceId: parsedSource };
}
