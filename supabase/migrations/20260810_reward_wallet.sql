-- Urban Aid Report: Citizen Reward Wallet & Points System
-- Run in the Supabase SQL editor or CLI

-- 1. Citizen Wallets Table
create table if not exists public.citizen_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  points_balance integer not null default 0 check (points_balance >= 0),
  total_points_earned integer not null default 0 check (total_points_earned >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Reward Transactions Table
create table if not exists public.reward_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_id uuid not null references public.reports(id) on delete cascade,
  points_awarded integer not null check (points_awarded > 0),
  issue_severity public.severity_level not null default 'LOW',
  reason text not null,
  transaction_type text not null default 'ISSUE_RESOLVED',
  created_at timestamptz not null default now(),
  constraint unique_report_reward unique (report_id)
);

-- Indexes for fast queries
create index if not exists reward_transactions_user_id_idx on public.reward_transactions(user_id, created_at desc);
create index if not exists reward_transactions_report_id_idx on public.reward_transactions(report_id);

-- 3. Add reward metadata columns to reports table if not already present
alter table public.reports add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.reports add column if not exists reward_points integer default null;
alter table public.reports add column if not exists rewarded_at timestamptz default null;

-- 4. Automatically keep wallet updated_at current
create or replace function public.set_wallet_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists citizen_wallets_set_updated_at on public.citizen_wallets;
create trigger citizen_wallets_set_updated_at before update on public.citizen_wallets for each row execute function public.set_wallet_updated_at();
