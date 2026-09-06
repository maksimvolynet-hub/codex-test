-- Worker-facing payroll endpoint: hourly pay only, no coefficients or percentages.
create or replace function public.worker_hourly_summary(p_from date,p_to date)
returns table(worked_minutes bigint,hourly_pay numeric)
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(sum(a.worked_minutes),0)::bigint,
         round((p.rate_8h/480.0)*coalesce(sum(a.worked_minutes),0),2)
  from public.profiles p
  left join public.attendance_days a
    on a.worker_id=p.id
   and a.work_date between p_from and p_to
   and a.report_submitted_at is not null
  where p.id=auth.uid()
  group by p.rate_8h;
$$;
grant execute on function public.worker_hourly_summary(date,date) to authenticated;
