-- Urban Aid Report: run in the Supabase SQL editor or through the Supabase CLI.
create extension if not exists pgcrypto;
do $$ begin create type public.issue_category as enum ('GARBAGE','DRAINAGE'); exception when duplicate_object then null; end $$;
do $$ begin create type public.report_status as enum ('SUBMITTED','UNDER_REVIEW','ASSIGNED','IN_PROGRESS','RESOLVED','REJECTED'); exception when duplicate_object then null; end $$;
do $$ begin create type public.severity_level as enum ('LOW','MEDIUM','HIGH','CRITICAL'); exception when duplicate_object then null; end $$;
create table if not exists public.departments (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz not null default now());
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(), reference_no text not null unique, title text not null check (char_length(title) between 4 and 120), category public.issue_category not null, description text not null check (char_length(description) between 10 and 2000), location text not null, additional_info text,
  reporter_name text not null, reporter_email text not null, reporter_phone text, status public.report_status not null default 'SUBMITTED', priority public.severity_level, severity public.severity_level, severity_score numeric(5,2) check (severity_score is null or severity_score between 0 and 100), assigned_to text, department_id uuid references public.departments(id), image_path text, image_url text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.report_updates (id uuid primary key default gen_random_uuid(), report_id uuid not null references public.reports(id) on delete cascade, message text not null check (char_length(message) between 1 and 500), status public.report_status, created_by text not null default 'Authority', created_at timestamptz not null default now());
create table if not exists public.attachments (id uuid primary key default gen_random_uuid(), report_id uuid not null references public.reports(id) on delete cascade, storage_path text not null, public_url text, mime_type text not null, created_at timestamptz not null default now());
create index if not exists reports_created_at_idx on public.reports(created_at desc);
create index if not exists reports_status_idx on public.reports(status);
create index if not exists reports_category_idx on public.reports(category);
create index if not exists report_updates_report_id_idx on public.report_updates(report_id, created_at desc);
create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists reports_set_updated_at on public.reports;
create trigger reports_set_updated_at before update on public.reports for each row execute function public.set_updated_at();
-- The server uses a Supabase service-role key. Do not expose that key in browser code.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('report-images', 'report-images', true, 5242880, array['image/jpeg','image/png','image/webp']) on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
