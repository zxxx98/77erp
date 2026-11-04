import test from 'node:test';
import assert from 'node:assert/strict';
import { exactAdd, exactSubtract, exactMultiply, exactDivide, exactCompare, exactCeil, exactQuantity, quantityFields, parseExactQuantity } from '../shared/exact-quantity.js';

test('fraction batches and partial consumption conserve exact quantities', () => {
  assert.equal(exactAdd(exactAdd('1/3', '1/3'), '1/3'), 1);
  assert.equal(exactSubtract(1, '1/3'), '2/3');
  assert.equal(exactSubtract('2/3', '2/3'), 0);
  assert.equal(exactMultiply('1/3', 3), 1);
  assert.equal(exactDivide('1/3', 2), '1/6');
  assert.equal(exactCompare('1/3', '333333/1000000'), 1);
  assert.equal(exactCeil(exactAdd('1/3', '1/3')), 0.6667);
  assert.equal(exactCeil('1/3', 0), 1);
  assert.equal(exactQuantity(quantityFields('2/6')), '2/6');
});

test('registration validates fraction syntax, bounds and zero without decimal approximation', () => {
  assert.equal(parseExactQuantity(' 1 / 3 ', true), '1/3');
  assert.equal(parseExactQuantity('0/3'), '0/3');
  assert.equal(parseExactQuantity('0.025'), 0.025);
  for (const value of ['1/0', '-1/3', '1.2/3', '1/100000000', '100000000/1', '0.00001', 'NaN'])
    assert.throws(() => parseExactQuantity(value));
  assert.throws(() => parseExactQuantity('0/3', true));
});
