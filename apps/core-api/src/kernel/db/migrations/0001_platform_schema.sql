-- Platform schema: what every module of the staff application shares, owned by the kernel.
--
-- Identity reaches the database through two session settings that the application sets at the start of
-- every request, inside a transaction (see kernel/db/context.ts):
--   app.user_id  the id of the signed-in staff member
--   app.role     the role of that staff member
-- Row-level security policies read them through the functions below. When the settings are missing the
-- functions return null, every comparison with null is false, and no row is visible: the database
-- refuses by default.

create schema if not exists platform;

-- The role the application connects as. It owns nothing, cannot create objects, cannot switch off
-- row-level security and is not a superuser. How it logs in (password or not) is decided by each
-- environment, never by a migration.
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'sms_app') then
        create role sms_app login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
    end if;
end
$$;

revoke all on schema public from public;
grant usage on schema platform to sms_app;

create function platform.current_user_id() returns uuid
language sql stable
set search_path = pg_catalog
as $$
    select nullif(pg_catalog.current_setting('app.user_id', true), '')::uuid
$$;

create function platform.current_staff_role() returns text
language sql stable
set search_path = pg_catalog
as $$
    select nullif(pg_catalog.current_setting('app.role', true), '')
$$;

-- True when the current staff member has one of the given roles.
create function platform.has_role(variadic wanted text[]) returns boolean
language sql stable
set search_path = pg_catalog
as $$
    select coalesce(platform.current_staff_role() = any (wanted), false)
$$;

grant execute on function platform.current_user_id() to sms_app;
grant execute on function platform.current_staff_role() to sms_app;
grant execute on function platform.has_role(text[]) to sms_app;
