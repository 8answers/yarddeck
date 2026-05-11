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
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'failed', 'cancelled')),
  cashfree_order_id text,
  cashfree_payment_session_id text,
  paid_at timestamptz,
  source_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.tournament_waitlist (
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

drop index if exists public.tournament_registrations_unique_email_per_event;

create unique index if not exists tournament_waitlist_unique_email_per_event
  on public.tournament_waitlist (tournament_slug, email);

alter table public.tournament_registrations
  add column if not exists payment_status text not null default 'pending',
  add column if not exists cashfree_order_id text,
  add column if not exists cashfree_payment_session_id text,
  add column if not exists paid_at timestamptz;

alter table public.tournament_registrations
  drop constraint if exists tournament_registrations_payment_status_check;

alter table public.tournament_registrations
  add constraint tournament_registrations_payment_status_check
  check (payment_status in ('pending', 'paid', 'failed', 'cancelled'));

create unique index if not exists tournament_registrations_unique_cashfree_order_id
  on public.tournament_registrations (cashfree_order_id)
  where cashfree_order_id is not null;

alter table public.tournament_registrations enable row level security;
alter table public.tournament_waitlist enable row level security;

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

create or replace function public.get_tournament_registration_count(p_tournament_slug text)
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*)
  from public.tournament_registrations tr
  where tr.tournament_slug = p_tournament_slug;
$$;

create or replace function public.check_tournament_registration_availability(
  p_tournament_slug text,
  p_email text,
  p_phone_country_code text,
  p_phone_number text
)
returns table (
  email_registered boolean,
  phone_registered boolean,
  logged_in_registered boolean
)
language sql
security definer
set search_path = public
as $$
  with input_values as (
    select
      public.normalize_registration_email(p_email) as normalized_email,
      coalesce(nullif(trim(p_phone_country_code), ''), '+91') as normalized_country_code,
      regexp_replace(coalesce(p_phone_number, ''), '\D', '', 'g') as normalized_phone,
      public.normalize_registration_email((select auth.jwt() ->> 'email')) as logged_in_email
  )
  select
    exists (
      select 1
      from public.tournament_registrations tr, input_values iv
      where tr.tournament_slug = p_tournament_slug
        and public.normalize_registration_email(tr.email) = iv.normalized_email
    ) as email_registered,
    exists (
      select 1
      from public.tournament_registrations tr, input_values iv
      where tr.tournament_slug = p_tournament_slug
        and tr.phone_country_code = iv.normalized_country_code
        and regexp_replace(coalesce(tr.phone_number, ''), '\D', '', 'g') = iv.normalized_phone
    ) as phone_registered,
    exists (
      select 1
      from public.tournament_registrations tr, input_values iv
      where tr.tournament_slug = p_tournament_slug
        and iv.logged_in_email <> ''
        and public.normalize_registration_email(tr.email) = iv.logged_in_email
    ) as logged_in_registered
  from input_values;
$$;

grant execute on function public.has_registered_for_tournament(text) to authenticated;
grant execute on function public.get_tournament_registration_count(text) to anon, authenticated;
grant execute on function public.check_tournament_registration_availability(text, text, text, text) to anon, authenticated;

drop policy if exists "Public can insert registrations" on public.tournament_registrations;
create policy "Public can insert registrations"
  on public.tournament_registrations
  for insert
  to anon
  with check (terms_accepted = true);

drop policy if exists "Public can insert waitlist" on public.tournament_waitlist;
create policy "Public can insert waitlist"
  on public.tournament_waitlist
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
