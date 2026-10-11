-- Chat-only accounts allow Tawk conversations to be restored after a visitor
-- signs in again. Credentials are not shared with Hotspot prepaid accounts.
create table if not exists public.isp_hotspot_chat_accounts (
  id bigserial primary key,
  admin_id bigint not null references public.isp_admins(id) on delete cascade,
  username_key text not null check (username_key ~ '^[a-z0-9_.-]{3,32}$'),
  username text not null check (char_length(username) between 3 and 32),
  password_salt text not null,
  password_hash text not null,
  tawk_user_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  unique (admin_id, username_key),
  unique (tawk_user_id)
);

alter table public.isp_hotspot_chat_accounts enable row level security;
revoke all on public.isp_hotspot_chat_accounts from anon, authenticated;
grant all on public.isp_hotspot_chat_accounts to service_role;
