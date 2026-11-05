const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rules = require('../frontend/js/offer-rules.js');
const sql = fs.readFileSync(path.join(__dirname, '../backend/supabase/migrations/202610290001_price_offers.sql'), 'utf8');

test('50 percent floor is rounded upwards for odd prices', () => {
  assert.equal(rules.minOffer(700), 350);
  assert.equal(rules.minOffer(701), 351);
  assert.equal(rules.minOffer(999), 500);
});
test('only integer amounts below the asking price and at least half are accepted', () => {
  assert.equal(rules.isValidOffer(350, 700), true);
  assert.equal(rules.isValidOffer(349, 700), false);
  assert.equal(rules.isValidOffer(700, 700), false);
  assert.equal(rules.isValidOffer(350.50, 700), false);
  assert.equal(rules.isValidOffer(NaN, 700), false);
});
test('accepted and pending offers occupy slots; closed offers do not', () => {
  for (const status of ['pending_seller','countered','accepted_awaiting_payment'])
    assert.equal(rules.isActive(status), true);
  for (const status of ['declined','expired','payment_expired','purchased','cancelled'])
    assert.equal(rules.isActive(status), false);
});
test('24-hour deadline is inclusive when the deadline has passed', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  assert.equal(rules.expired('2026-10-29T12:00:00Z', now), true);
  assert.equal(rules.expired('2026-10-29T12:00:01Z', now), false);
  assert.equal(rules.formatRemaining('2026-10-29T13:01:00Z', now), '1 tim 1 min kvar');
});
test('migration declares server-side limits and guarded RPCs', () => {
  assert.match(sql, />=5 then\s+raise exception 'Du har redan fem aktiva/);
  assert.match(sql, /p_price<pg_catalog\.ceil\(v_listing\.price\/2\)/);
  assert.match(sql, /offer_expires_at timestamptz not null default \(now\(\) \+ interval '24 hours'\)/);
  assert.match(sql, /payment_due_at=now\(\)\+interval '24 hours'/);
  assert.match(sql, /v_recent_misses>=5/);
  assert.match(sql, /now\(\)\+interval '7 days'/);
  assert.match(sql, /revoke all on public\.price_offers/);
  assert.match(sql, /for update/);
  assert.match(sql, /price_offer_is_reserved/);
  assert.match(sql, /demo_buy_accepted_offer/);
});
