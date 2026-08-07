create table if not exists public.bus_last_locations (
  vehicle_key text primary key,
  bus_data jsonb not null,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bus_last_locations_last_seen_at_idx
  on public.bus_last_locations (last_seen_at desc);

alter table public.bus_last_locations enable row level security;

-- No public policy is intentional. The website API uses the server-only service role key.
