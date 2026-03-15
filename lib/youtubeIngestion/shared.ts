export function dedupeByKey<T>(items: T[], keyFn: (x: T) => string): T[] {
  const map = new Map<string, T>();

  for (const item of items) {
    map.set(keyFn(item), item);
  }

  return Array.from(map.values());
}

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}