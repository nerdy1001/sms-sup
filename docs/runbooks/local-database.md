# Runbook: the database on your computer

How to start the development database, apply the migrations, add the synthetic data, and start again.
It needs Docker (Docker Desktop on Windows or macOS) and Node 22.18 or later. The commands talk to the database through the same driver the application uses, so `psql` is not needed on your computer. Everything runs in a
container bound to your own computer (`127.0.0.1`), so nothing is reachable from outside.

## First time

From the repository folder:

```
npm run db:up
npm run db:migrate
npm run db:seed
```

1. `db:up` starts PostgreSQL 17 in a container and waits until it answers. The first run downloads the
   image (about 100 MB).
2. `db:migrate` applies every migration that has not been applied yet and prints one line for each.
3. `db:seed` adds four synthetic staff members, one per role.

Expected end of `db:migrate`: `Applied 3 migration(s).` Run it again: `Nothing to apply: the database is
up to date.`

Check what you have:

```
npm run db:status
npm run db:psql
```

`db:psql` opens a SQL prompt inside the container (this is the one command that uses Docker directly). Try `select email, role from platform.users;` (type
`\q` to leave). You see the four staff members, because you are connected as the owner of the database,
which is allowed to see everything. The application will connect as a different role that is not.

## Everyday commands

| I want to | Command |
|---|---|
| Start the database | `npm run db:up` |
| Stop it (data is kept) | `npm run db:down` |
| Apply new migrations | `npm run db:migrate` |
| See what is applied and what is pending | `npm run db:status` |
| Add the synthetic data again | `npm run db:seed` (safe to repeat) |
| Delete everything and start again | `npm run db:reset` (drops the database, migrates, seeds) |
| Delete the data volume too | `docker compose -f infra/local/compose.yaml down -v` |
| Open a SQL prompt | `npm run db:psql` |

## Writing a migration

1. Create the next numbered file in the right folder. The platform (the kernel) uses
   `apps/core-api/src/kernel/db/migrations/`. A module uses
   `apps/core-api/src/modules/<name>/internal/infrastructure/migrations/`. Names look like
   `0004_add_scholar_notes.sql`: four digits, then words joined by underscores. Numbers run 0001,
   0002, ... without gaps, separately for the platform and for each module.
2. Write plain SQL. Put the schema in front of every name (`platform.users`). Every new table needs
   `enable row level security`, `force row level security` and at least one policy. The check
   `npm run check` tells you what is missing.
3. Do not write `begin` or `commit`. The runner wraps the file and its record in one transaction.
4. Run `npm run db:migrate`. If the migration fails, nothing it did is kept and it is not recorded; fix
   the file and run it again.
5. **Never edit a migration that has been applied** (to your database, to anyone's, or to staging). The
   runner remembers a fingerprint of each file and refuses to continue if one has changed. Add a new
   migration instead. While a migration is only on your computer, `npm run db:reset` lets you rewrite it.

## When something fails

| What you see | Cause | What to do |
|---|---|---|
| `Docker is not running` | Docker Desktop is closed | Start it, wait until it says it is running, try again |
| `The local database is not running` | The container is stopped | `npm run db:up` |
| `An applied migration was edited` | You changed a file that was already applied | Undo the edit and add a new migration; or `npm run db:reset` if it was never shared |
| `The database has migrations that no file explains` | The database is from another branch, or a file was deleted | Switch back to that branch, or `npm run db:reset` |
| `Refusing to seed: SMS_ENV is ...` | `SMS_ENV` is set to something other than local, staging or test | Unset it; it should be `production` only on the real system |
| `port is already allocated` on `db:up` | Another PostgreSQL uses port 5432 | Stop it, or change the left side of `127.0.0.1:5432:5432` in `infra/local/compose.yaml` |
| `permission denied` in a test or query | You ran it as the application role without the right identity | That is the database refusing, as designed; see below |

## How the database knows who is asking

The application connects as the role `sms_app`. That role is not a superuser, owns nothing and cannot
switch row-level security off. At the start of each request the application tells the database who is
asking, inside the request's transaction (`apps/core-api/src/kernel/db/context.ts`):

```
select set_config('app.user_id', '<the staff member id>', true), set_config('app.role', '<their role>', true)
```

The policies read those two settings. If they are missing, no row is visible and nothing can be
written. To see it yourself in `npm run db:psql`:

```
set role sms_app;
select count(*) from platform.users;                 -- 0: no identity, no rows
begin;
select set_config('app.user_id', '00000000-0000-4000-8000-000000000002', true), set_config('app.role', 'attache', true);
select email from platform.users;                    -- only the attache's own row
commit;
reset role;
```

## Pointing the commands at another database

By default the commands connect to `127.0.0.1:5432` as the user `sms` with no password, which is the
container of `npm run db:up`. To use another PostgreSQL, set the usual variables: `PGHOST`, `PGPORT`,
`PGUSER`, `PGDATABASE`, and `PGPASSWORD` (or `PGPASSWORD_FILE`, the path of a file that holds the
password). `npm run db:reset` refuses to touch a database that is not on your own computer unless you also
set `SMS_ALLOW_REMOTE_RESET=yes`. The old setting `SMS_DB_MODE` no longer exists: the commands no longer
go through `psql`, so there is nothing to choose.

## Running the database tests

`npm test` includes tests of the policies and of the migration runner that need a real PostgreSQL. They
look for a server in this order: the one named by `PGHOST`; PostgreSQL programs installed on your
computer (they start a temporary server of their own); the local container, when it is running and
`SMS_TEST_DB_MODE=docker` is set. They use a scratch database that is dropped afterwards, never your
development data. When none is found they are skipped, with a message. In GitHub they cannot be
skipped (`SMS_REQUIRE_DB=yes`).

On Windows or macOS with only Docker, run:

```
npm run db:up
set SMS_TEST_DB_MODE=docker&& npm test            (Windows, Command Prompt)
$env:SMS_TEST_DB_MODE="docker"; npm test          (Windows, PowerShell)
SMS_TEST_DB_MODE=docker npm test                  (macOS and Linux)
```
