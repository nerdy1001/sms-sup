-- The audit log: who did what, to which record, when. It only grows.
-- It holds identifiers and action names, never personal data (no names, phone numbers or amounts).

create table platform.audit_log (
    id bigint generated always as identity primary key,
    occurred_at timestamptz not null default now(),
    actor_id uuid not null,
    actor_role text not null,
    action text not null,
    object_type text not null,
    object_id text,
    detail jsonb not null default '{}'::jsonb,
    constraint audit_log_action_not_empty check (length(action) > 0),
    constraint audit_log_object_type_not_empty check (length(object_type) > 0)
);

create index audit_log_occurred_at_idx on platform.audit_log (occurred_at);
create index audit_log_actor_idx on platform.audit_log (actor_id, occurred_at);

alter table platform.audit_log enable row level security;
alter table platform.audit_log force row level security;

-- Anyone signed in may add an entry, and only in their own name.
create policy audit_log_insert on platform.audit_log for insert to sms_app
    with check (actor_id = platform.current_user_id() and actor_role = platform.current_staff_role());

-- Only auditors and administrators read it.
create policy audit_log_read on platform.audit_log for select to sms_app
    using (platform.has_role('auditor', 'administrator'));

-- No update and no delete policy exists, so both are refused. The privileges and the trigger below
-- refuse them a second and a third time, including for the owner of the table.
grant select, insert on platform.audit_log to sms_app;

create function platform.refuse_audit_change() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    raise exception 'the audit log is append-only' using errcode = 'insufficient_privilege';
end
$$;

create trigger audit_log_append_only
    before update or delete on platform.audit_log
    for each row execute function platform.refuse_audit_change();

create trigger audit_log_no_truncate
    before truncate on platform.audit_log
    for each statement execute function platform.refuse_audit_change();
