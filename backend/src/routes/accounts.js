import { promisify } from 'node:util';
import { randomBytes, randomUUID, scrypt } from 'node:crypto';
import { createUser } from '../account-store.js';
import { sendJson } from '../http.js';

const scryptAsync = promisify(scrypt);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 16_384) reject(Object.assign(new Error('TOO_LARGE'), { status: 413 }));
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(Object.assign(new Error('INVALID_JSON'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function validate({ email, password, passwordConfirmation }) {
  if (typeof email !== 'string' || !emailPattern.test(email.trim()) || email.trim().length > 254) {
    return 'Ange en giltig e-postadress.';
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return 'Lösenordet måste vara mellan 8 och 128 tecken.';
  }
  if (!/[A-Za-zÅÄÖåäö]/.test(password) || !/\d/.test(password)) {
    return 'Lösenordet måste innehålla både bokstav och siffra.';
  }
  if (password !== passwordConfirmation) return 'Lösenorden matchar inte.';
  return '';
}

async function passwordHash(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function register(request, response) {
  const data = await readJson(request);
  const problem = validate(data);
  if (problem) return sendJson(response, 400, { error: 'VALIDATION_ERROR', message: problem });

  const email = data.email.trim().toLowerCase();
  const user = createUser({
    id: randomUUID(),
    email,
    passwordHash: await passwordHash(data.password),
    createdAt: new Date().toISOString(),
  });

  if (!user) return sendJson(response, 409, { error: 'EMAIL_EXISTS', message: 'Det finns redan ett konto med den e-postadressen.' });
  sendJson(response, 201, { message: 'Kontot är skapat.', user });
}

export function accounts(request, response) {
  const pathname = (request.url || '/').split('?')[0];
  if (request.method === 'POST' && pathname === '/api/accounts/register') {
    register(request, response).catch(error => {
      if (!response.headersSent) {
        const status = error.status || 500;
        sendJson(response, status, {
          error: status === 500 ? 'INTERNAL_ERROR' : error.message,
          message: status === 500 ? 'Ett serverfel inträffade.' : 'Begäran kunde inte läsas.',
        });
      }
    });
    return;
  }
  sendJson(response, 404, { error: 'NOT_FOUND', message: 'Konto-endpointen finns inte.' });
}
