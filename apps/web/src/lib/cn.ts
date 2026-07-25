/** Concaténation de classes conditionnelles, sans dépendance. */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
