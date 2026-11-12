-- Additive sandbox storage only. Does not modify listings, demo orders or existing RPCs.
begin;

create table public.paypal_sandbox_payments (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  environment text not null default 'sandbox' check (environment = 'sandbox'),
  amount numeric(10,2) not null default 10.00 check (amount = 10.00),
  currency text not null default 'SEK' check (currency = 'SEK'),
  status text not null default 'creating'
    check (status in ('creating', 'created', 'pending', 'completed', 'failed')),
  paypal_order_id text unique,
  paypal_capture_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (buyer_id, request_id)
);

alter table public.paypal_sandbox_payments enable row level security;
revoke all on public.paypal_sandbox_payments from anon, authenticated;
grant select on public.paypal_sandbox_payments to authenticated;
grant all on public.paypal_sandbox_payments to service_role;

create policy paypal_sandbox_read_own on public.paypal_sandbox_payments
  for select to authenticated using ((select auth.uid()) = buyer_id);

comment on table public.paypal_sandbox_payments is
  'Fixed 10 SEK sandbox tests. No voucher delivery, seller payouts or demo-order changes.';

commit;
