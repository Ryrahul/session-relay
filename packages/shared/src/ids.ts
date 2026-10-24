const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Short, prefixed, URL-safe ids such as `rs_7KQ2M9XA`. */
export function newId(prefix: "rs" | "org" | "usr" | "tok" | "cm", length = 12): string {
  // Web Crypto: available in Node 20+, Cloudflare Workers and browsers.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}
