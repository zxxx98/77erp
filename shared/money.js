export const MONEY_DECIMALS = 2;
export const PRICE_DECIMALS = 4;
export const MONEY_SCALE = 100;
export const PRICE_SCALE = 10000;
export const MAX_MONEY = 99999999;
export const MAX_PRICE_E4 = MAX_MONEY * PRICE_SCALE;

const finite = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= MAX_MONEY;
const precision = (n, scale) => Math.abs(n * scale - Math.round(n * scale)) < 0.00001;

export const validAmount = (n) => finite(n) && precision(n, MONEY_SCALE);
export const validUnitPrice = (n) => finite(n) && precision(n, PRICE_SCALE);
export const toCents = (n) => Math.round(n * MONEY_SCALE);
export const toPriceE4 = (n) => Math.round(n * PRICE_SCALE);
export const fromPriceE4 = (n) => n / PRICE_SCALE;

// Historical lines have no stored amount; preserve their original rounding.
export const orderLineAmount = (item) => item.amount_cents ?? Math.round(item.quantity * item.price * MONEY_SCALE);
