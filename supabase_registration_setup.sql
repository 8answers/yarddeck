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

create table if not exists public.tournament_notify_emails (
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
  confirmation_email_status text,
  confirmation_email_attempted_at timestamptz,
  confirmation_email_sent_at timestamptz,
  confirmation_email_error text,
  created_at timestamptz not null default now()
);

alter table public.tournament_notify_emails
  add column if not exists confirmation_email_status text;
alter table public.tournament_notify_emails
  add column if not exists confirmation_email_attempted_at timestamptz;
alter table public.tournament_notify_emails
  add column if not exists confirmation_email_sent_at timestamptz;
alter table public.tournament_notify_emails
  add column if not exists confirmation_email_error text;

create unique index if not exists tournament_notify_emails_unique_email_per_event
  on public.tournament_notify_emails (tournament_slug, email);

create index if not exists tournament_notify_emails_email_status_idx
  on public.tournament_notify_emails (confirmation_email_status, created_at desc);

alter table public.tournament_notify_emails enable row level security;

drop policy if exists "Public can insert notify emails" on public.tournament_notify_emails;
create policy "Public can insert notify emails"
  on public.tournament_notify_emails
  for insert
  to anon
  with check (terms_accepted = true);

drop policy if exists "Public can read notify emails for duplicate check" on public.tournament_notify_emails;
create policy "Public can read notify emails for duplicate check"
  on public.tournament_notify_emails
  for select
  to anon
  using (true);
