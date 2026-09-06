-- FERRUM v5: кадровые данные, мягкое удаление рабочих, авансы, ФОТ,
-- обязательные коэффициенты при проверке отчёта.

alter table public.profiles add column if not exists employment_start_date date;
alter table public.profiles add column if not exists official_employment boolean not null default false;
alter table public.profiles add column if not exists official_start_date date;
alter table public.profiles add column if not exists deactivated_at timestamptz;
alter table public.profiles add column if not exists deactivated_by uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists deactivation_reason text;

create table if not exists public.payroll_advances (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.profiles(id) on delete restrict,
  paid_at date not null default public.company_today(),
  amount numeric(12,2) not null check(amount > 0),
  comment text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists payroll_advances_worker_date_idx
  on public.payroll_advances(worker_id, paid_at desc);

alter table public.payroll_advances enable row level security;

drop policy if exists payroll_advances_manager_read on public.payroll_advances;
create policy payroll_advances_manager_read on public.payroll_advances
  for select to authenticated using(public.is_manager());

drop policy if exists payroll_advances_manager_insert on public.payroll_advances;
create policy payroll_advances_manager_insert on public.payroll_advances
  for insert to authenticated with check(public.is_manager() and created_by=auth.uid());

drop policy if exists payroll_advances_manager_update on public.payroll_advances;
create policy payroll_advances_manager_update on public.payroll_advances
  for update to authenticated using(public.is_manager()) with check(public.is_manager());

drop policy if exists payroll_advances_manager_delete on public.payroll_advances;
create policy payroll_advances_manager_delete on public.payroll_advances
  for delete to authenticated using(public.is_manager());

create or replace function public.ferrum_validate_report_review()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.safety_percent is null then
    raise exception 'Не установлен коэффициент ТБ';
  end if;
  if new.productivity_percent is null then
    raise exception 'Не установлен коэффициент выработки';
  end if;
  if new.safety_percent < 0 or new.safety_percent > 22 then
    raise exception 'Коэффициент ТБ должен быть от 0 до 22';
  end if;
  if new.productivity_percent < 0 or new.productivity_percent > 18 then
    raise exception 'Коэффициент выработки должен быть от 0 до 18';
  end if;
  if new.safety_percent < 22 and nullif(trim(coalesce(new.safety_reason,'')),'') is null then
    raise exception 'Укажите причину снижения ТБ';
  end if;
  if coalesce(new.penalty_amount,0) > 0 and nullif(trim(coalesce(new.penalty_reason,'')),'') is null then
    raise exception 'Укажите причину штрафа';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ferrum_validate_report_review on public.report_reviews;
create trigger trg_ferrum_validate_report_review
before insert or update on public.report_reviews
for each row execute function public.ferrum_validate_report_review();

create or replace function public.get_manager_payroll_summary_v5(p_from date,p_to date)
returns table(
  worker_id uuid,
  full_name text,
  active boolean,
  worked_minutes bigint,
  reviewed_shifts bigint,
  avg_safety_percent numeric,
  avg_productivity_percent numeric,
  penalties numeric,
  calculated_pay numeric,
  advances numeric,
  balance_to_pay numeric
)
language sql
stable
security definer
set search_path=public
as $$
with reviewed_days as (
  select
    p.id as worker_id,
    p.full_name,
    p.active,
    coalesce(p.rate_8h,0)::numeric as rate_8h,
    a.work_date,
    coalesce(a.worked_minutes,0)::numeric as worked_minutes,
    rr.safety_percent::numeric as safety_percent,
    rr.productivity_percent::numeric as productivity_percent,
    coalesce(rr.penalty_amount,0)::numeric as penalty_amount,
    (rr.report_id is not null and rr.safety_percent is not null and rr.productivity_percent is not null) as is_reviewed
  from public.profiles p
  left join public.attendance_days a
    on a.worker_id=p.id
   and a.work_date between p_from and p_to
   and a.report_submitted_at is not null
  left join public.daily_reports dr
    on dr.worker_id=p.id
   and dr.report_date=a.work_date
   and dr.status='reviewed'
  left join public.report_reviews rr
    on rr.report_id=dr.id
  where p.role='worker'
), agg as (
  select
    worker_id,
    max(full_name) as full_name,
    bool_or(active) as active,
    coalesce(sum(case when is_reviewed then worked_minutes else 0 end),0)::bigint as worked_minutes,
    count(*) filter(where is_reviewed)::bigint as reviewed_shifts,
    case when sum(case when is_reviewed then worked_minutes else 0 end)>0
      then round(sum(case when is_reviewed then safety_percent*worked_minutes else 0 end)
        /sum(case when is_reviewed then worked_minutes else 0 end),2)
      else 0 end as avg_safety_percent,
    case when sum(case when is_reviewed then worked_minutes else 0 end)>0
      then round(sum(case when is_reviewed then productivity_percent*worked_minutes else 0 end)
        /sum(case when is_reviewed then worked_minutes else 0 end),2)
      else 0 end as avg_productivity_percent,
    round(coalesce(sum(case when is_reviewed then penalty_amount else 0 end),0),2) as penalties,
    round(coalesce(sum(case when is_reviewed then
      (worked_minutes*rate_8h/480.0)*(1+safety_percent/100.0+productivity_percent/100.0)-penalty_amount
      else 0 end),0),2) as calculated_pay
  from reviewed_days
  group by worker_id
), adv as (
  select worker_id,round(coalesce(sum(amount),0),2) as advances
  from public.payroll_advances
  where paid_at between p_from and p_to
  group by worker_id
)
select
  a.worker_id,a.full_name,a.active,a.worked_minutes,a.reviewed_shifts,
  a.avg_safety_percent,a.avg_productivity_percent,a.penalties,a.calculated_pay,
  coalesce(v.advances,0)::numeric as advances,
  round(a.calculated_pay-coalesce(v.advances,0),2) as balance_to_pay
from agg a
left join adv v on v.worker_id=a.worker_id
where a.active=true or a.worked_minutes>0 or coalesce(v.advances,0)>0
order by a.active desc,a.full_name;
$$;

grant execute on function public.get_manager_payroll_summary_v5(date,date) to authenticated;
