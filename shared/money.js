// Historical lines have no stored amount; preserve their original rounding.
export const orderLineAmount = item => item.amount_cents ?? Math.round(item.quantity * item.price * 100);
