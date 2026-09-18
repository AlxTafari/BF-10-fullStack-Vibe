export function pickRandom<T>(items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  const index = Math.floor(Math.random() * items.length);
  return items[index];
}
