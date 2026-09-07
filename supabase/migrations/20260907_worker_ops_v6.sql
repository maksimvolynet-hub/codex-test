-- FERRUM v6: срочная внеплановая работа, полное удаление задания,
-- зарплата рабочего с коэффициентами.

alter table public.unplanned_work
  add column if not exists started_at timestamptz;

alter table public.unplanned_work
  add column if not exists ended_at timestamptz;

alter table public.unplanned_work
  add column if not exists interrupted_task_id uuid references public.tasks(id) on delete set null;

create index if not exists unplanned_work_open_worker_idx
  on public.unplanned_work(worker_id, started_at)
  where ended_at is null and started_at is not null;

create or replace function public.start_unplanned_work(
  p_title text,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  d date:=public.company_today();
  rid uuid;
  report_id uuid;
  active_task uuid;
begin
  if nullif(trim(coalesce(p_title,'')),'') is null then
    raise exception 'Укажите, что нужно сделать';
  end if;

  if not exists(
    select 1 from public.shift_sessions
    where worker_id=auth.uid() and ended_at is null
  ) then
    raise exception 'Сначала начните смену';
  end if;

  if exists(
    select 1 from public.unplanned_work
    where worker_id=auth.uid()
      and started_at is not null
      and ended_at is null
  ) then
    raise exception 'Сначала завершите текущую срочную работу';
  end if;

  select id into report_id
  from public.daily_reports
  where worker_id=auth.uid() and report_date=d
  limit 1;

  if report_id is null then
    report_id:=public.get_or_build_daily_report(d);
  end if;

  select id into active_task
  from public.tasks
  where assigned_to=auth.uid() and status::text='active'
  order by started_at desc nulls last
  limit 1;

  if active_task is not null then
    update public.task_sessions
    set ended_at=now()
    where task_id=active_task
      and worker_id=auth.uid()
      and ended_at is null;
  end if;

  insert into public.unplanned_work(
    report_id,worker_id,title,minutes,comment,status,
    started_at,interrupted_task_id
  ) values(
    report_id,auth.uid(),trim(p_title),1,nullif(trim(coalesce(p_comment,'')),''),'pending',
    now(),active_task
  ) returning id into rid;

  return rid;
end;
$$;

create or replace function public.finish_unplanned_work(p_id uuid)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  u public.unplanned_work;
  mins integer;
begin
  select * into u
  from public.unplanned_work
  where id=p_id and worker_id=auth.uid()
  for update;

  if not found then
    raise exception 'Срочная работа не найдена';
  end if;
  if u.started_at is null or u.ended_at is not null then
    raise exception 'Срочная работа уже завершена';
  end if;

  mins:=greatest(1,ceil(extract(epoch from (now()-u.started_at))/60.0)::integer);

  update public.unplanned_work
  set ended_at=now(),minutes=mins
  where id=u.id;

  if u.interrupted_task_id is not null
     and exists(
       select 1 from public.tasks
       where id=u.interrupted_task_id
         and assigned_to=auth.uid()
         and status::text='active'
     ) then
    if not exists(
      select 1 from public.task_sessions
      where task_id=u.interrupted_task_id
        and worker_id=auth.uid()
        and ended_at is null
    ) then
      insert into public.task_sessions(task_id,worker_id,started_at)
      values(u.interrupted_task_id,auth.uid(),now());
    end if;
    update public.tasks set started_at=now()
    where id=u.interrupted_task_id;
  end if;

  return mins;
end;
$$;

grant execute on function public.start_unplanned_work(text,text) to authenticated;
grant execute on function public.finish_unplanned_work(uuid) to authenticated;

create or replace function public.manager_delete_task_permanently(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  wid uuid;
  task_title text;
begin
  if not public.is_manager() then
    raise exception 'Удалять задания может только НЦ';
  end if;

  select assigned_to,title into wid,task_title
  from public.tasks
  where id=p_task_id
  for update;

  if not found then
    raise exception 'Задание не найдено';
  end if;

  delete from public.task_photos where task_id=p_task_id;
  delete from public.task_sessions where task_id=p_task_id;
  delete from public.stop_requests where task_id=p_task_id;
  delete from public.report_task_comments where task_id=p_task_id;
  delete from public.daily_report_items where task_id=p_task_id;

  update public.unplanned_work
  set interrupted_task_id=null
  where interrupted_task_id=p_task_id;

  delete from public.tasks where id=p_task_id;

  insert into public.notifications(user_id,kind,title,body)
  values(wid,'task_deleted','Задание удалено НЦ',
    'Задание «'||coalesce(task_title,'')||'» полностью удалено начальником цеха.');

  if exists(
    select 1 from public.shift_sessions
    where worker_id=wid and ended_at is null
  ) and not exists(
    select 1 from public.tasks
    where assigned_to=wid and status::text in ('active','stop_requested','queued')
  ) and not exists(
    select 1 from public.downtime_events
    where worker_id=wid and ended_at is null
  ) then
    insert into public.downtime_events(worker_id,reason,started_at)
    values(wid,'no_task',now());
  end if;
end;
$$;

grant execute on function public.manager_delete_task_permanently(uuid) to authenticated;

create or replace function public.get_worker_salary_v6(p_from date,p_to date)
returns table(
  worked_minutes bigint,
  reviewed_shifts bigint,
  base_pay numeric,
  avg_safety_percent numeric,
  avg_productivity_percent numeric,
  avg_total_percent numeric,
  penalties numeric,
  total_pay numeric
)
language sql
stable
security definer
set search_path=public
as $$
with d as (
  select
    coalesce(a.worked_minutes,0)::numeric as mins,
    coalesce(p.rate_8h,0)::numeric as rate8,
    rr.safety_percent::numeric as safety,
    rr.productivity_percent::numeric as productivity,
    coalesce(rr.penalty_amount,0)::numeric as penalty
  from public.profiles p
  join public.attendance_days a
    on a.worker_id=p.id
   and a.work_date between p_from and p_to
   and a.report_submitted_at is not null
  join public.daily_reports dr
    on dr.worker_id=p.id
   and dr.report_date=a.work_date
   and dr.status='reviewed'
  join public.report_reviews rr
    on rr.report_id=dr.id
   and rr.safety_percent is not null
   and rr.productivity_percent is not null
  where p.id=auth.uid()
), a as (
  select
    coalesce(sum(mins),0)::bigint as worked_minutes,
    count(*)::bigint as reviewed_shifts,
    round(coalesce(sum(mins*rate8/480.0),0),2) as base_pay,
    case when coalesce(sum(mins),0)>0
      then round(sum(safety*mins)/sum(mins),2) else 0 end as avg_safety_percent,
    case when coalesce(sum(mins),0)>0
      then round(sum(productivity*mins)/sum(mins),2) else 0 end as avg_productivity_percent,
    case when coalesce(sum(mins),0)>0
      then round(sum((safety+productivity)*mins)/sum(mins),2) else 0 end as avg_total_percent,
    round(coalesce(sum(penalty),0),2) as penalties,
    round(coalesce(sum((mins*rate8/480.0)*(1+safety/100.0+productivity/100.0)-penalty),0),2) as total_pay
  from d
)
select * from a;
$$;

grant execute on function public.get_worker_salary_v6(date,date) to authenticated;
