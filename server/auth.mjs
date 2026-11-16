import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);
const scryptOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const dummySalt = randomBytes(16);
const dummyKey = randomBytes(64);
const roles = new Set(['student', 'teacher', 'admin']);
const attemptWindow = 15 * 60 * 1000;
const accountLimit = 5;
const sourceLimit = 25;
const sessionMaxAge = 8 * 60 * 60;

export class AuthError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function normalizeRut(value) {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{1,8}|\d{1,3}(?:\.\d{3}){1,2})-?([\dk])$/i.exec(value.trim());
  if (!parts) return null;

  const number = Number(parts[1].replaceAll('.', ''));
  if (number < 1 || number > 99999999) return null;

  let sum = 0;
  let factor = 2;
  for (let digits = number; digits > 0; digits = Math.floor(digits / 10)) {
    sum += (digits % 10) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const remainder = (11 - sum % 11) % 11;
  const verifier = remainder === 10 ? 'K' : String(remainder);
  return verifier === parts[2].toUpperCase() ? `${number}-${verifier}` : null;
}

function normalizeIdentifier(role, identifier) {
  if (role === 'student') return normalizeRut(identifier);
  if (!roles.has(role) || typeof identifier !== 'string') return null;

  const email = identifier.trim().toLowerCase();
  if (email.length > 254) return null;
  const [local, domain, extra] = email.split('@');
  if (extra !== undefined || !domain || local.length > 64) return null;
  if (!/^[a-z0-9_%+'-]+(?:\.[a-z0-9_%+'-]+)*$/.test(local)) return null;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return null;
  if (role === 'teacher' && domain !== 'gmail.com') return null;
  return email;
}

function publicUser({ id, identifier, role, name }) {
  return { id, identifier, role, name };
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, dummyKey.length, scryptOptions);
  return `scrypt-v1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

function acceptablePasswordInput(password) {
  return typeof password === 'string' && password.length > 0 && Buffer.byteLength(password) <= 512;
}

async function verifyPassword(password, hash) {
  const parts = /^scrypt-v1\$([\w-]{22})\$([\w-]{86})$/.exec(hash ?? '');
  const salt = parts ? Buffer.from(parts[1], 'base64url') : dummySalt;
  const expected = parts ? Buffer.from(parts[2], 'base64url') : dummyKey;
  const key = await deriveKey(password, salt, expected.length, scryptOptions);
  return timingSafeEqual(key, expected) && parts !== null;
}

function sessionDigest(token) {
  return typeof token === 'string' && /^[\w-]{43}$/.test(token) ? digest(token) : null;
}

function retryTime(attempts, key, limit) {
  const matching = attempts.filter(attempt => attempt.key === key);
  return matching.length < limit ? 0 : matching[matching.length - limit].at + attemptWindow;
}

export function createAuthService(repository, { now = Date.now } = {}) {
  async function createUser({ role, identifier, name, password }) {
    if (!roles.has(role)) throw new AuthError(400, 'INVALID_ROLE', 'Selecciona un rol válido.');
    const normalized = normalizeIdentifier(role, identifier);
    if (!normalized) {
      const label = { student: 'RUT', teacher: 'correo @gmail.com', admin: 'correo electrónico' }[role];
      throw new AuthError(400, 'INVALID_IDENTIFIER', `Ingresa un ${label} válido.`);
    }
    const displayName = typeof name === 'string' ? name.trim() : '';
    if (!displayName || displayName.length > 100 || /\p{Cc}/u.test(displayName)) {
      throw new AuthError(400, 'INVALID_NAME', 'Ingresa un nombre de hasta 100 caracteres.');
    }
    if (!acceptablePasswordInput(password) || [...password].length < 12 || !password.trim()) {
      throw new AuthError(400, 'INVALID_PASSWORD', 'Usa una contraseña de al menos 12 caracteres y hasta 512 bytes.');
    }

    const user = {
      id: randomUUID(),
      role,
      identifier: normalized,
      name: displayName,
      passwordHash: await hashPassword(password)
    };
    return repository.update(state => {
      if (state.users.some(existing => existing.role === role && existing.identifier === normalized)) {
        throw new AuthError(409, 'DUPLICATE_ACCOUNT', 'Ya existe una cuenta con ese identificador y rol.');
      }
      state.users.push(user);
      return publicUser(user);
    });
  }

  async function login({ role, identifier, password }, source) {
    const normalized = normalizeIdentifier(role, identifier);
    const sourceKey = digest(`source:${source}`);
    const accountKey = normalized ? digest(`account:${role}:${normalized}`) : null;
    const validPassword = acceptablePasswordInput(password);

    const result = await repository.update(async state => {
      const currentTime = now();
      state.loginAttempts = state.loginAttempts.filter(item => item.at + attemptWindow > currentTime);
      state.sessions = state.sessions.filter(session => session.expiresAt > currentTime);
      const lockedUntil = Math.max(
        retryTime(state.loginAttempts, accountKey, accountLimit),
        retryTime(state.loginAttempts, sourceKey, sourceLimit)
      );
      if (lockedUntil > currentTime) {
        const retryAfter = Math.ceil((lockedUntil - currentTime) / 1000);
        return { error: new AuthError(429, 'LOGIN_LIMIT', 'Demasiados intentos. Intenta de nuevo más tarde.', retryAfter) };
      }

      const user = normalized && state.users.find(item => item.role === role && item.identifier === normalized);
      if (!(await verifyPassword(validPassword ? password : '', user?.passwordHash)) || !validPassword || !user) {
        const failedAt = now();
        state.loginAttempts.push({ key: sourceKey, at: failedAt });
        if (accountKey) state.loginAttempts.push({ key: accountKey, at: failedAt });
        return { error: new AuthError(401, 'BAD_CREDENTIALS', 'Identificador o contraseña incorrectos.') };
      }

      state.loginAttempts = state.loginAttempts.filter(item => item.key !== accountKey);
      const token = randomBytes(32).toString('base64url');
      state.sessions.push({ tokenHash: digest(token), userId: user.id, expiresAt: now() + sessionMaxAge * 1000 });
      return { user: publicUser(user), token, maxAge: sessionMaxAge };
    });

    if (result.error) throw result.error;
    return result;
  }

  async function authenticate(token) {
    const tokenHash = sessionDigest(token);
    if (!tokenHash) return null;
    const state = await repository.read();
    const session = state.sessions.find(item => item.tokenHash === tokenHash && item.expiresAt > now());
    const user = session && state.users.find(item => item.id === session.userId);
    return user ? publicUser(user) : null;
  }

  async function logout(token) {
    const tokenHash = sessionDigest(token);
    if (!tokenHash) return;
    await repository.update(state => {
      const currentTime = now();
      state.sessions = state.sessions.filter(item => item.expiresAt > currentTime && item.tokenHash !== tokenHash);
    });
  }

  return { createUser, login, authenticate, logout };
}
