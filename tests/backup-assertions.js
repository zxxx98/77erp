import assert from 'node:assert/strict';

// Restore preserves business data while issuing fresh product editing versions.
export function assertRestoredBusiness(actual, expected) {
  const data = structuredClone(actual);
  for (const product of data.products) {
    const original = expected.products.find(p => p.id === product.id);
    assert.ok(original);
    assert.ok(Number.isSafeInteger(product.version) && product.version > 0);
    assert.notEqual(product.version, original.version);
    product.version = original.version;
  }
  assert.deepEqual(data, expected);
}
