// A Sheet binds to one material. Repeated object keys can identify it only when
// every nonempty key value agrees; never choose the first object record.
export function sheetUniqueKey(definition, parsed) {
  const field = definition.fields.find(field => field.type === 'uniqueKey' || field.properties?.some(property => property.type === 'uniqueKey'));
  if (!field) return { keyValue: '', keyStatus: 'missing_key' };
  const property = field.type === 'object' ? field.properties.find(property => property.type === 'uniqueKey') : field;
  if (parsed.issues.some(issue => issue.fieldId === field.id && (!issue.propertyId || issue.propertyId === property.id)))
    return { keyValue: '', keyStatus: 'invalid_key' };
  const result = parsed.results.find(result => result.id === field.id);
  const values = field.type === 'object' ? (result?.rows || []).map(row => row.cells.find(cell => cell.id === property.id)?.value) : [result?.value];
  const keys = [...new Set(values.filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))];
  if (!keys.length) return { keyValue: '', keyStatus: 'empty_key' };
  if (keys.length > 1) return { keyValue: '', keyStatus: 'multiple_keys' };
  return { keyValue: keys[0], keyStatus: 'ready' };
}

export function acceptanceSheetResults(definition, result) {
  return result.sheets || [{ sheetName: definition.sheetName, ...result }];
}
