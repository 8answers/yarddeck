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

create or replace function public.normalize_registration_email(raw_email text)
returns text
language sql
immutable
as $$
  with normalized as (
    select lower(trim(coalesce(raw_email, ''))) as e
  )
  select case
    when e = '' then ''
    when split_part(e, '@', 2) in ('gmail.com', 'googlemail.com') then
      replace(split_part(split_part(e, '@', 1), '+', 1), '.', '') || '@gmail.com'
    else
      e
  end
  from normalized;
$$;

create or replace function public.has_registered_for_tournament(p_tournament_slug text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_email text;
begin
  current_email := public.normalize_registration_email((select auth.jwt() ->> 'email'));

  if current_email = '' then
    return false;
  end if;

  return exists (
    select 1
    from public.tournament_registrations tr
    where public.normalize_registration_email(tr.email) = current_email
      and tr.tournament_slug = p_tournament_slug
  );
end;
$$;

grant execute on function public.has_registered_for_tournament(text) to authenticated;

drop policy if exists "Public can insert registrations" on public.tournament_registrations;
create policy "Public can insert registrations"
  on public.tournament_registrations
  for insert
  to anon
  with check (terms_accepted = true);

drop policy if exists "Authenticated users can view own registrations" on public.tournament_registrations;
create policy "Authenticated users can view own registrations"
  on public.tournament_registrations
  for select
  to authenticated
  using (
    public.normalize_registration_email(email) =
    public.normalize_registration_email((select auth.jwt() ->> 'email'))
  );
