-- FERRUM: перенос незавершённого задания между сменами

alter table public.task_sessions
  add column if not exists ended_at timestamptz;

alter table public.tasks
  add column if not exists carryover boolean not null default false;

alter table public.tasks
  add column if not exists carryover_from_date date;

alter table public.tasks
  add column if not exists carryover_count integer not null default 0;

create or replace function public.pause_task_for_next_shift(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  t public.tasks;
  next_order integer;
begin
  select * into t
  from public.tasks
  where id=p_task_id
    and assigned_to=auth.uid()
  for update;

  if not found then
    raise exception 'Задание не найдено';
  end if;

  if t.status::text <> 'active' then
    raise exception 'Перенести можно только текущее активное задание';
  end if;

  update public.task_sessions
  set ended_at=now()
  where task_id=p_task_id
    and worker_id=auth.uid()
    and ended_at is null;

  select coalesce(min(queue_order),0)-1
  into next_order
  from public.tasks
  where assigned_to=auth.uid()
    and status::text='queued'
    and id<>p_task_id;

  update public.tasks
  set status='queued',
      queue_order=next_order,
      started_at=null,
      carryover=true,
      carryover_from_date=public.company_today(),
      carryover_count=coalesce(carryover_count,0)+1
  where id=p_task_id;

  insert into public.notifications(user_id,kind,title,body)
  select id,
         'task_carryover',
         'Задание перенесено на следующую смену',
         (select full_name from public.profiles where id=auth.uid()) ||
         ' не завершил задание «' || coalesce(t.title,'') || '». Оно перенесено на следующую смену.'
  from public.profiles
  where role='manager' and active=true;
end;
$$;

grant execute on function public.pause_task_for_next_shift(uuid) to authenticated;

-- Не даём отправить отчёт, пока активное задание не закрыто
-- или явно не перенесено на следующую смену.
create or replace function public.ferrum_guard_report_active_task()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status='submitted' and old.status is distinct from 'submitted' then
    if exists(
      select 1
      from public.tasks
      where assigned_to=new.worker_id
        and status::text in ('active','stop_requested')
    ) then
      raise exception 'Сначала ответьте, завершено ли последнее задание. Завершите его или перенесите на следующую смену.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ferrum_guard_report_active_task on public.daily_reports;
create trigger trg_ferrum_guard_report_active_task
before update of status on public.daily_reports
for each row execute function public.ferrum_guard_report_active_task();
