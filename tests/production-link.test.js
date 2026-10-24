import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionRegistrationUrl, parseProductionRegistrationUrl } from '../shared/production-link.js';

const sourceId = '550e8400-e29b-41d4-a716-446655440000';
const values = { origin: 'https://erp.example:8443', warehouseId: 2, orderId: 19, number: '生产单 #19&中文', sourceId };
test('production registration URL round trips identity and warehouse', () => {
  const url = productionRegistrationUrl(values);
  assert.ok(url.startsWith('https://erp.example:8443/?warehouse_id=2#production?register=19&warehouse=2&number='));
  assert.deepEqual(parseProductionRegistrationUrl(url, values), { warehouseId: 2, orderId: 19, number: values.number, sourceId });
});
test('registration parser rejects foreign origins and instances', () => {
  const url = productionRegistrationUrl(values);
  assert.throws(() => parseProductionRegistrationUrl(url, { origin: 'https://other.example' }), /地址/);
  assert.throws(() => parseProductionRegistrationUrl(url, { sourceId: '550e8400-e29b-41d4-a716-446655440001' }), /系统/);
});
test('registration links reject invalid identities and ambiguous fields', () => {
  for (const changes of [{ orderId: 0 }, { orderId: '1e2' }, { warehouseId: -1 }, { sourceId: 'bad' }, { number: '' }, { origin: 'javascript:alert(1)' }, { origin: 'https://user:pass@erp.example' }, { origin: 'https://erp.example/path' }]) {
    assert.throws(() => productionRegistrationUrl({ ...values, ...changes }));
  }
  const url = productionRegistrationUrl(values);
  for (const value of [url + '&register=20', url.replace('warehouse=2', 'warehouse=3'), url.replace('register=19', 'register=1.5'), url.replace('#production?', '#other?'), '/?warehouse_id=2#production?register=19']) assert.throws(() => parseProductionRegistrationUrl(value));
});
