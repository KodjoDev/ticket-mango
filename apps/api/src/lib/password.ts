import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });

// L'OWASP recommande N=2^17 ; 2^16 limite la mémoire à 64 Mo par hash pour tenir la charge.
const N = 2 ** 16;
const r = 8;
const p = 1;
const KEY_LENGTH = 64;
const MAXMEM = 128 * N * r * 2;

/** Format stocké : scrypt$N$r$p$sel(base64)$hash(base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: MAXMEM });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, rr, pp, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !n || !rr || !pp || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const params = { N: Number(n), r: Number(rr), p: Number(pp) };
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    ...params,
    maxmem: 128 * params.N * params.r * 2,
  });
  return timingSafeEqual(key, expected);
}

/** Hash factice pour que la connexion d'un compte inexistant prenne autant de temps. */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}
