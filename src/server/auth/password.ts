// Password hashing (ADR 0002): Node's scrypt, with the parameters recorded in the hash string so they
// can be raised later. No "server-only" or "@/" imports: scripts/seed-admin.mts runs this file in plain Node.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** Cost parameters for new hashes: N=2^15, r=8, p=1, a 16-byte salt and a 64-byte key. */
export const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, saltBytes: 16, keyBytes: 64 } as const;

/**
 * scrypt needs about 128 * N * r bytes (32 MiB at N=2^15, r=8), which is exactly Node's default
 * maxmem limit, so it is raised. Hashes with larger stored parameters are capped at this limit too.
 */
export const SCRYPT_MAXMEM = 64 * 1024 * 1024;

// Upper bounds for parameters read back from a stored hash, so a corrupt row cannot exhaust memory.
const MAX_N = 2 ** 20;
const MAX_R = 32;
const MAX_P = 16;

function deriveKey(password: string, salt: Buffer, keyBytes: number, N: number, r: number, p: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, keyBytes, { N, r, p, maxmem: SCRYPT_MAXMEM }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Hashes a password as "scrypt$N$r$p$<salt base64>$<key base64>". */
export async function hashPassword(password: string): Promise<string> {
  const { N, r, p, saltBytes, keyBytes } = SCRYPT_PARAMS;
  const salt = randomBytes(saltBytes);
  const key = await deriveKey(password, salt, keyBytes, N, r, p);
  return ["scrypt", N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** True when the password matches the stored hash. A malformed hash never matches and never throws. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const isPowerOfTwo = Number.isInteger(N) && N > 1 && (N & (N - 1)) === 0;
  if (!isPowerOfTwo || N > MAX_N || !Number.isInteger(r) || r < 1 || r > MAX_R) return false;
  if (!Number.isInteger(p) || p < 1 || p > MAX_P) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (salt.length < 16 || expected.length < 32) return false;
  try {
    const actual = await deriveKey(password, salt, expected.length, N, r, p);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same scrypt work as a real check, for a sign-in with an unknown email, so the response
 * time does not reveal whether the email exists. Always resolves to false.
 */
export async function verifyDummyPassword(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await dummyHash);
  return false;
}
