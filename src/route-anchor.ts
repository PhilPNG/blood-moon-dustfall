/** Decode a copied URL's in-page anchor before looking up a DOM target. */
export function routeAnchor(hash: string): string {
  const value = hash.startsWith("#") ? hash.slice(1) : hash;
  try { return decodeURIComponent(value); } catch { return value; }
}
