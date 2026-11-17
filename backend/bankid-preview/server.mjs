import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BankIdError, createBankIdClient } from './client.mjs';
import { createVerification } from './verification.mjs';

const frontend = fileURLToPath(new URL('../../frontend', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon'
};
const cookieName = 'passiton_bankid_preview';
const sessionLifetime = 8 * 60 * 60_000;

function publishableKey(key) {
  if (/^sb_publishable_[\w-]+$/.test(key)) return true;
  try {
    return key.split('.').length === 3 &&
      JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon';
  } catch {
    return false;
  }
}

export function readStagingConfig(env) {
  const url = env.PASSITON_TEST_SUPABASE_URL;
  const key = env.PASSITON_TEST_SUPABASE_KEY;
  if (!url && !key) return null;
  const origin = new URL(url);
  const loopback = ['localhost', '127.0.0.1'].includes(origin.hostname);
  const hosted = /^[a-z0-9]+\.supabase\.co$/.test(origin.hostname) && origin.protocol === 'https:';
  if ((!hosted && !loopback) || !['http:', 'https:'].includes(origin.protocol) ||
    origin.origin !== url.replace(/\/$/, '') ||
    origin.hostname === 'wcitckdgzjncglwymeks.supabase.co' || !publishableKey(key ?? '')) {
    throw new Error('Use a separate Supabase test project and its publishable or anon key.');
  }
  return { url: origin.origin, publishableKey: key };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function createSessions(staging, fetchUser) {
  const sessions = new Map();
  return async (req, res) => {
    const now = Date.now();
    const cookie = req.headers.cookie?.match(/(?:^|; )passiton_bankid_preview=([a-f0-9]{64})(?:;|$)/)?.[1];
    let session = sessions.get(cookie);
    if (session?.expiresAt <= now) session = null;

    let userId = null;
    let tokenHash;
    let validatedUntil;
    if (staging) {
      const token = req.headers.authorization?.match(/^Bearer ([\w.-]+)$/)?.[1];
      if (!token) return null;
      tokenHash = createHash('sha256').update(token).digest('hex');
      if (session?.tokenHash === tokenHash && session.validatedUntil > now) {
        userId = session.userId;
        validatedUntil = session.validatedUntil;
      } else {
        userId = await fetchUser(token);
        if (!userId) return null;
        validatedUntil = now + 15_000;
      }
    }

    if (!session || session.userId !== userId) {
      for (const [id, entry] of sessions) {
        if (entry.expiresAt <= now) sessions.delete(id);
      }
      if (sessions.size >= 128) throw new Error('previewSessionLimit');
      const id = randomBytes(32).toString('hex');
      session = { userId, expiresAt: now + sessionLifetime };
      sessions.set(id, session);
      res.setHeader('Set-Cookie', cookieName + '=' + id + '; Path=/api/bankid/; HttpOnly; SameSite=Strict; Max-Age=28800');
    }
    session.tokenHash = tokenHash;
    session.validatedUntil = validatedUntil;
    return session;
  };
}

export function createPreviewServer({ bankId, staging = null, report, fetchUser = async (token) => {
  const response = await fetch(staging.url + '/auth/v1/user', {
    headers: { apikey: staging.publishableKey, Authorization: 'Bearer ' + token },
    redirect: 'error',
    signal: AbortSignal.timeout(5000)
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('testAuthUnavailable');
  return (await response.json()).id;
} }) {
  const verification = createVerification({ bankId, report });
  const getSession = createSessions(staging, fetchUser);
  const config = 'window.PASSITON_SUPABASE_CONFIG = ' + JSON.stringify(staging ?? {}) + ';\n' +
    'window.PASSITON_BANKID_PREVIEW = ' + JSON.stringify({ requiresAccount: Boolean(staging) }) + ';\n';
  const connectSources = [staging?.url, staging?.url?.replace(/^http/, 'ws')].filter(Boolean).join(' ');

  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'; " +
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: " + (staging?.url ?? '') + "; " +
      "connect-src 'self' " + connectSources + ';');

    const port = req.socket.localPort;
    const host = req.headers.host;
    if (host !== 'localhost:' + port && host !== '127.0.0.1:' + port) {
      json(res, 403, { error: 'previewHostRequired' });
      return;
    }
    const origin = 'http://' + host;

    try {
      const url = new URL(req.url, origin);
      if (url.origin !== origin) return json(res, 403, { error: 'invalidOrigin' });

      if (url.pathname.startsWith('/api/bankid/')) {
        const action = url.pathname.split('/').at(-1);
        if (req.method !== 'POST' || req.headers.origin !== origin) return json(res, 403, { error: 'invalidOrigin' });
        if (!['start', 'poll', 'cancel', 'status'].includes(action) || url.pathname !== '/api/bankid/' + action) {
          return json(res, 404, { error: 'unknownAction' });
        }
        const session = await getSession(req, res);
        if (!session) return json(res, 401, { error: 'signInRequired' });
        const result = session.verifiedAt ? { status: 'complete' } :
          await verification[action](session, req.socket.remoteAddress);
        return json(res, 200, { ...result, verifiedAt: session.verifiedAt });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'methodNotAllowed' });
      if (url.pathname === '/') {
        res.writeHead(302, { Location: '/frontend/' + url.search });
        return res.end();
      }
      if (url.pathname === '/frontend/js/supabase-config.js') {
        res.writeHead(200, { 'Content-Type': types['.js'] });
        return res.end(req.method === 'HEAD' ? undefined : config);
      }
      if (!url.pathname.startsWith('/frontend/')) return json(res, 404, { error: 'notFound' });

      const requested = decodeURIComponent(url.pathname.slice('/frontend/'.length)) || 'index.html';
      const path = resolve(frontend, requested);
      const mime = types[extname(path)];
      if (!path.startsWith(frontend + sep) || !mime) return json(res, 404, { error: 'notFound' });
      const file = await readFile(path);
      res.writeHead(200, { 'Content-Type': mime });
      res.end(req.method === 'HEAD' ? undefined : file);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') return json(res, 404, { error: 'notFound' });
      const code = error instanceof BankIdError ? error.code : 'previewUnavailable';
      console.warn('BankID preview request failed:', error.code ?? error.name);
      json(res, 502, { error: code });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    try {
      process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const port = Number(process.env.PASSITON_BANKID_PORT ?? 8787);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a preview port from 1024 to 65535.');
    const staging = readStagingConfig(process.env);
    const server = createPreviewServer({
      bankId: createBankIdClient(),
      staging,
      report: (message) => console.log('[BankID-test] ' + message)
    });
    server.on('error', (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      console.log('Passiton BankID test: http://127.0.0.1:' + port + '/frontend/#passiton=sell');
    });
  } catch (error) {
    console.error(error.code === 'ENOENT' ? 'Run npm run setup in backend/bankid-preview to download the BankID test certificates.' : error.message);
    process.exitCode = 1;
  }
}
