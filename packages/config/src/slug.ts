/** Convert a name/title into a kebab-case slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Ensure uniqueness by appending a short random suffix when needed. */
export function slugWithSuffix(base: string): string {
  const suffix = Math.random().toString(36).slice(2, 6);
  const stem = base.slice(0, 80 - suffix.length - 1);
  return `${stem}-${suffix}`;
}
