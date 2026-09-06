-- FERRUM: explicit shift sessions, clean downtime end, repeat-shift approval

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
create index if not exists shift_sessions_worker_date_idx on public.shift_sessions(worker_id,work_date,started_at);
create unique index if not exists shift_sessions_one_open_idx on public.shift_sessions(worker_id) where ended_at is null;

create table if not exists public.shift_reopen_requests (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null default public.company_today(),
  reason text not null,
  status text not null default 'pending' check(status in ('pending','approved','rejected','used')),
  manager_id uuid references public.profiles(id) on delete set null,
  manager_comment text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  used_at timestamptz
);
create index if not exists shift_reopen_worker_date_idx on public.shift_reopen_requests(worker_id,work_date,created_at desc);
create unique index if not exists shift_reopen_one_pending_idx on public.shift_reopen_requests(worker_id,work_date) where status='pending';

alter table public.shift_sessions enable row level security;
alter table public.shift_reopen_requests enable row level security;

drop policy if exists shift_sessions_worker_read on public.shift_sessions;
create policy shift_sessions_worker_read on public.shift_sessions for select to authenticated using(worker_id=auth.uid() or public.is_manager());
drop policy if exists shift_sessions_manager_all on public.shift_sessions;
create policy shift_sessions_manager_all on public.shift_sessions for all to authenticated using(public.is_manager()) with check(public.is_manager());

drop policy if exists shift_reopen_worker_read on public.shift_reopen_requests;
create policy shift_reopen_worker_read on public.shift_reopen_requests for select to authenticated using(worker_id=auth.uid() or public.is_manager());
drop policy if exists shift_reopen_manager_all on public.shift_reopen_requests;
create policy shift_reopen_manager_all on public.shift_reopen_requests for all to authenticated using(public.is_manager()) with check(public.is_manager());

create or replace function public.shift_minutes_between(p_worker uuid,p_start timestamptz,p_end timestamptz)
returns integer
language plpgsql
stable
security definer
set search_path=public
as $$
declare tz text; bg text; result_minutes int;
begin
  if p_end<=p_start then return 0; end if;
  select timezone into tz from public.company_settings where id=true;
  select break_group into bg from public.profiles where id=p_worker;
  select count(*)::int into result_minutes
  from generate_series(date_trunc('minute',p_start),p_end-interval '1 second',interval '1 minute') g
  where not exists(
    select 1 from public.break_rules b
    where b.active=true and b.break_group=coalesce(bg,'general')
      and (g at time zone tz)::time>=b.start_time
      and (g at time zone tz)::time<b.end_time
  );
  return coalesce(result_minutes,0);
end;
$$;

create or replace function public.shift_day_minutes(p_worker uuid,p_date date,p_open_end timestamptz default now())
returns integer
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(sum(public.shift_minutes_between(p_worker,s.started_at,coalesce(s.ended_at,p_open_end))),0)::int
  from public.shift_sessions s where s.worker_id=p_worker and s.work_date=p_date;
$$;

create or replace function public.start_shift()
returns public.shift_sessions
language plpgsql
security definer
set search_path=public
as $$
declare d date:=public.company_today(); seq int; s public.shift_sessions; rr public.shift_reopen_requests; rep public.daily_reports;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='worker' and active=true) then raise exception 'worker only'; end if;
  if exists(select 1 from public.shift_sessions where worker_id=auth.uid() and ended_at is null) then
    select * into s from public.shift_sessions where worker_id=auth.uid() and ended_at is null order by started_at desc limit 1;
    return s;
  end if;
  select coalesce(max(sequence_no),0)+1 into seq from public.shift_sessions where worker_id=auth.uid() and work_date=d;
  if seq>1 then
    select * into rr from public.shift_reopen_requests where worker_id=auth.uid() and work_date=d and status='approved' order by resolved_at desc limit 1 for update;
    if not found then raise exception 'repeat shift requires manager approval'; end if;
    update public.shift_reopen_requests set status='used',used_at=now() where id=rr.id;
    select * into rep from public.daily_reports where worker_id=auth.uid() and report_date=d for update;
    if rep.status='reviewed' then raise exception 'reviewed report cannot be reopened'; end if;
    if rep.id is not null then update public.daily_reports set status='draft',submitted_at=null,updated_at=now() where id=rep.id; end if;
    update public.attendance_days set report_submitted_at=null,updated_at=now() where worker_id=auth.uid() and work_date=d;
  end if;
  update public.downtime_events set ended_at=now() where worker_id=auth.uid() and ended_at is null;
  insert into public.shift_sessions(worker_id,work_date,sequence_no) values(auth.uid(),d,seq) returning * into s;
  insert into public.attendance_days(worker_id,work_date,first_login_at,last_seen_at)
  values(auth.uid(),d,s.started_at,s.started_at)
  on conflict(worker_id,work_date) do update set first_login_at=coalesce(public.attendance_days.first_login_at,excluded.first_login_at),last_seen_at=excluded.last_seen_at,updated_at=now();
  return s;
end;
$$;

create or replace function public.request_shift_reopen(p_reason text)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare d date:=public.company_today(); rid uuid;
begin
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'reason required'; end if;
  if not exists(select 1 from public.daily_reports where worker_id=auth.uid() and report_date=d and status='submitted') then raise exception 'shift is not completed'; end if;
  if exists(select 1 from public.shift_reopen_requests where worker_id=auth.uid() and work_date=d and status in ('pending','approved')) then raise exception 'request already exists'; end if;
  insert into public.shift_reopen_requests(worker_id,work_date,reason) values(auth.uid(),d,p_reason) returning id into rid;
  insert into public.notifications(user_id,kind,title,body)
  select id,'shift_reopen','Запрос повторной смены',(select full_name from public.profiles where id=auth.uid())||': '||p_reason from public.profiles where role='manager' and active=true;
  return rid;
end;
$$;

create or replace function public.resolve_shift_reopen(p_request_id uuid,p_approve boolean,p_comment text default null)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare r public.shift_reopen_requests;
begin
  if not public.is_manager() then raise exception 'manager only'; end if;
  select * into r from public.shift_reopen_requests where id=p_request_id and status='pending' for update;
  if not found then raise exception 'pending request not found'; end if;
  update public.shift_reopen_requests set status=case when p_approve then 'approved' else 'rejected' end,manager_id=auth.uid(),manager_comment=p_comment,resolved_at=now() where id=r.id;
  insert into public.notifications(user_id,kind,title,body) values(r.worker_id,'shift_reopen_resolution',case when p_approve then 'Повторная смена разрешена' else 'Повторная смена отклонена' end,coalesce(p_comment,''));
end;
$$;

-- Close active shift session and stale downtime when the daily report is submitted.
create or replace function public.finish_shift_state(p_worker uuid,p_date date,p_end timestamptz default now())
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare mins int;
begin
  update public.shift_sessions set ended_at=p_end where worker_id=p_worker and work_date=p_date and ended_at is null;
  update public.downtime_events set ended_at=p_end where worker_id=p_worker and ended_at is null;
  mins:=public.shift_day_minutes(p_worker,p_date,p_end);
  update public.attendance_days set report_submitted_at=p_end,last_seen_at=p_end,worked_minutes=mins,updated_at=now() where worker_id=p_worker and work_date=p_date;
  return mins;
end;
$$;

-- Wrap existing report submission with shift finalization.
create or replace function public.submit_daily_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare r public.daily_reports; tz text; now_local timestamp; effective_end time; lead int; allowed timestamp; early_ok boolean;
begin
  select * into r from public.daily_reports where id=p_report_id and worker_id=auth.uid() and status='draft' for update;
  if not found then raise exception 'draft report not found'; end if;
  select timezone into tz from public.company_settings where id=true;
  now_local:=now() at time zone tz;
  select coalesce(o.shift_end,p.shift_end),coalesce(o.report_lead_minutes,p.report_lead_minutes)
  into effective_end,lead from public.profiles p left join public.shift_overrides o on o.worker_id=p.id and o.work_date=r.report_date where p.id=auth.uid();
  allowed:=r.report_date+effective_end-make_interval(mins=>lead);
  select exists(select 1 from public.early_report_requests e where e.worker_id=auth.uid() and e.work_date=r.report_date and e.status='approved') into early_ok;
  if now_local<allowed and not early_ok then raise exception 'report is not available yet'; end if;
  update public.daily_reports set status='submitted',submitted_at=now(),updated_at=now() where id=p_report_id;
  perform public.finish_shift_state(auth.uid(),r.report_date,now());
  insert into public.notifications(user_id,kind,title,body)
  select p.id,'report_submitted','Новый отчёт','Рабочий завершил смену и отправил ежедневный отчёт' from public.profiles p where p.role='manager' and p.active=true;
end;
$$;

grant execute on function public.start_shift() to authenticated;
grant execute on function public.request_shift_reopen(text) to authenticated;
grant execute on function public.resolve_shift_reopen(uuid,boolean,text) to authenticated;
grant execute on function public.shift_day_minutes(uuid,date,timestamptz) to authenticated;
