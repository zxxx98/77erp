import test from 'node:test';
import assert from 'node:assert/strict';
import { exactAdd, exactSubtract, exactMultiply, exactDivide, exactCompare, exactCeil, exactQuantity, quantityFields, parseExactQuantity, quantityInput } from '../shared/exact-quantity.js';

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
  assert.equal(parseExactQuantity(' 001.2300 / 0040 ', true), '1.23/40');
  assert.equal(parseExactQuantity('0.0001/9999', true), '0.0001/9999');
  assert.equal(parseExactQuantity('0.0000/3'), '0/3');
  assert.equal(exactMultiply(parseExactQuantity('0.0001/9999'), 99990000), 1);
  assert.equal(exactMultiply(parseExactQuantity('1.2345/3'), 3), 1.2345);
  assert.equal(exactAdd('1.2/7', '0.2/7'), 0.2);
  assert.equal(exactCompare('1.2/7', '6/35'), 0);
  assert.equal(parseExactQuantity('99999999/1'), '99999999/1');
  for (const value of ['1/0', '-1/3', '1.23456/3', '1/2.5', '1/10000', '1/100000000', '100000000/1', '99999999.0001/1', '0.00001', 'NaN', '1e2/3', '.5/3'])
    assert.throws(() => parseExactQuantity(value));
  assert.throws(() => parseExactQuantity('0/3', true));
  assert.throws(() => parseExactQuantity('0.0000/3', true));
});

test('calculated fractions fill inputs with equivalent decimal numerators where possible', () => {
  for (const [value, expected] of [['1/15000', '0.0002/3'], ['29999/30000', '2.9999/3'], ['1.5/7', '1.5/7'], [0.000001, '0.0001/100']]) {
    assert.equal(quantityInput(value), expected);
    assert.equal(exactCompare(parseExactQuantity(quantityInput(value)), value), 0);
  }
  assert.equal(quantityInput('1/99999999'), '1/99999999');
});
