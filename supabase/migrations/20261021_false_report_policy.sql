-- Authority-reviewed false-report actions, citizen appeals, and account enforcement.
-- Run after the initial schema and reward-wallet migrations.

create table if not exists public.false_report_cases (
  report_id uuid primary key references public.reports(id) on delete cascade,
  citizen_user_id uuid references auth.users(id) on delete set null,
  reporter_email text not null,
  case_number integer not null check (case_number > 0),
  action text not null check (action in ('WARNING', 'POINT_DEDUCTION', 'ACCOUNT_BLOCK', 'OVERTURNED', 'PENALTY_REVIEW', 'PENALTY_NOTICE')),
  reason text not null check (char_length(reason) between 10 and 500),
  evidence_summary text not null check (char_length(evidence_summary) between 10 and 1000),
  points_deducted integer not null default 0 check (points_deducted >= 0),
  penalty_amount numeric(10,2),
  penalty_status text not null default 'NOT_APPLICABLE',
  penalty_policy_reference text,
  decided_by_user_id uuid references auth.users(id) on delete set null,
  decided_by_name text not null,
  decided_at timestamptz not null default now(),
  appeal_status text not null default 'NOT_FILED' check (appeal_status in ('NOT_FILED', 'PENDING', 'ACCEPTED', 'REJECTED')),
  appeal_message text,
  appealed_at timestamptz,
  appeal_review_note text,
  appeal_reviewed_by_user_id uuid references auth.users(id) on delete set null,
  appeal_reviewed_by_name text,
  appeal_reviewed_at timestamptz,
  warning_email_status text not null default 'NOT_APPLICABLE',
  warning_email_attempted_at timestamptz,
  warning_email_provider_id text,
  warning_email_error text,
  created_at timestamptz not null default now()
);

alter table public.false_report_cases drop constraint if exists false_report_cases_action_check;
alter table public.false_report_cases add constraint false_report_cases_action_check check (action in ('WARNING', 'POINT_DEDUCTION', 'ACCOUNT_BLOCK', 'OVERTURNED', 'PENALTY_REVIEW', 'PENALTY_NOTICE'));
alter table public.false_report_cases add column if not exists warning_email_status text not null default 'NOT_APPLICABLE';
alter table public.false_report_cases add column if not exists warning_email_attempted_at timestamptz;
alter table public.false_report_cases add column if not exists warning_email_provider_id text;
alter table public.false_report_cases add column if not exists warning_email_error text;
alter table public.false_report_cases add column if not exists action_email_status text not null default 'NOT_APPLICABLE';
alter table public.false_report_cases add column if not exists action_email_attempted_at timestamptz;
alter table public.false_report_cases add column if not exists action_email_provider_id text;
alter table public.false_report_cases add column if not exists action_email_error text;

create index if not exists false_report_cases_citizen_user_idx on public.false_report_cases(citizen_user_id, case_number desc);
create index if not exists false_report_cases_email_idx on public.false_report_cases(lower(reporter_email), case_number desc);
alter table public.false_report_cases enable row level security;
revoke all on public.false_report_cases from anon, authenticated;

-- A report may have a resolution reward and a separate, auditable point action.
alter table public.reward_transactions drop constraint if exists unique_report_reward;
alter table public.reward_transactions drop constraint if exists reward_transactions_points_awarded_check;
alter table public.reward_transactions drop constraint if exists reward_transactions_points_awarded_nonzero;
alter table public.reward_transactions add constraint reward_transactions_points_awarded_nonzero check (points_awarded <> 0);
alter table public.reward_transactions drop constraint if exists unique_report_reward_type;
alter table public.reward_transactions add constraint unique_report_reward_type unique (report_id, transaction_type);

create or replace function public.confirm_false_report(
  p_report_id uuid,
  p_reason text,
  p_evidence_summary text,
  p_authority_user_id uuid,
  p_authority_name text,
  p_point_deduction integer
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_report public.reports%rowtype;
  v_user_id uuid;
  v_email text;
  v_identity text;
  v_case_number integer;
  v_action text;
  v_points_deducted integer := 0;
  v_wallet_balance integer;
  v_case public.false_report_cases%rowtype;
begin
  if char_length(trim(coalesce(p_reason, ''))) < 10 or char_length(trim(coalesce(p_reason, ''))) > 500 then
    raise exception 'Provide a reason between 10 and 500 characters.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_evidence_summary, ''))) < 10 or char_length(trim(coalesce(p_evidence_summary, ''))) > 1000 then
    raise exception 'Provide an evidence summary between 10 and 1000 characters.' using errcode = '22023';
  end if;

  select * into v_report from public.reports where id = p_report_id for update;
  if not found then raise exception 'Report not found.' using errcode = 'P0002'; end if;
  if v_report.status = 'RESOLVED' then
    raise exception 'Resolved reports must be reviewed and reopened before a false-report decision.' using errcode = '22023';
  end if;
  if exists (select 1 from public.false_report_cases where report_id = p_report_id) then
    raise exception 'A false-report decision already exists for this report.' using errcode = '23505';
  end if;

  v_email := lower(trim(v_report.reporter_email));
  v_user_id := v_report.user_id;
  -- Only a citizen account linked on the report at authenticated submission
  -- time is eligible for repeat sanctions. Email similarity is not identity.
  v_identity := coalesce(v_user_id::text, p_report_id::text);
  perform pg_advisory_xact_lock(hashtextextended(v_identity, 0));

  -- Reports without an authenticated account link are isolated case records:
  -- they do not accumulate repeat sanctions, wallet deductions, or blocks.
  if v_user_id is null then
    v_case_number := 1;
  else
    select count(*) + 1 into v_case_number
    from public.false_report_cases where citizen_user_id = v_user_id and appeal_status <> 'ACCEPTED';
  end if;

  if v_case_number <= 2 then
    v_action := 'WARNING';
  elsif v_case_number <= 5 then
    v_action := 'POINT_DEDUCTION';
  else
    v_action := 'ACCOUNT_BLOCK';
  end if;

  if v_case_number between 3 and 5 and v_user_id is not null then
    select points_balance into v_wallet_balance from public.citizen_wallets where user_id = v_user_id for update;
    if found then
      v_points_deducted := least(greatest(coalesce(v_wallet_balance, 0), 0), greatest(coalesce(p_point_deduction, 0), 0));
      update public.citizen_wallets set points_balance = points_balance - v_points_deducted where user_id = v_user_id;
    end if;
    if v_points_deducted > 0 then
      insert into public.reward_transactions(user_id, report_id, points_awarded, issue_severity, reason, transaction_type)
      values (v_user_id, p_report_id, -v_points_deducted, coalesce(v_report.severity, v_report.priority, 'LOW'), 'Point deduction after confirmed false report number ' || v_case_number::text || ': ' || v_report.reference_no, 'FALSE_REPORT_DEDUCTION');
    end if;
  end if;

  insert into public.false_report_cases (
    report_id, citizen_user_id, reporter_email, case_number, action, reason, evidence_summary,
    points_deducted, penalty_amount, penalty_status, penalty_policy_reference,
    decided_by_user_id, decided_by_name, warning_email_status
  ) values (
    p_report_id, v_user_id, v_email, v_case_number, v_action, trim(p_reason), trim(p_evidence_summary),
    v_points_deducted,
    null, 'NOT_APPLICABLE', null,
    p_authority_user_id, left(trim(coalesce(p_authority_name, 'Municipal Authority')), 100),
    case when v_action = 'WARNING' then 'PENDING' else 'NOT_APPLICABLE' end
  ) returning * into v_case;

  if v_action = 'ACCOUNT_BLOCK' and v_user_id is not null then
    update auth.users
      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('account_blocked', true, 'account_blocked_at', now())
      where id = v_user_id;
  end if;

  update public.reports set status = 'REJECTED', updated_at = now() where id = p_report_id;

  return to_jsonb(v_case);
end;
$$;

create or replace function public.review_false_report_appeal(
  p_report_id uuid,
  p_accept boolean,
  p_review_note text,
  p_authority_user_id uuid,
  p_authority_name text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_case public.false_report_cases%rowtype;
begin
  select * into v_case from public.false_report_cases where report_id = p_report_id for update;
  if not found then raise exception 'No false-report decision exists for this report.' using errcode = 'P0002'; end if;
  if v_case.appeal_status <> 'PENDING' then raise exception 'There is no pending appeal for this report.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_review_note, ''))) < 5 or char_length(trim(coalesce(p_review_note, ''))) > 500 then
    raise exception 'Provide a review note between 5 and 500 characters.' using errcode = '22023';
  end if;

  if p_accept then
    update public.false_report_cases set
      appeal_status = 'ACCEPTED',
      appeal_review_note = trim(p_review_note),
      appeal_reviewed_by_user_id = p_authority_user_id,
      appeal_reviewed_by_name = left(trim(coalesce(p_authority_name, 'Municipal Authority')), 100),
      appeal_reviewed_at = now(),
      action = 'OVERTURNED',
      penalty_status = case when action in ('PENALTY_NOTICE', 'PENALTY_REVIEW') then 'CANCELLED_ON_APPEAL' else penalty_status end
    where report_id = p_report_id returning * into v_case;

    if v_case.points_deducted > 0 and v_case.citizen_user_id is not null then
      update public.citizen_wallets set points_balance = points_balance + v_case.points_deducted where user_id = v_case.citizen_user_id;
      insert into public.reward_transactions(user_id, report_id, points_awarded, issue_severity, reason, transaction_type)
      values (v_case.citizen_user_id, p_report_id, v_case.points_deducted, 'LOW', 'Point deduction reversed after appeal: ' || p_report_id::text, 'FALSE_REPORT_REVERSAL');
    end if;
    if v_case.citizen_user_id is not null then
      update auth.users
        set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
          'account_blocked', (select count(*) > 5 from public.false_report_cases where citizen_user_id = v_case.citizen_user_id and appeal_status <> 'ACCEPTED'),
          'account_blocked_at', case when (select count(*) > 5 from public.false_report_cases where citizen_user_id = v_case.citizen_user_id and appeal_status <> 'ACCEPTED') then now() else null end
        )
        where id = v_case.citizen_user_id;
    end if;
    update public.reports set status = 'UNDER_REVIEW', updated_at = now() where id = p_report_id;
  else
    update public.false_report_cases set
      appeal_status = 'REJECTED',
      appeal_review_note = trim(p_review_note),
      appeal_reviewed_by_user_id = p_authority_user_id,
      appeal_reviewed_by_name = left(trim(coalesce(p_authority_name, 'Municipal Authority')), 100),
      appeal_reviewed_at = now()
    where report_id = p_report_id returning * into v_case;
  end if;

  return to_jsonb(v_case);
end;
$$;

revoke all on function public.confirm_false_report(uuid, text, text, uuid, text, integer) from public;
revoke all on function public.review_false_report_appeal(uuid, boolean, text, uuid, text) from public;
grant execute on function public.confirm_false_report(uuid, text, text, uuid, text, integer) to service_role;
grant execute on function public.review_false_report_appeal(uuid, boolean, text, uuid, text) to service_role;
