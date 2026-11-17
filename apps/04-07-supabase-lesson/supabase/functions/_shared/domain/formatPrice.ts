/** «6,50 €». Неизвестный код валюты не должен ронять ответ: Intl кидает RangeError — берём запасной формат. */
export function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency }).format(price);
  } catch {
    return `${price.toFixed(2)} ${currency}`;
  }
}
