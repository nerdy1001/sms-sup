# ADR 0006: Plain SQL migrations, row-level security, identity through session settings

Status: accepted (2026-10-27, task FN-04)

## Context

The staff application holds identity numbers and bank details of scholars. A mistake in application
code (a missing filter in one query) must not be enough to expose another person's record. The plan also
asks for migrations, seed data and a platform schema shared by all modules, built by one developer who
pays for his own tools and works in an environment where the package registry may be unreachable.

## Decision

1. **Migrations are plain numbered SQL files**, applied by a small runner in `tools/db`. Each file runs
   in one transaction together with the insertion of its record, so a failed migration leaves nothing
   behind. The runner stores a fingerprint (SHA-256) of every applied file and refuses to run if one has
   been edited. Files live next to the code that owns them: the kernel's in `kernel/db/migrations`, each
   module's in its own `infrastructure/migrations`, each for its own schema.
2. **No ORM and no migration tool for now.** The runner is our own code on top of the `pg` driver, which the
   application already uses. (It first sent scripts to the `psql` command, which needed `psql` or Docker on
   every machine that migrated; it was moved to `pg` on 2026-11-04 so that the staging deployment can run it
   from the application image.) An ORM
   such as Prisma was considered and not chosen: it does not model row-level security, wants one schema
   file for the whole database while each module here owns its schema, and needs generated code and
   install steps that `.npmrc` switches off. The choice of a typed query layer stays open and does not
   affect the migrations.
3. **Row-level security on every table, enforced and forced.** A table is created, protected and given
   its policies in the same file; a check fails the build otherwise. `force` makes even the table's
   owner obey the policies (a superuser still bypasses them, which is why the application never connects
   as one).
4. **Identity travels in two session settings**, `app.user_id` and `app.role`, set with
   `set_config(..., true)` inside the request's transaction. The policies read them through
   `platform.current_user_id()` and `platform.has_role(...)`, which return null when nothing is set, so
   a missing identity sees nothing. The settings vanish when the transaction ends, so a pooled
   connection cannot carry one person's identity to the next request. A malformed identity makes the
   query fail rather than show rows.
5. **The application role is deliberately weak.** `sms_app` is not a superuser, cannot create objects,
   cannot bypass row-level security and has no access to the migration history. Migrations run as a
   different, more powerful role.
6. **The audit log is append-only in three ways:** no update or delete privilege, no policy that allows
   either, and a trigger that refuses both (and truncation) even for the owner.
7. **Seeds are synthetic and repeatable.** Seed files must use `on conflict`, addresses end in
   `.invalid`, and seeding or resetting refuses to run when `SMS_ENV` names anything but local, staging
   or test. Synthetic scholars come from a generator with a fixed seed (200 by default), which the
   registry module turns into rows.
8. **The tests run against a real PostgreSQL.** The policies are the security of the system, so they
   are tested where they run, as the application role, with the same statement the application uses to
   set the identity.

## Consequences

- Writing SQL by hand is more work than describing tables in a schema file, and nothing checks that
  application queries match the tables. A typed query layer will have to be chosen later.
- Every module's tables will be behind policies, which costs a little speed and requires each module to
  write its policies carefully. The tests of each module must include the cases where access is refused.
- Policies depend on the application setting the identity correctly. A bug that sets the wrong identity
  is not caught by the database. `runAs` keeps that code in one place.
- The staff roles in `platform.users` are provisional. Task AC-01 owns the real list.
- Migrations need a reachable PostgreSQL and its login settings (PGHOST and the others), nothing else. No
  `psql` and no Docker are needed on the machine that runs them.
- A migration that fails halfway is safe, but a migration that succeeds and is wrong can only be fixed by
  a new migration. That is the cost of never editing history.

## When to revisit

- The application has its database driver since FN-05 (`pg`, in `kernel/db`). Decided then: migrations stay a
  separate step, not run at start-up. Done on 2026-11-04: the runner uses `pg`, and the staging deployment
  runs it as a one-off step (ADR 0005, decision 10).
- When the first module with real data arrives (RG-01): check that the pattern of policies scales, and
  whether a shared helper for "own rows" policies is worth having.
- When the staging and production databases need a role split (owner, migrator, application): plan it
  with FN-10 and FN-11.
