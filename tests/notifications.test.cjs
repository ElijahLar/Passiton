const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const file = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('NS-01 signup offers four opt-in categories and a synchronized select-all', () => {
  const html = file('frontend/index.html');
  for (const key of ['offers', 'purchases', 'verification', 'cases']) {
    assert.match(html, new RegExp('data-ns-pref="' + key + '" data-ns-scope="signup"'));
    assert.match(html, new RegExp('data-ns-pref="' + key + '" data-ns-scope="settings"'));
  }
  assert.match(html, /data-ns-all="signup"/);
  assert.match(html, /data-ns-all="settings"/);
  assert.doesNotMatch(html, /data-ns-(?:pref|all)="[^"]+"[^>]+checked(?:\s|>)/);
});
test('NS-01 signup persists choices with Auth user metadata', () => {
  const app = file('frontend/js/app.js');
  const migration = file('backend/supabase/migrations/202611160001_notifications.sql');
  assert.match(app, /passiton_email_preferences:window\.passitonNotifications\?\.signupPreferences/);
  assert.match(migration, /new\.raw_user_meta_data -> 'passiton_email_preferences'/);
  assert.match(migration, /insert into public\.notification_preferences/);
});
test('NS-01 protects notification writes and enforces owner read policies', () => {
  const sql = file('backend/supabase/migrations/202611160001_notifications.sql');
  assert.match(sql, /revoke all on public\.notifications from public, anon, authenticated/);
  assert.match(sql, /grant update \(is_read, read_at\)/);
  assert.match(sql, /notifications_select_own/);
  assert.match(sql, /notification_preferences_select_own/);
  assert.match(sql, /constraint notifications_deduplicate unique\(user_id,event_key\)/);
  assert.match(sql, /private\.notification_email_outbox/);
});
test('NS-01 never sends a real payment confirmation from a demo order', () => {
  const sql = file('backend/supabase/migrations/202611160001_notifications.sql');
  assert.match(sql, /Ingen riktig betalning har genomförts/);
  assert.match(sql, /Inga pengar har betalats ut/);
  assert.doesNotMatch(sql, /'utbetalning_genomförd'/);
});
test('NS-01 is mounted in existing site and dashboard', () => {
  const html = file('frontend/index.html');
  const hub = file('frontend/js/dashboard-hub.js');
  assert.match(html, /js\/notifications\.js/);
  assert.match(html, /css\/notifications\.css/);
  assert.match(html, /id="ns-dropdown"/);
  assert.match(html, /id="hub-notifications"/);
  assert.match(hub, /notifications: document\.getElementById\('hub-notifications'\)/);
});
