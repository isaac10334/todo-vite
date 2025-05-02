-- Create table workspaces
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null default 'untitled',
  data bytea not null default ''::bytea,
  created_at timestamptz not null default now(),
  timer_duration integer,
  timer_value integer,
  timer_running boolean
);

-- Enable row level security
alter table workspaces enable row level security;

-- Allow full access to own workspaces
create policy "user owns workspace"
  on workspaces
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());