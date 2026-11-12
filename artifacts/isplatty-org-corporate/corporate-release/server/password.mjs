import { scrypt as scryptCallback, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const options = { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
export function strongPassword(password) {
  return typeof password === 'string' && password.length >= 16 && password.length <= 128 &&
    /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password) && !/(.)\1{5}/.test(password) &&
    !/password|isplatty/i.test(password);
}
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, options);
  return `scrypt-v1$65536$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [version, n, r, p, salt, hash] = String(encoded).split('$');
  if (version !== 'scrypt-v1' || n !== '65536' || r !== '8' || p !== '1' ||
      !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hash || '')) return false;
  const key = await scrypt(password, Buffer.from(salt, 'hex'), 64, options);
  return timingSafeEqual(key, Buffer.from(hash, 'hex'));
}
