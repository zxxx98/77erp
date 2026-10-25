// Pure display projection shared by browser validators and the HTTP API.
// Call only for known system errors, never for names, notes, template cells or user messages.
export function createValidationTranslator(messages, nestedParams = {}) {
  const exact = new Map(Object.entries(messages).map(([code, values]) => [values[0], code]));
  const escape = value => [...value].map(character => '\\^$.*+?()[]{}|'.includes(character) ? '\\' + character : character).join('');
  const patterns = Object.entries(messages).filter(([, values]) => /\{p\d+\}/.test(values[0])).map(([code, values]) => ({
    code, fields: [...values[0].matchAll(/\{(p\d+)\}/g)].map(match => match[1]),
    pattern: new RegExp('^' + values[0].split(/\{p\d+\}/).map(escape).join('(.*?)') + '$', 's'),
    weight: values[0].replace(/\{p\d+\}/g, '').length,
  })).sort((a, b) => b.weight - a.weight);
  function info(value) {
    if (typeof value !== 'string') return null;
    if (exact.has(value)) return { code: exact.get(value), params: {} };
    const separator = value.indexOf('：');
    if (separator > 0 && separator < value.length - 1) {
      const detail = value.slice(separator + 1);
      if (info(detail)) return { code: 'CONTEXT_VALIDATION_FAILED', params: { context: value.slice(0, separator), detail } };
    }
    for (const { code, fields, pattern } of patterns) {
      const match = pattern.exec(value);
      if (match) return { code, params: Object.fromEntries(fields.map((field, index) => [field, match[index + 1]])) };
    }
    return null;
  }
  function translate(value, language = 'zh-CN') {
    const match = info(value);
    if (!match) return value;
    if (match.code === 'CONTEXT_VALIDATION_FAILED') return `${match.params.context}${language === 'zh-CN' ? '：' : ': '}${translate(match.params.detail, language)}`;
    const index = language === 'en' ? 1 : language === 'vi' ? 2 : 0;
    return messages[match.code][index].replace(/\{(p\d+)\}/g, (placeholder, name) => {
      if (!Object.hasOwn(match.params, name)) return placeholder;
      const value = match.params[name];
      return nestedParams[match.code]?.includes(name) ? translate(value, language) : value;
    });
  }
  return { validationErrorInfo: info, translateValidationError: translate };
}
