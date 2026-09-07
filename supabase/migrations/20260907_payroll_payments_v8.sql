create table if not exists public.payroll_payments (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.profiles(id) on delete restrict,
  paid_at date not null default public.company_today(),
  amount numeric(12,2) not null check(amount > 0),
  comment text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists payroll_payments_worker_date_idx
  on public.payroll_payments(worker_id, paid_at desc);

alter table public.payroll_payments enable row level security;

drop policy if exists payroll_payments_manager_read on public.payroll_payments;
create policy payroll_payments_manager_read on public.payroll_payments
  for select to authenticated using(public.is_manager());

drop policy if exists payroll_payments_manager_insert on public.payroll_payments;
create policy payroll_payments_manager_insert on public.payroll_payments
  for insert to authenticated with check(public.is_manager() and created_by=auth.uid());

drop policy if exists payroll_payments_worker_read_own on public.payroll_payments;
create policy payroll_payments_worker_read_own on public.payroll_payments
  for select to authenticated using(worker_id=auth.uid());
