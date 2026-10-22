export const qualityDateFormats = [
  'YYYY-MM-DD', 'YYYY-M-D', 'YYYY/MM/DD', 'YYYY/M/D', 'YYYY.MM.DD', 'YYYY.M.D',
  'YYYY年MM月DD日', 'YYYY年M月D日', 'YYYYMMDD', 'DD/MM/YYYY', 'D/M/YYYY',
  'MM/DD/YYYY', 'M/D/YYYY', 'DD-MM-YYYY', 'MM-DD-YYYY',
];
export const qualityDateTimeFormats = [
  'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm',
  ...qualityDateFormats.slice(1).flatMap(format => [`${format} HH:mm:ss`, `${format} HH:mm`]),
];
export const defaultBooleanValues = { trueValues: '是\ntrue\n1\nyes', falseValues: '否\nfalse\n0\nno' };
export const booleanValuesOf = config => ({
  trueValues: config.trueValues ?? defaultBooleanValues.trueValues,
  falseValues: config.falseValues ?? defaultBooleanValues.falseValues,
});
export function booleanRules(config) {
  const values = booleanValuesOf(config), tokens = {};
  for (const key of ['trueValues','falseValues']) {
    if (typeof values[key] !== 'string' || values[key].length > 2000) throw new Error('布尔值映射最多 2000 个字符。');
    tokens[key] = values[key].split(/\r?\n/).map(text => text.trim()).filter(Boolean);
    if (!tokens[key].length || tokens[key].length > 20 || tokens[key].some(text => text.length > 100)) throw new Error('真值和假值各须配置 1～20 项，每项最多 100 个字符。');
    const normalized = tokens[key].map(text => text.toLowerCase());
    if (new Set(normalized).size !== normalized.length) throw new Error('同一组布尔值映射不能重复（不区分英文大小写）。');
  }
  if (tokens.trueValues.some(text => tokens.falseValues.some(other => other.toLowerCase() === text.toLowerCase()))) throw new Error('真值和假值映射不能重叠。');
  return tokens;
}
export function parseQualityBoolean(raw, config, cell) {
  const tokens = booleanRules(config);
  if (typeof cell?.value === 'boolean') return cell.value;
  const text = raw.trim().toLowerCase();
  if (tokens.trueValues.some(token => token.toLowerCase() === text)) return true;
  if (tokens.falseValues.some(token => token.toLowerCase() === text)) return false;
  throw new Error('文字未匹配真值或假值，请检查布尔值映射。');
}
// Dates and Excel timestamps are calendar values; never apply a browser timezone.
export function parseQualityDate(raw, config, cell) {
  const datetime = config.type === 'datetime';
  if (datetime && cell?.datetime) return cell.datetime;
  if (!datetime && cell?.date) return cell.date;
  const format = config.dateFormat || (datetime ? qualityDateTimeFormats[0] : qualityDateFormats[0]);
  const formats = datetime ? qualityDateTimeFormats : qualityDateFormats;
  if (!formats.includes(format)) throw new Error('日期格式无效。');
  const tokens = [], patterns = { YYYY: '\\d{4}', MM: '\\d{2}', DD: '\\d{2}', M: '\\d{1,2}', D: '\\d{1,2}', HH: '\\d{2}', mm: '\\d{2}', ss: '\\d{2}' };
  const pattern = format.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/YYYY|MM|DD|HH|mm|ss|M|D/g, token => {
    tokens.push(token); return `(${patterns[token]})`;
  });
  const match = new RegExp(`^${pattern}$`).exec(raw);
  const fail = () => { throw new Error(datetime ? '日期时间格式无效，请按指定格式填写有效日期和时间。' : '日期格式无效。'); };
  if (!match) return fail();
  const parts = Object.fromEntries(tokens.map((token,index) => [token,match[index+1]]));
  const pad = value => String(value).padStart(2,'0');
  const date = `${parts.YYYY}-${pad(parts.MM || parts.M)}-${pad(parts.DD || parts.D)}`;
  const time = `${parts.HH || '00'}:${parts.mm || '00'}:${parts.ss || '00'}`;
  const value = `${date}T${time}`, parsed = new Date(`${value}Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,19) !== value) return fail();
  return datetime ? value : date;
}
export function formatQualityDate(value, format) {
  const [date,time='00:00:00'] = value.split('T'), [year,month,day] = date.split('-'), [hour,minute,second] = time.split(':');
  const parts = { YYYY:year, MM:month, M:String(Number(month)), DD:day, D:String(Number(day)), HH:hour, mm:minute, ss:second };
  return format.replace(/YYYY|MM|DD|HH|mm|ss|M|D/g, token => parts[token]);
}
function shiftDecimal(value, places) {
  const [digits,exponent='0'] = String(value).split('e');
  return Number(`${digits}e${Number(exponent)+places}`);
}
export const percentRatio = value => shiftDecimal(value,-2);
export function parseQualityPercent(raw, config, cell) {
  // Native percentage cells keep the unrounded cached numeric value.
  const format = (cell?.format || '').replace(/"[^"]*"|\\./g,'');
  let value;
  if (typeof cell?.value === 'number' && format.includes('%')) value = shiftDecimal(cell.value,2);
  else {
    const text = raw.trim().replace(/[%％]$/u,'').trim();
    if (!/^[+-]?(?:\d+|\d{1,3}(?:[,，]\d{3})+)(?:\.\d+)?$/.test(text)) throw new Error('百分比格式无效，请填写单一数值，例如 95 或 95%。');
    value = Number(text.replace(/[,，]/g,''));
  }
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error('数值超出支持范围。');
  return value;
}
