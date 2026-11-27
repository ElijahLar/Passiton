-- Run after 202611120001. Existing test rows are retained but cannot be reused for platform payments.
begin;
alter table public.paypal_sandbox_payments add column seller_merchant_id text;
commit;
