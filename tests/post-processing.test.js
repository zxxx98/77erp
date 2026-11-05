import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postProcessingLimit, productionOutputCompleted } from '../shared/post-processing.js';

test('post-processing releases whole groups during production and one remainder after output completion', () => {
  for (const [actual, expected] of [[0, 0], [19, 0], [20, 1], [39, 1], [100, 5], [101, 5], [110, 6]]) {
    const order = { planned_quantity: 110, completed_quantity: actual, status: 'in_progress', output_completion_confirmed: false };
    assert.equal(postProcessingLimit(actual, 20, productionOutputCompleted(order)), expected, String(actual));
  }
  assert.equal(postProcessingLimit(0, 20, true), 0);
  assert.equal(postProcessingLimit(39, 20, true), 2);
  assert.equal(productionOutputCompleted({ status: 'void', planned_quantity: 110, completed_quantity: 110, output_completion_confirmed: true }), false);
});

test('post-processing keeps decimal and fractional output boundaries exact', () => {
  assert.equal(postProcessingLimit(0.3, 0.1, false), 3);
  assert.equal(postProcessingLimit('299999999/1000000000', 0.1, false), 2);
  assert.equal(postProcessingLimit('1/3', 0.1, true), 4);
  const order = { status: 'in_progress', planned_quantity: 1, completed_quantity: 1, completed_quantity_fraction: '99999999/100000000' };
  assert.equal(productionOutputCompleted(order), false);
  assert.equal(productionOutputCompleted({ ...order, output_completion_confirmed: true }), true);
});
