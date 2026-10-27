-- Staff members. The list of roles is provisional: task AC-01 (staff access) owns it and replaces it.

create table platform.users (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    display_name text not null,
    role text not null,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    constraint users_email_lowercase check (email = lower(email) and position('@' in email) > 1),
    constraint users_email_unique unique (email),
    constraint users_role_known check (role in ('administrator', 'attache', 'finance_officer', 'auditor'))
);

alter table platform.users enable row level security;
alter table platform.users force row level security;

-- A staff member reads their own row; an administrator reads every row.
create policy users_read on platform.users for select to sms_app
    using (id = platform.current_user_id() or platform.has_role('administrator'));

-- Only an administrator creates, changes or removes staff members.
create policy users_insert on platform.users for insert to sms_app
    with check (platform.has_role('administrator'));
create policy users_update on platform.users for update to sms_app
    using (platform.has_role('administrator'))
    with check (platform.has_role('administrator'));
create policy users_delete on platform.users for delete to sms_app
    using (platform.has_role('administrator'));

grant select, insert, update, delete on platform.users to sms_app;
