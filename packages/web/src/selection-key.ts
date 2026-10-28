/** JSON transport equality independent of object insertion order; arrays preserve player order. */
export function selectionKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(selectionKey).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter(key => object[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${selectionKey(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
