import { translateText } from './i18n/index.js';
export const CURRENCY_LABELS = { get USD() { return translateText('美元'); }, get CNY() { return translateText('人民币'); } };
export const CURRENCY_SYMBOLS = { USD: "$", CNY: "¥" };
export const CURRENCIES = ["USD", "CNY"];

const defaults = { base: "USD", display: "USD", rate: 7.2, updatedAt: "" };
let current = { ...defaults };

export function setCurrencySettings(settings) {
  current = {
    base: CURRENCIES.includes(settings?.base_currency) ? settings.base_currency : "USD",
    display: CURRENCIES.includes(settings?.display_currency) ? settings.display_currency : "USD",
    rate: Number(settings?.usd_cny_rate) > 0 ? Number(settings.usd_cny_rate) : defaults.rate,
    updatedAt: settings?.rate_updated_at || "",
  };
  return current;
}

export const currencySettings = () => current;
export const baseCurrency = () => current.base;
export const displayCurrency = () => current.display;
export const usdCnyRate = () => current.rate;
export const isReferenceCurrency = () => current.display !== current.base;

export const currencySymbol = (code = current.display) => CURRENCY_SYMBOLS[code] || "$";
export const baseCurrencySymbol = () => currencySymbol(current.base);

export function convertFromBase(amount, code = current.display) {
  const value = Number(amount) || 0;
  if (code === current.base) return value;
  if (current.base === "USD" && code === "CNY") return value * current.rate;
  if (current.base === "CNY" && code === "USD") return value / current.rate;
  return value;
}

export const displayAmount = (amount) => convertFromBase(amount, current.display);
