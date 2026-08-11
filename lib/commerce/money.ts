export type Money = Readonly<{ amount: number; currency: "usd" }>;

export function addMoney(values: readonly Money[]): Money {
  return { amount: values.reduce((sum, value) => sum + value.amount, 0), currency: "usd" };
}

export function multiplyMoney(value: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 25) throw new RangeError("Quantity must be an integer from 1 to 25.");
  return { amount: value.amount * quantity, currency: value.currency };
}

export function formatMoney(amount: number, currency = "usd", locale = "en-US") {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("Money amount must be a non-negative integer.");
  return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
}
