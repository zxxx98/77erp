import { t as translate, getFormatLocale } from '../i18n/index.js';
import {
  currencySymbol,
  baseCurrencySymbol,
  displayAmount,
} from '../currency.js';

const formats = new Map();
function numberFormat(digits) {
  const locale = getFormatLocale(), key = `${locale}:${digits}`;
  if (!formats.has(key)) formats.set(key, new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: digits }));
  return formats.get(key);
}
const money = (v) => numberFormat(2).format(displayAmount(v));
const moneyBase = (v) => numberFormat(2).format(Number(v) || 0);
const price = (v) => numberFormat(4).format(displayAmount(v));
const priceBase = (v) => numberFormat(4).format(Number(v) || 0);

const count = (v) => new Intl.NumberFormat(getFormatLocale(), { maximumFractionDigits: 4 }).format(v);

const shortDate = (v) =>
  new Date(v).toLocaleDateString(getFormatLocale(), { month: "2-digit", day: "2-digit" });

const dateTime = (v) =>
  new Date(v).toLocaleString(getFormatLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const todayKey = () => new Date().toLocaleDateString("en-CA");

const sameDay = (a, b) =>
  new Date(a).toDateString() === new Date(b).toDateString();

const stockStatus = (p) =>
  p.threshold <= 0 ? translate("system.no.warning") : p.stock === 0 ? translate("system.out.of.stock") : p.stock <= p.threshold ? translate("system.low.stock") : translate("system.sufficient.stock");

const stockTone = (p) =>
  p.threshold <= 0 ? "gray" : p.stock === 0 ? "red" : p.stock <= p.threshold ? "orange" : "green";

export {
  money,
  moneyBase,
  price,
  priceBase,
  currencySymbol,
  baseCurrencySymbol,
  count,
  shortDate,
  dateTime,
  todayKey,
  sameDay,
  stockStatus,
  stockTone,
};
