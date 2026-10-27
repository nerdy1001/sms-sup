-- Synthetic staff for development and staging: one person per role. The addresses end in
-- .invalid, a domain that can never exist, so nothing can ever be sent to a real person.
-- Repeatable: running it again changes nothing.

insert into platform.users (id, email, display_name, role) values
    ('00000000-0000-4000-8000-000000000001', 'admin@example.invalid', 'Synthetic Administrator', 'administrator'),
    ('00000000-0000-4000-8000-000000000002', 'attache@example.invalid', 'Synthetic Attache', 'attache'),
    ('00000000-0000-4000-8000-000000000003', 'finance@example.invalid', 'Synthetic Finance Officer', 'finance_officer'),
    ('00000000-0000-4000-8000-000000000004', 'auditor@example.invalid', 'Synthetic Auditor', 'auditor')
on conflict (id) do nothing;
