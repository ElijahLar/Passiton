import { createHmac } from 'node:crypto';
import QRCode from 'qrcode';

const collectInterval = 2000;
const qrOrderLifetime = 30_000;
const maxOrderAge = 5 * 60_000;
const initialHints = new Set(['outstandingTransaction', 'noClient']);
const diagnosticCode = (value) => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(value)
  ? value : undefined;

export function createVerification({ bankId, now = Date.now, report = () => {} }) {
  function reportCollect(order, status, code) {
    const message = ['collect', status, diagnosticCode(code)].filter(Boolean).join(' ');
    if (message === order.lastDiagnostic) return;
    order.lastDiagnostic = message;
    const elapsed = Math.max(0, Math.floor((now() - order.startedAt) / 1000));
    report(message + ' (' + elapsed + 's)');
  }

  async function view(order, includeAppLink = false) {
    if (!order || now() - order.startedAt >= maxOrderAge) return { status: 'idle' };
    if (order.starting || order.cancelling) return { status: 'busy' };
    if (order.status !== 'pending') return { status: order.status, hintCode: order.hintCode };

    const result = { status: 'pending', hintCode: order.hintCode, delayed: order.delayed };
    if (!order.hintCode || initialHints.has(order.hintCode)) {
      const elapsed = now() - order.startedAt;
      if (elapsed < qrOrderLifetime) {
        const time = String(Math.max(0, Math.floor(elapsed / 1000)));
        const authCode = createHmac('sha256', order.qrStartSecret).update(time).digest('hex');
        const qr = await QRCode.toDataURL(
          ['bankid', order.qrStartToken, time, authCode].join('.'),
          { errorCorrectionLevel: 'L', margin: 4, width: 256 }
        );
        const remaining = qrOrderLifetime - (now() - order.startedAt);
        if (remaining > 0) {
          return { ...result, qr, qrValidForMs: remaining, autoStartToken: includeAppLink ? order.autoStartToken : undefined };
        }
      }
      result.qrExpired = true;
    }
    return result;
  }

  async function start(session, endUserIp) {
    const current = session.order;
    if (current?.status === 'pending' && now() - current.startedAt < maxOrderAge) return view(current, true);

    const order = { status: 'pending', starting: true, startedAt: now() };
    session.order = order;
    try {
      const auth = await bankId('auth', {
        endUserIp,
        userVisibleData: Buffer.from('Passiton – identifiering av säljare (test)').toString('base64')
      });
      for (const key of ['orderRef', 'autoStartToken', 'qrStartToken', 'qrStartSecret']) {
        if (typeof auth[key] !== 'string' || !auth[key]) throw new Error('invalidAuthResponse');
        order[key] = auth[key];
      }
      order.startedAt = now();
      order.nextCollectAt = order.startedAt + collectInterval;
      order.starting = false;
      report('auth orderCreated');
      return view(order, true);
    } catch (error) {
      session.order = null;
      report('auth error ' + (diagnosticCode(error.code) ?? 'invalidResponse'));
      throw error;
    }
  }

  async function collect(session, order) {
    try {
      const response = await bankId('collect', { orderRef: order.orderRef });
      if (session.order !== order) return;
      if (response.status === 'complete' && response.completionData?.user?.personalNumber) {
        reportCollect(order, 'complete');
        session.verifiedAt = new Date(now()).toISOString();
        session.order = { status: 'complete', startedAt: order.startedAt };
      } else if (response.status === 'failed') {
        reportCollect(order, 'failed', response.hintCode);
        session.order = { status: 'failed', hintCode: response.hintCode, startedAt: order.startedAt };
      } else if (response.status === 'pending') {
        reportCollect(order, 'pending', response.hintCode);
        order.hintCode = response.hintCode;
        order.delayed = false;
      } else {
        reportCollect(order, 'error', 'invalidResponse');
        order.delayed = true;
      }
    } catch (error) {
      if (session.order !== order) return;
      reportCollect(order, 'error', diagnosticCode(error.code) ?? 'unexpectedError');
      if (error.code === 'notFound') {
        session.order = { status: 'failed', hintCode: 'expiredTransaction', startedAt: order.startedAt };
      } else {
        order.delayed = true;
      }
    } finally {
      order.collecting = null;
    }
  }

  function poll(session) {
    const order = session.order;
    if (order?.status === 'pending' && !order.starting && !order.cancelling &&
        !order.collecting && now() >= order.nextCollectAt && now() - order.startedAt < maxOrderAge) {
      order.nextCollectAt = now() + collectInterval;
      // Keep the animated QR updating independently of the BankID API latency.
      order.collecting = collect(session, order);
    }
    return view(order, true);
  }

  async function cancel(session) {
    const order = session.order;
    if (!order || order.status !== 'pending' || now() - order.startedAt >= maxOrderAge) return view(order);
    if (order.starting || order.cancelling) return { status: 'busy' };
    order.cancelling = true;
    try {
      await order.collecting;
      if (session.order !== order) return view(session.order);
      await bankId('cancel', { orderRef: order.orderRef });
    } catch (error) {
      if (error.code !== 'notFound') throw error;
    } finally {
      order.cancelling = false;
    }
    session.order = null;
    return { status: 'idle' };
  }

  return { start, poll, cancel, status: (session) => view(session.order, true) };
}
