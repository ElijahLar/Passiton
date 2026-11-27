-- Run once after 202611120002. Existing payments remain legacy tests.
begin;
alter table public.paypal_sandbox_payments
  add column flow_version integer not null default 1 check (flow_version in (1, 2)),
  add column partner_merchant_id text,
  add column platform_fee_amount numeric(10,2) not null default 0.00,
  add column disbursement_mode text not null default 'INSTANT',
  add column release_status text not null default 'not_requested'
    check (release_status in ('not_requested', 'requested', 'accepted')),
  add column release_requested_at timestamptz,
  add column release_item_id text unique,
  add constraint paypal_sandbox_flow_terms check (
    (flow_version = 1 and platform_fee_amount = 0.00 and disbursement_mode = 'INSTANT') or
    (flow_version = 2 and platform_fee_amount = 1.00 and disbursement_mode = 'DELAYED' and partner_merchant_id is not null)
  );
comment on column public.paypal_sandbox_payments.release_status is
  'requested is a durable single-attempt claim, possibly uncertain; accepted is NOT proof of payout completion. Reconcile in PayPal sandbox.';
commit;
