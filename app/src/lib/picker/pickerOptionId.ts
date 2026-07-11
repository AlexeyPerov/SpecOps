/** Stable option id helper for searchable picker listboxes. */
export function pickerOptionId(prefix: string, index: number): string {
  return `${prefix}-${index}`;
}
