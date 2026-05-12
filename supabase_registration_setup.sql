create table if not exists public.tournament_registrations (
  id bigserial primary key,
  tournament_name text not null,
  tournament_slug text not null,
  full_name text not null,
  skill_level integer not null check (skill_level between 1 and 10),
  email text not null check (email ~* '^[A-Z0-9._%+-]+@gmail\.com$'),
  phone_country_code text not null default '+91',
  phone_number text not null,
  terms_accepted boolean not null default false,
  source_path text,
  created_at timestamptz not null default now()
);

create unique index if not exists tournament_registrations_unique_email_per_event
  on public.tournament_registrations (tournament_slug, email);

alter table public.tournament_registrations enable row level security;

drop policy if exists "Public can insert registrations" on public.tournament_registrations;
create policy "Public can insert registrations"
  on public.tournament_registrations
  for insert
  to anon
  with check (terms_accepted = true);