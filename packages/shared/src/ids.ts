import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Short, prefixed, URL-safe ids such as `rs_7KQ2M9XA`. */
export function newId(prefix: "rs" | "org" | "usr" | "tok", length = 12): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}
