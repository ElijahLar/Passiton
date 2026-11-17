import { createHmac } from 'node:crypto';
import QRCode from 'qrcode';

const collectInterval = 2000;
const maxOrderAge = 5 * 60_000;
const initialHints = new Set(['outstandingTransaction', 'noClient']);

export function createVerification({ bankId, now = Date.now }) {
  async function view(order, includeAppLink = false) {
    if (!order || now() - order.startedAt >= maxOrderAge) return { status: 'idle' };
    if (order.starting || order.cancelling) return { status: 'busy' };
    if (order.status !== 'pending') return { status: order.status, hintCode: order.hintCode };

    const result = { status: 'pending', hintCode: order.hintCode, delayed: order.delayed };
    if (!order.hintCode || initialHints.has(order.hintCode)) {
      if (includeAppLink) result.autoStartToken = order.autoStartToken;
      const time = String(Math.max(0, Math.floor((now() - order.startedAt) / 1000)));
      const authCode = createHmac('sha256', order.qrStartSecret).update(time).digest('hex');
      result.qr = await QRCode.toDataURL(
        ['bankid', order.qrStartToken, time, authCode].join('.'),
        { errorCorrectionLevel: 'L', margin: 4, width: 256 }
      );
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
      return view(order, true);
    } catch (error) {
      session.order = null;
      throw error;
    }
  }

  async function collect(session, order) {
    try {
      const response = await bankId('collect', { orderRef: order.orderRef });
      if (session.order !== order) return;
      if (response.status === 'complete' && response.completionData?.user?.personalNumber) {
        session.verifiedAt = new Date(now()).toISOString();
        session.order = { status: 'complete', startedAt: order.startedAt };
      } else if (response.status === 'failed') {
        session.order = { status: 'failed', hintCode: response.hintCode, startedAt: order.startedAt };
      } else if (response.status === 'pending') {
        order.hintCode = response.hintCode;
        order.delayed = false;
      } else {
        order.delayed = true;
      }
    } catch (error) {
      if (session.order !== order) return;
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
