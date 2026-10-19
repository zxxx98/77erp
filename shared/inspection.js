export const inspectionUnits = { day: '天', month: '月', year: '年' };
export const inspectionToday = () => new Date().toISOString().slice(0, 10);

export function validInspectionDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function inspectionConfig(body, existing = {}) {
  const inspection_date = body.inspection_date === undefined ? (existing.inspection_date ?? '') : body.inspection_date;
  const inspection_interval = body.inspection_interval === undefined ? (existing.inspection_interval ?? 0) : body.inspection_interval;
  const inspection_unit = body.inspection_unit === undefined ? (existing.inspection_unit ?? 'month') : body.inspection_unit;
  if (inspection_date !== '' && !validInspectionDate(inspection_date)) throw new Error('请填写有效的校验日期。');
  if (!Number.isSafeInteger(inspection_interval) || inspection_interval < 0 || inspection_interval > 999 || !Object.hasOwn(inspectionUnits, inspection_unit))
    throw new Error('校验周期需为 1–999 的整数，可选择天、月或年；留空表示手动设置日期。');
  if (inspection_interval && !inspection_date) throw new Error('设置校验周期时，请同时填写校验日期。');
  return { inspection_date, inspection_interval, inspection_unit };
}

export function nextInspectionDate(from, interval, unit) {
  const date = new Date(`${from}T00:00:00.000Z`);
  if (unit === 'day') date.setUTCDate(date.getUTCDate() + interval);
  else {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + interval * (unit === 'year' ? 12 : 1));
    const end = new Date(date.getTime());
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(day, end.getUTCDate()));
  }
  const result = date.toISOString().slice(0, 10);
  if (!validInspectionDate(result)) throw new Error('下次校验日期超出支持范围，请调整周期。');
  return result;
}

export const inspectionCycleLabel = product => product.inspection_interval
  ? `每 ${product.inspection_interval} ${inspectionUnits[product.inspection_unit]}` : '手动设置日期';
