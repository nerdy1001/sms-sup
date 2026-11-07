# Runbook: the staging server

How to create the staging server, connect it to GitHub, check that it works, and operate it. Written
for one person doing it once, with a terminal and a web browser. Every command is meant to be copied.
Nothing here has been run yet (see [FN-03](../tasks/FN-03.md), known gaps), so the first run is a test of
this page too: when a step does not behave as written, stop and send the exact output.

Names used below: `<IP>` is the public address of the server. `<NAME>` is its Tailscale name, for
example `sms-staging.tail1234.ts.net`.

## What you will have at the end

- One small server on DigitalOcean, set up from a single file, with only SSH open to the internet.
- A private network (Tailscale) between your computer and the server.
- Staging reachable at `https://<NAME>/health` from your computer only.
- A mail catcher at `https://<NAME>:8025`, showing the emails staging would have sent.
- Every merge to `main` that passes all checks deployed to it by GitHub, with one-command rollback.
- A nightly database backup, checked every night by restoring it into a scratch database.

## Part A. On your computer (about 15 minutes)

**A1. Make the deploy key.** It lets GitHub deploy and do nothing else. It has no passphrase because
GitHub has to use it unattended.

```
ssh-keygen -t ed25519 -f ~/.ssh/sms_staging_deploy -C "sms-staging-deploy" -N ""
```

This creates `~/.ssh/sms_staging_deploy` (private, goes into GitHub) and
`~/.ssh/sms_staging_deploy.pub` (public, goes into the server).

**A2. Know your own key.** You log in to the server as `admin` with your normal SSH key. Show its public
half with `cat ~/.ssh/id_ed25519.pub`. If the file does not exist, create one with
`ssh-keygen -t ed25519 -C "your-email"` and use a passphrase this time.

**A3. Create the Tailscale account** at tailscale.com (the free personal plan; check the current limits
on their pricing page). Install Tailscale on your computer and sign in. Then, in the admin console, under
**DNS**, turn on **MagicDNS** and **HTTPS Certificates**. Staging cannot get its certificate until HTTPS
Certificates is on. Note the name of your tailnet (it looks like `tail1234.ts.net`).

**A4. Prepare the server file.** Copy `infra/staging/cloud-init.yaml` to a place outside the repository
(for example your desktop) and edit the copy:

1. Replace `__ADMIN_PUBLIC_KEY__` with the whole line from `~/.ssh/id_ed25519.pub`.
2. Replace `__DEPLOY_PUBLIC_KEY__` with the whole line from `~/.ssh/sms_staging_deploy.pub`. Keep the text
   `restrict,command="/opt/staging/bin/staging-deploy.sh"` in front of it exactly as it is.

Do not commit the edited copy.

## Part B. Create the server on DigitalOcean (about 10 minutes)

1. **Create > Droplets.**
2. Region: **Frankfurt** or **Amsterdam** (closest to Cameroon with good prices; any European region works).
3. Image: **Ubuntu 24.04 (LTS) x64**. It must be x86, not ARM.
4. Size: **Basic**, **Regular**, **1 vCPU, 2 GB memory**. As far as I know this costs about 12 US dollars
   a month; check the price on the page. Staging with synthetic data fits; move up one size only if the
   server runs out of memory.
5. Authentication: **SSH Key**, and add your own public key from A2.
6. **Advanced options**, tick **Add initialization scripts (free)** and paste the whole edited file from A4.
7. Hostname: `sms-staging`. Leave backups off (the nightly database backup is separate and free).
8. Create the droplet and note its public IP address as `<IP>`.
9. **Networking > Firewalls > Create Firewall.** Inbound rules: **SSH (TCP 22)** from all IPv4 and IPv6
   and nothing else. Outbound: leave the defaults. Apply it to the droplet. This is a second wall behind
   the one the server builds for itself.

Wait about five minutes for the first start to finish. Then:

```
ssh admin@<IP>
cloud-init status --wait
ls /opt/staging/.cloud-init-done
```

Expected: `status: done`, and the file is listed. If `cloud-init status` says `error`, read
`sudo cat /var/log/cloud-init-output.log` and send me the last 40 lines.

## Part C. Join the private network (about 5 minutes)

On the server, as `admin`:

```
sudo tailscale up --hostname=sms-staging
```

It prints a web address. Open it on your computer and approve the machine. Then:

```
tailscale status
```

The line for `sms-staging` shows its address. Find its full name in the Tailscale admin console under
**Machines** (it ends in `.ts.net`) and write it down as `<NAME>`. In the same console, open the menu of
the machine and choose **Disable key expiry**. If you skip this, the server drops off your network after
about six months.

Now give the server its settings:

```
sudo /opt/staging/bin/init-staging.sh <NAME>
```

This creates two database passwords on the server (they exist nowhere else) and the settings file. One
password belongs to the owner of the database, the other to the role the application uses.

## Part D. Connect GitHub (about 10 minutes)

**D1. Check the server's fingerprint before trusting it.** On the server:

```
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

On your computer:

```
ssh-keyscan -t ed25519 <IP> | tee /tmp/staging_host_key | ssh-keygen -lf -
```

The two fingerprints (the part starting `SHA256:`) must be identical. If they differ, stop: something is
between you and the server.

**D2. Add three entries to the repository**, under **Settings > Secrets and variables > Actions**:

| Kind | Name | Value |
|---|---|---|
| Secret | `STAGING_SSH_KEY` | The whole content of `~/.ssh/sms_staging_deploy` (the private key, including the BEGIN and END lines) |
| Variable | `STAGING_HOST` | `<IP>` |
| Variable | `STAGING_HOST_KEY` | The content of `/tmp/staging_host_key` (one line starting with the IP address) |

The deploy job runs only when `STAGING_HOST` exists, so nothing deploys until you add it. Add it last.

**D3. Deploy.** Merge anything to `main`, or open **Actions**, choose the latest `ci` run on `main` and
**Re-run all jobs**. The `deploy-staging` job builds the image, sends it to the server and starts it.

## Part E. Check that it works

From your computer (Tailscale running):

1. Open `https://<NAME>/health`. Expected: a small JSON answer with `"status":"ok"` and `"version"`
   equal to the commit that was deployed. Then open `https://<NAME>/ready`. Expected: `{"status":"ready"}`.
   That one asks the database, so it proves that the migration step ran and that the application can log
   in with its own password. If `/health` answers and `/ready` answers 503, read the migration output in the
   `deploy-staging` job and send it to me.
2. Open `https://<NAME>:8025`. Expected: the mail catcher page, empty.
3. From a computer or phone that is **not** on Tailscale, open the same addresses. Expected: they do not
   open. This is the test that matters most.
4. Check that only SSH is open to the world: `nc -zv -w 3 <IP> 443` should fail or time out, and
   `nc -zv -w 3 <IP> 22` should succeed.
5. Ask the deploy key for the status:
   `ssh -i ~/.ssh/sms_staging_deploy deploy@<IP> status` prints the current and previous commit. Any
   other command, for example `ssh -i ~/.ssh/sms_staging_deploy deploy@<IP> ls`, must be refused.
6. Check the backup works. On the server: `sudo /opt/staging/bin/backup.sh`, then
   `sudo /opt/staging/bin/restore.sh verify`. Expected: a line saying the backup was restored into a
   scratch database and the scratch database was deleted.

## Everyday use

| I want to | Do this |
|---|---|
| Deploy | Merge to `main`. The pipeline does the rest. |
| Go back to the previous version | `ssh -i ~/.ssh/sms_staging_deploy deploy@<IP> rollback` |
| See which version runs | `ssh -i ~/.ssh/sms_staging_deploy deploy@<IP> status` |
| Read the application log | On the server: `sudo docker logs staging-core-api-1 --tail 100` |
| See the containers | On the server: `sudo docker ps` |
| Read the emails staging sent | Open `https://<NAME>:8025` |
| List backups | On the server: `ls -l /var/backups/staging`; the log is `/var/log/staging-backup.log` |
| Run the migrations again by hand | On the server, as `admin`, from the folder of the current release: `sudo docker compose --env-file /opt/staging/.env -f /opt/staging/releases/<commit>/compose.yaml run --rm --no-deps migrate` (set `APP_VERSION=<commit>` and `TAILSCALE_IP=$(tailscale ip -4)` first). Safe to repeat. |
| Restore a backup | `sudo /opt/staging/bin/restore.sh apply /var/backups/staging/<file> yes` (replaces the data) |
| Rebuild the server from nothing | Destroy the droplet, delete the old machine in the Tailscale console, repeat parts B to D, and update `STAGING_HOST` and `STAGING_HOST_KEY` |

## When something fails

| What you see | Most likely cause | What to do |
|---|---|---|
| `cloud-init status` shows `error` | A line of the setup file failed, or a placeholder was left in | Read `/var/log/cloud-init-output.log`; send me the end of it |
| The deploy job: `Permission denied (publickey)` | The deploy public key in the server file does not match the private key in `STAGING_SSH_KEY` | Compare the two files from A1; recreate the droplet if the wrong key was pasted |
| The deploy job: `Host key verification failed` | `STAGING_HOST_KEY` is empty or belongs to another address | Redo D1 and D2 |
| `unknown command; use: deploy <commit>, rollback, status` | You tried a command the deploy key does not allow | That is correct behaviour; log in as `admin` for anything else |
| `the image ... does not exist in its registry` | An image tag in `infra/staging/compose.yaml` was chosen without being checked | Run `docker manifest inspect <image>` on the server to find a real tag, change it in the file, and open a pull request |
| `this server has no Tailscale address` | Part C was not done or the machine was removed | Run `sudo tailscale up --hostname=sms-staging` again |
| The page does not open, or the browser warns about the certificate | HTTPS Certificates is off in the Tailscale console, or Caddy cannot reach the Tailscale socket | Turn it on (A3); read `sudo docker logs staging-caddy-1`; send me the output. As a fallback, `tailscale serve` can terminate HTTPS instead of Caddy |
| `the database migration failed; version ... was not started` | A migration file has an error, or the database is unreachable | Read the lines above it in the job output. The previous version is still running and nothing new started. Fix the migration in a new commit; never edit one that has been applied |
| `The database has migrations that no file explains` | The server has a migration that this commit does not contain (for example you deployed an older commit) | Deploy a commit that contains it, or restore a backup taken before it |
| `version ... failed its health check` and `rolled back` | The new build does not start | Read the application log; the previous version is already running again |

Each deployment now runs the database migrations before the new version starts, and takes a backup first (except
the very first time). A rollback does not undo a migration, so every migration must also work for the version
before it; the rule is in [ADR 0005](../adr/0005-staging-environment.md), decision 10.

When you ask me for help, include: which part and step, the exact command, and the full output.

## Cost and cleanup

Staging costs one droplet per month. To stop paying, destroy the droplet in DigitalOcean. Nothing of
value is lost: the data is synthetic and the server can be rebuilt from this page. Also delete the machine
in the Tailscale console and remove the three entries from the GitHub settings.
