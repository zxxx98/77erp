import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageDisplayStandardQuantity, stageStandardQuantity } from '../shared/production-stages.js';

test('layer standards preserve fractional precision and recalculate cumulative output once', () => {
  const item = { quantity: 0.3334, quantity_fraction: '1/3', bom_base_quantity: 1, loss_rate: 0, loss_method: 'internal', unit_round_up: 0 };
  assert.equal(stageDisplayStandardQuantity(item, 1), 0.333334);
  assert.equal(stageStandardQuantity(item, 1), 0.3334);
  assert.equal(stageDisplayStandardQuantity(item, 3), 1);
  assert.equal(stageDisplayStandardQuantity(item, 0), 0);
  assert.equal(stageDisplayStandardQuantity({ ...item, unit_round_up: 1 }, 1), 1);
});
