import { translateValidationError } from '../../shared/error-translations.js';
import { getLocale, translateText } from './index.js';

// Project only known system errors. User names/notes and dynamic parameters are retained.
export const localizeError = message => translateValidationError(translateText(message), getLocale());
