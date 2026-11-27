create table public.paypal_sandbox_sellers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  partner_id text not null,
  merchant_id text not null,
  unique (partner_id, merchant_id),
  check (merchant_id <> partner_id)
);
alter table public.paypal_sandbox_sellers enable row level security;
revoke all on public.paypal_sandbox_sellers from public, anon, authenticated;
grant select, insert on public.paypal_sandbox_sellers to service_role;
