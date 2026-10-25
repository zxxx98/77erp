import { translateValidationError } from '../../shared/error-translations.js';
import catalog from './catalogs/production.js';
import { getLocale, t } from './index.js';

const systemMessages = new Map(Object.entries(catalog).flatMap(([key, values]) => values.map(value => [value, key])));

// Use only for system-generated notices, validation messages and parse issues.
// Extracted material names, field labels and other user parameters remain verbatim.
export function productionMessage(message) {
  const key = systemMessages.get(message);
  return key ? t(key) : translateValidationError(message, getLocale());
}
