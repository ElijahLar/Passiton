import { sendJson } from './http.js';
import { accounts } from './routes/accounts.js';
import { listings } from './routes/listings.js';
import { orders } from './routes/orders.js';
import { verification } from './routes/verification.js';
import { payments } from './routes/payments.js';

const routes = { accounts, listings, orders, verification, payments };

export function app(request, response) {
  const pathname = (request.url || '/').split('?')[0];
  if (request.method === 'GET' && pathname === '/api/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }
  const match = /^\/api\/([^/]+)(?:\/|$)/.exec(pathname);
  if (match && Object.hasOwn(routes, match[1])) {
    routes[match[1]](request, response);
    return;
  }
  sendJson(response, 404, { error: 'NOT_FOUND' });
}
