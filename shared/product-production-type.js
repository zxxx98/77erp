export const productionTypes = ['成品', '半成品', '原料'];

// Empty means unset; omitted fields preserve existing values for older clients.
export function productionTypeValue(value, existing = '') {
  if (value === undefined) value = existing;
  if (value === '' || productionTypes.includes(value)) return value;
  throw new Error('生产类型只能选择成品、半成品、原料，或留空。');
}
