-- Limit new report categories to the current garbage and drainage focus.
-- NOT VALID preserves historical rows from earlier categories while checking
-- all new inserts and updates.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_category_scope_check'
      and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_category_scope_check
      check (category in ('GARBAGE', 'DRAINAGE')) not valid;
  end if;
end $$;
