-- FERRUM v4 server final
-- Safe to run more than once. Does not replace existing submit_daily_report overloads.

create table if not exists public.shift_sessions (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null default public.company_today(),
  sequence_no integer not null default 1,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique(worker_id, work_date, sequence_no)
);

create index if not exists shift_sessions_worker_date_idx
  on public.shift_sessions(worker_id, work_date, started_at);
create unique index if not exists shift_sessions_one_open_idx
  on public.shift_sessions(worker_id) where ended_at is null;

create table if not exists public.shift_reopen_requests (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null default public.company_today(),
  reason text not null,
  status text not null default 'pending'
    check(status in ('pending','approved','rejected','used')),
  manager_id uuid references public.profiles(id) on delete set null,
  manager_comment text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  used_at timestamptz
);

create index if not exists shift_reopen_worker_date_idx
  on public.shift_reopen_requests(worker_id, work_date, created_at desc);
create unique index if not exists shift_reopen_one_pending_idx
  on public.shift_reopen_requests(worker_id, work_date) where status='pending';

alter table public.shift_sessions enable row level security;
alter table public.shift_reopen_requests enable row level security;

drop policy if exists shift_sessions_worker_read on public.shift_sessions;
create policy shift_sessions_worker_read on public.shift_sessions
  for select to authenticated
  using(worker_id=auth.uid() or public.is_manager());

drop policy if exists shift_sessions_manager_all on public.shift_sessions;
create policy shift_sessions_manager_all on public.shift_sessions
  for all to authenticated
  using(public.is_manager()) with check(public.is_manager());

drop policy if exists shift_reopen_worker_read on public.shift_reopen_requests;
create policy shift_reopen_worker_read on public.shift_reopen_requests
  for select to authenticated
  using(worker_id=auth.uid() or public.is_manager());

drop policy if exists shift_reopen_manager_all on public.shift_reopen_requests;
create policy shift_reopen_manager_all on public.shift_reopen_requests
  for all to authenticated
  using(public.is_manager()) with check(public.is_manager());

create or replace function public.shift_minutes_between(
  p_worker uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns integer
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  tz text;
  bg text;
  result_minutes integer;
begin
  if p_end is null or p_start is null or p_end<=p_start then return 0; end if;
  select timezone into tz from public.company_settings where id=true;
  select break_group into bg from public.profiles where id=p_worker;

  select count(*)::integer into result_minutes
  from generate_series(date_trunc('minute',p_start),p_end-interval '1 second',interval '1 minute') g
  where not exists(
    select 1
    from public.break_rules b
    where b.active=true
      and b.break_group=coalesce(bg,'general')
      and (g at time zone tz)::time>=b.start_time
      and (g at time zone tz)::time<b.end_time
  );
  return coalesce(result_minutes,0);
end;
$$;

create or replace function public.shift_day_minutes(
  p_worker uuid,
  p_date date,
  p_open_end timestamptz default now()
)
returns integer
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(sum(public.shift_minutes_between(
    p_worker,s.started_at,coalesce(s.ended_at,p_open_end)
  )),0)::integer
  from public.shift_sessions s
  where s.worker_id=p_worker and s.work_date=p_date;
$$;

create or replace function public.start_shift()
returns public.shift_sessions
language plpgsql
security definer
set search_path=public
as $$
declare
  d date:=public.company_today();
  seq integer;
  s public.shift_sessions;
  rr public.shift_reopen_requests;
  rep public.daily_reports;
  needs_reopen boolean:=false;
begin
  if not exists(
    select 1 from public.profiles
    where id=auth.uid() and role='worker' and active=true
  ) then raise exception 'Начать смену может только активный рабочий'; end if;

  select * into s
  from public.shift_sessions
  where worker_id=auth.uid() and ended_at is null
  order by started_at desc limit 1;
  if found then return s; end if;

  select coalesce(max(sequence_no),0)+1 into seq
  from public.shift_sessions
  where worker_id=auth.uid() and work_date=d;

  needs_reopen := seq>1
    or exists(select 1 from public.daily_reports where worker_id=auth.uid() and report_date=d and status in ('submitted','reviewed'))
    or exists(select 1 from public.attendance_days where worker_id=auth.uid() and work_date=d and report_submitted_at is not null);

  if needs_reopen then
    select * into rr
    from public.shift_reopen_requests
    where worker_id=auth.uid() and work_date=d and status='approved'
    order by resolved_at desc limit 1 for update;
    if not found then raise exception 'Повторная смена требует разрешения начальника цеха'; end if;

    select * into rep from public.daily_reports
    where worker_id=auth.uid() and report_date=d for update;
    if found and rep.status='reviewed' then
      raise exception 'Отчёт уже проверен НЦ. Сначала необходимо вернуть его на доработку';
    end if;

    if seq=1 then seq:=2; end if;
    update public.shift_reopen_requests
      set status='used',used_at=now()
      where id=rr.id;
    if rep.id is not null then
      update public.daily_reports
        set status='draft',submitted_at=null,updated_at=now()
        where id=rep.id;
    end if;
    update public.attendance_days
      set report_submitted_at=null,updated_at=now()
      where worker_id=auth.uid() and work_date=d;
  end if;

  update public.downtime_events
    set ended_at=now()
    where worker_id=auth.uid() and ended_at is null;

  insert into public.shift_sessions(worker_id,work_date,sequence_no)
  values(auth.uid(),d,seq)
  returning * into s;

  insert into public.attendance_days(worker_id,work_date,first_login_at,last_seen_at)
  values(auth.uid(),d,s.started_at,s.started_at)
  on conflict(worker_id,work_date) do update
    set first_login_at=coalesce(public.attendance_days.first_login_at,excluded.first_login_at),
        last_seen_at=excluded.last_seen_at,
        updated_at=now();

  insert into public.notifications(user_id,kind,title,body)
  select id,'shift_started','Рабочий начал смену',
         (select full_name from public.profiles where id=auth.uid())||' начал смену №'||seq
  from public.profiles where role='manager' and active=true;

  return s;
end;
$$;

create or replace function public.request_shift_reopen(p_reason text)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  d date:=public.company_today();
  rid uuid;
begin
  if nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception 'Укажите причину повторной смены';
  end if;
  if exists(select 1 from public.shift_sessions where worker_id=auth.uid() and ended_at is null) then
    raise exception 'Текущая смена ещё не завершена';
  end if;
  if exists(select 1 from public.daily_reports where worker_id=auth.uid() and report_date=d and status='reviewed') then
    raise exception 'Отчёт уже проверен НЦ';
  end if;
  if not (
    exists(select 1 from public.daily_reports where worker_id=auth.uid() and report_date=d and status='submitted')
    or exists(select 1 from public.attendance_days where worker_id=auth.uid() and work_date=d and report_submitted_at is not null)
  ) then raise exception 'Смена ещё не завершена'; end if;
  if exists(select 1 from public.shift_reopen_requests where worker_id=auth.uid() and work_date=d and status in ('pending','approved')) then
    raise exception 'Запрос на повторную смену уже существует';
  end if;

  insert into public.shift_reopen_requests(worker_id,work_date,reason)
  values(auth.uid(),d,trim(p_reason)) returning id into rid;

  insert into public.notifications(user_id,kind,title,body)
  select id,'shift_reopen','Запрос повторной смены',
         (select full_name from public.profiles where id=auth.uid())||': '||trim(p_reason)
  from public.profiles where role='manager' and active=true;
  return rid;
end;
$$;

create or replace function public.resolve_shift_reopen(
  p_request_id uuid,
  p_approve boolean,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare r public.shift_reopen_requests;
begin
  if not public.is_manager() then raise exception 'Доступно только начальнику цеха'; end if;
  select * into r from public.shift_reopen_requests
  where id=p_request_id and status='pending' for update;
  if not found then raise exception 'Ожидающий запрос не найден'; end if;

  update public.shift_reopen_requests
    set status=case when p_approve then 'approved' else 'rejected' end,
        manager_id=auth.uid(),manager_comment=p_comment,resolved_at=now()
    where id=r.id;

  insert into public.notifications(user_id,kind,title,body)
  values(r.worker_id,'shift_reopen_resolution',
    case when p_approve then 'Повторная смена разрешена' else 'Повторная смена отклонена' end,
    coalesce(p_comment,''));
end;
$$;

create or replace function public.ferrum_close_no_task_on_task_start()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status='active' and old.status is distinct from 'active' then
    update public.downtime_events
      set ended_at=now()
      where worker_id=new.assigned_to and ended_at is null and reason='no_task';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ferrum_close_no_task_on_task_start on public.tasks;
create trigger trg_ferrum_close_no_task_on_task_start
after update of status on public.tasks
for each row execute function public.ferrum_close_no_task_on_task_start();

create or replace function public.ferrum_finalize_shift_on_report()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare mins integer;
begin
  if new.status='submitted' and old.status is distinct from 'submitted' then
    if exists(
      select 1 from public.shift_sessions
      where worker_id=new.worker_id and work_date=new.report_date
    ) then
      update public.shift_sessions
        set ended_at=coalesce(new.submitted_at,now())
        where worker_id=new.worker_id and work_date=new.report_date and ended_at is null;
      update public.downtime_events
        set ended_at=coalesce(new.submitted_at,now())
        where worker_id=new.worker_id and ended_at is null;
      mins:=public.shift_day_minutes(new.worker_id,new.report_date,coalesce(new.submitted_at,now()));
      update public.attendance_days
        set report_submitted_at=coalesce(new.submitted_at,now()),
            last_seen_at=coalesce(new.submitted_at,now()),
            worked_minutes=mins,
            updated_at=now()
        where worker_id=new.worker_id and work_date=new.report_date;
      insert into public.notifications(user_id,kind,title,body)
      select id,'shift_finished','Рабочий завершил смену',
             (select full_name from public.profiles where id=new.worker_id)||' завершил смену и отправил отчёт'
      from public.profiles where role='manager' and active=true;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ferrum_finalize_shift_on_report on public.daily_reports;
create trigger trg_ferrum_finalize_shift_on_report
after update of status on public.daily_reports
for each row execute function public.ferrum_finalize_shift_on_report();

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

grant execute on function public.start_shift() to authenticated;
grant execute on function public.request_shift_reopen(text) to authenticated;
grant execute on function public.resolve_shift_reopen(uuid,boolean,text) to authenticated;
grant execute on function public.shift_day_minutes(uuid,date,timestamptz) to authenticated;
grant execute on function public.worker_hourly_summary(date,date) to authenticated;

-- Final verification
select
  to_regclass('public.shift_sessions') as shift_sessions,
  to_regclass('public.shift_reopen_requests') as shift_reopen_requests,
  to_regprocedure('public.start_shift()') as start_shift,
  to_regprocedure('public.request_shift_reopen(text)') as request_shift_reopen,
  to_regprocedure('public.resolve_shift_reopen(uuid,boolean,text)') as resolve_shift_reopen,
  to_regprocedure('public.worker_hourly_summary(date,date)') as worker_hourly_summary;
