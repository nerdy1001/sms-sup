# ADR 0005: Staging on one server behind a private network, deployed over a restricted SSH key

Status: accepted (2026-10-27, task FN-03)

## Context

The plan needs a staging environment for the core zone before the first milestone: somewhere to run the
application with synthetic data, show it to the Ministry, and rehearse deployments. The constraints that
shaped it:

- One developer, who pays for staging personally (no budget from the Ministry).
- A tension in the architecture: the core is never reachable from the internet in production, yet a
  demonstration needs someone to reach it.
- No domain name yet.
- The environment that built this has no Docker daemon, no network and no server, so nothing here could
  be run end to end before delivery.

## Decision

1. **One virtual server, set up from one file.** A DigitalOcean droplet configured by cloud-init. The
   file is generated from a template and from the scripts, so each script exists once, and a check fails
   when the generated file is out of date. Any provider that accepts a cloud-init file works.
2. **Docker Compose, not Terraform or Kubernetes.** The whole environment is four containers. Compose
   is readable in one sitting and one person can keep it running. Terraform would add a second tool to
   learn for a server that is created once; Kubernetes would be a system to operate in order to run four
   containers.
3. **Reachable only through Tailscale.** Staging has no public web port. The reverse proxy (Caddy) is
   bound to the Tailscale address and obtains its HTTPS certificate from the local Tailscale, so no domain
   is needed and secure cookies still work. This mirrors the production rule that nobody reaches the core
   directly. When Ministry staff need access, they join the same network or the access method changes in
   one file.
4. **Deployment by SSH with a forced command.** GitHub sends the image and the configuration over SSH to
   a `deploy` user whose key can run one script and nothing else (`restrict,command=`). The script accepts
   `deploy <commit>`, `rollback` and `status`, validates the upload, starts the new version, proves that
   the new version is the one answering, and rolls back by itself if it is not. SSH is the only port open
   to the internet; the alternative was to join the GitHub runner to the private network with a
   third-party action, which could not be verified here.
5. **No image registry.** The pipeline builds the image, saves it as a file and sends it. This avoids a
   registry account and a stored registry password.
6. **Ports are always bound to an address.** Docker publishes ports through its own firewall rules, around
   the server firewall, so a port written without an address is open to the world. A check rejects it.
7. **Containers get no way out unless they need one.** Only the reverse proxy is on a network with
   internet access. The application, database and mail catcher sit on internal networks, so the mail
   catcher cannot send real email and the application cannot call out.
8. **Secrets are made on the server.** The database password is generated on the server and never exists
   in the repository, in GitHub, or on any other machine. The only secret in GitHub is the deploy key.
9. **A placeholder service proves the path.** The application had no web server until FN-05, so FN-03
   deployed the smallest possible one (a health endpoint), placed where the real server would live. FN-05
   replaced it with the real application; `/health` still answers with the version, as the deploy script expects.
10. **The database is migrated by the deployment, from the image about to start.** Added after FN-05.
    - **How.** After it loads the image, `staging-deploy.sh` starts only the database service, takes a backup
      (except on the very first deployment, when there is nothing to copy), and runs a one-off container
      (`migrate` in the Compose file, in the `tools` profile so that `up` never starts it) made from the new
      image. It runs `node tools/db/cli.ts provision`: apply the pending migrations as the database owner, then
      give the application role its password. Only then does the new version start. If the migration fails,
      nothing new starts and the running version is not touched.
    - **Why from the image.** The image already holds the migration files that belong to that exact commit, so
      the files and the code cannot drift apart, and nothing has to be copied to the server or installed on it.
      The runner uses the `pg` driver instead of `psql`, so the image needs no extra program. Only `tools/db`
      and one helper are copied into the image, not the rest of `tools/`.
    - **Two passwords.** The owner of the database (used by `postgres` and by the migration job) and the
      application role `sms_app` have different passwords, both made on the server by `init-staging.sh`. The
      running application can read only its own. A flaw in the application therefore does not hand over the
      power to change the structure of the database or switch off row-level security.
    - **Rollback does not migrate.** Going back to the previous release starts the old image against a database
      that has already moved forward, and the old image does not contain the newest migration files (the runner
      would refuse it for that reason). So the old version has to work with the new structure. The rule for
      every migration is: add before you remove. A new column is added in one release and the code starts using
      it in the same or a later one; a column is dropped only in a release after nothing reads it. The backup
      taken just before is the way out of a migration that was wrong for both versions.
    - **Not covered.** Seeds are not run on staging by this step. The synthetic data of staging is task FN-08.

## Consequences

- **Anyone with the deploy key has root on the staging server.** The key can run only one script, but
  the script starts whatever configuration it receives, and starting containers is root power. This is
  acceptable because staging holds synthetic data and no production secret. It is not an acceptable design
  for production, which will use FN-10 (vault) and FN-11 (zones) and deploy differently.
- **Staging depends on a third party (Tailscale)** for its private network and its certificate. If that
  service is unavailable, staging is unreachable, though still running. Production will not use it.
- **Public SSH is exposed.** It is limited to key login, three attempts, a failed-login blocker, and two
  users. It is still an open door that a private-only setup would not have.
- **Image tags were chosen from memory and are not verified.** The deploy script checks that each image
  exists before changing anything, and Dependabot proposes updates, but a wrong tag shows up at the first
  deployment, not before.
- **A migration changes data that cannot be recovered by rolling back the code.** The backup before each
  migration limits the damage to the last night's changes at worst, on a server whose data is synthetic.
- **None of it has run.** The scripts were tested against a fake Docker. The server file, the Compose
  file's behaviour under a real Docker, the Tailscale certificate path and the pipeline job are untested
  until the first deployment.
- **It costs money every month** (about 12 US dollars for the smallest comfortable droplet, from memory),
  paid by the developer.

## When to revisit

- When Ministry staff need access to staging: add them to the network, or choose a domain and a different
  access method.
- When FN-10 and FN-11 arrive: replace the on-server password and the single deploy key with the vault and
  the zone design, for production first.
- When there is a second developer: add a rule that deployments need an approval, and move the deploy
  key out of one person's hands.
- If the server is ever used for anything with real data: stop and redesign. This environment is not built
  for it.
