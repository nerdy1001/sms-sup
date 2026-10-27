import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

/**
 * Runs the real scripts of infra/staging/bin against a fake docker and a fake tailscale that only
 * record what they were asked to do. This tests the logic of the scripts (validation, order of
 * steps, rollback), not Docker itself.
 */

const BIN = resolve("infra/staging/bin");
const SHA1 = "1".repeat(40);
const SHA2 = "2".repeat(40);
const SHA3 = "3".repeat(40);

const FAKE_DOCKER = `#!/usr/bin/env bash
echo "docker[$APP_VERSION] $*" >> "$FAKE_LOG"
case "$*" in
  *"config --images"*) printf 'caddy:2.10.0-alpine\\nminesup/core-api:%s\\n' "$APP_VERSION" ;;
  "manifest inspect "*) [ "$3" = "\${FAKE_MISSING_IMAGE:-}" ] && exit 1; exit 0 ;;
  *" up "*) [ -n "\${FAKE_FAIL_VERSION:-}" ] && [ "$APP_VERSION" = "$FAKE_FAIL_VERSION" ] && exit 1; exit 0 ;;
  *"exec -T core-api wget"*) printf '{"status":"ok","version":"%s"}' "\${FAKE_SERVED:-$APP_VERSION}" ;;
  "ps -q"*) echo "container1" ;;
  *"pg_dump"*) echo "DUMPDATA" ;;
  *"psql"*"-tAc"*) echo "3" ;;
esac
exit 0
`;
const FAKE_TAILSCALE = `#!/usr/bin/env bash
echo "\${FAKE_TAILSCALE_IP-100.64.0.1}"
`;

let dir = "";
let root = "";
let backups = "";
let log = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "staging-scripts-"));
  root = join(dir, "opt");
  backups = join(dir, "backups");
  log = join(dir, "docker.log");
  mkdirSync(join(root, "releases"), { recursive: true });
  writeFileSync(join(root, ".env"), "STAGING_HOSTNAME=x.ts.net\n");
  writeFileSync(log, "");
  const fakes = join(dir, "fakes");
  mkdirSync(fakes);
  writeFileSync(join(fakes, "docker"), FAKE_DOCKER);
  writeFileSync(join(fakes, "tailscale"), FAKE_TAILSCALE);
  chmodSync(join(fakes, "docker"), 0o755);
  chmodSync(join(fakes, "tailscale"), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(script: string, args: string[], options: { command?: string; input?: Buffer; env?: Record<string, string> } = {}) {
  return spawnSync("bash", [join(BIN, script), ...args], {
    input: options.input,
    encoding: "utf8",
    env: {
      PATH: `${join(dir, "fakes")}:${process.env.PATH ?? ""}`,
      STAGING_ROOT: root,
      STAGING_BACKUP_DIR: backups,
      FAKE_LOG: log,
      ...(options.command === undefined ? {} : { SSH_ORIGINAL_COMMAND: options.command }),
      ...options.env,
    },
  });
}

function makeUpload(files: Record<string, string> = { "compose.yaml": "services: {}\n", Caddyfile: "{}\n", "image.tar.gz": "IMAGE" }, extra?: (folder: string) => void): Buffer {
  const folder = mkdtempSync(join(dir, "upload-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(folder, name), content);
  extra?.(folder);
  const names = spawnSync("ls", ["-A", folder], { encoding: "utf8" }).stdout.split("\n").filter((name) => name !== "");
  const packed = spawnSync("tar", ["-C", folder, "-cf", "-", ...names], { maxBuffer: 1 << 20 });
  return packed.stdout;
}
const deploy = (sha: string, upload = makeUpload(), env: Record<string, string> = {}) => run("staging-deploy.sh", [], { command: `deploy ${sha}`, input: upload, env });
const state = (name: string): string => (existsSync(join(root, name)) ? readFileSync(join(root, name), "utf8").trim() : "");
const logText = (): string => readFileSync(log, "utf8");

describe("staging-deploy: what the deploy key may do", () => {
  test("an unknown command is refused", () => {
    const result = run("staging-deploy.sh", [], { command: "bash -c 'id'" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown command/);
  });

  test("no command (an interactive login attempt) is refused", () => {
    assert.equal(run("staging-deploy.sh", []).status, 1);
  });

  test("a version that is not a 40 character commit id is refused", () => {
    for (const bad of ["latest", "../../etc", "ABC", "1".repeat(39), `${SHA1}; id`]) {
      const result = deploy(bad);
      assert.equal(result.status, 1, bad);
    }
    assert.equal(logText(), "");
  });

  test("an upload with an extra file is refused before anything runs", () => {
    const result = deploy(SHA1, makeUpload({ "compose.yaml": "x", Caddyfile: "x", "image.tar.gz": "x", "evil.sh": "x" }));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /exactly/);
    assert.ok(!logText().includes("up"));
  });

  test("an upload with a missing file is refused", () => {
    assert.equal(deploy(SHA1, makeUpload({ "compose.yaml": "x", Caddyfile: "x" })).status, 1);
  });

  test("an upload that contains a link is refused", () => {
    const upload = makeUpload({ "compose.yaml": "x", Caddyfile: "x", "image.tar.gz": "x" }, (folder) => {
      rmSync(join(folder, "Caddyfile"));
      symlinkSync("/etc/passwd", join(folder, "Caddyfile"));
    });
    const result = deploy(SHA1, upload);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /regular files/);
  });

  test("a second deployment at the same time is refused", () => {
    // The outer shell takes the lock and stays alive while the script runs, as a running deployment would.
    const script = join(BIN, "staging-deploy.sh");
    const holder = spawnSync("bash", ["-c", `exec 9>"${join(root, ".lock")}"; flock -n 9; bash "${script}"; code=$?; exit $code`], {
      env: { PATH: process.env.PATH ?? "", STAGING_ROOT: root, SSH_ORIGINAL_COMMAND: "status" },
      encoding: "utf8",
    });
    assert.equal(holder.status, 1);
    assert.match(holder.stderr, /another deployment/);
  });
});

describe("staging-deploy: deploying", () => {
  test("a first deployment loads the image, checks the registries, starts the services and records the version", () => {
    const result = deploy(SHA1);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`deployed ${SHA1}`));
    assert.equal(state("current"), SHA1);
    const text = logText();
    assert.match(text, /docker\[\] load -i/);
    assert.match(text, /manifest inspect caddy:2\.10\.0-alpine/);
    assert.ok(!text.includes("manifest inspect minesup/"));
    assert.match(text, new RegExp(`docker\\[${SHA1}\\] compose .* up -d --remove-orphans --wait`));
    assert.ok(text.indexOf("load -i") < text.indexOf(" up -d"));
  });

  test("the services are given the Tailscale address", () => {
    const result = deploy(SHA1);
    assert.equal(result.status, 0, result.stderr);
  });

  test("a second deployment remembers the first as the previous release", () => {
    assert.equal(deploy(SHA1).status, 0);
    assert.equal(deploy(SHA2).status, 0);
    assert.equal(state("current"), SHA2);
    assert.equal(state("previous"), SHA1);
  });

  test("redeploying the same version does not make it its own previous release", () => {
    assert.equal(deploy(SHA1).status, 0);
    assert.equal(deploy(SHA1).status, 0);
    assert.equal(state("previous"), "");
  });

  test("a version that fails to start is rolled back and reported as a failure", () => {
    assert.equal(deploy(SHA1).status, 0);
    const result = deploy(SHA2, makeUpload(), { FAKE_FAIL_VERSION: SHA2 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /rolled back/);
    assert.equal(state("current"), SHA1);
    assert.match(logText(), new RegExp(`docker\\[${SHA1}\\] compose .* up .*\\n[^]*docker\\[${SHA2}\\] compose .* up .*\\n[^]*docker\\[${SHA1}\\] compose .* up`));
  });

  test("a version that starts but is not the one answering counts as a failure", () => {
    assert.equal(deploy(SHA1).status, 0);
    const result = deploy(SHA2, makeUpload(), { FAKE_SERVED: SHA1 });
    assert.equal(result.status, 1);
    assert.equal(state("current"), SHA1);
  });

  test("a first deployment that fails leaves no current version", () => {
    const result = deploy(SHA1, makeUpload(), { FAKE_FAIL_VERSION: SHA1 });
    assert.equal(result.status, 1);
    assert.equal(state("current"), "");
  });

  test("an image that does not exist in its registry stops the deployment before anything starts", () => {
    const result = deploy(SHA1, makeUpload(), { FAKE_MISSING_IMAGE: "caddy:2.10.0-alpine" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not exist in its registry/);
    assert.ok(!logText().includes(" up "));
    assert.equal(state("current"), "");
  });

  test("a server without a Tailscale address stops the deployment", () => {
    const result = deploy(SHA1, makeUpload(), { FAKE_TAILSCALE_IP: "" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Tailscale/);
  });

  test("only the five newest releases are kept", () => {
    const versions = ["a", "b", "c", "d", "e", "f", "9"].map((letter) => letter.repeat(40));
    versions.forEach((version, index) => {
      assert.equal(deploy(version).status, 0);
      // Give every release folder a distinct age, as it would have on a real server.
      const when = new Date(Date.now() - (versions.length - index) * 60_000);
      utimesSync(join(root, "releases", version), when, when);
    });
    const kept = spawnSync("ls", [join(root, "releases")], { encoding: "utf8" }).stdout.trim().split("\n");
    assert.equal(kept.length, 5);
    assert.ok(!kept.includes(versions[0] ?? ""));
    assert.ok(kept.includes(versions[6] ?? ""));
  });
});

describe("staging-deploy: rollback and status", () => {
  test("rollback goes back to the previous release and swaps them", () => {
    deploy(SHA1);
    deploy(SHA2);
    const result = run("staging-deploy.sh", [], { command: "rollback" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(state("current"), SHA1);
    assert.equal(state("previous"), SHA2);
  });

  test("rollback without a previous release is refused", () => {
    deploy(SHA1);
    const result = run("staging-deploy.sh", [], { command: "rollback" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no previous release/);
  });

  test("a rollback that does not come up leaves the records unchanged", () => {
    deploy(SHA1);
    deploy(SHA2);
    const result = run("staging-deploy.sh", [], { command: "rollback", env: { FAKE_FAIL_VERSION: SHA1 } });
    assert.notEqual(result.status, 0);
    assert.equal(state("current"), SHA2);
  });

  test("status shows both versions", () => {
    deploy(SHA1);
    deploy(SHA2);
    const result = run("staging-deploy.sh", [], { command: "status" });
    assert.match(result.stdout, new RegExp(`current:  ${SHA2}`));
    assert.match(result.stdout, new RegExp(`previous: ${SHA1}`));
  });

  test("the third deployment shifts the records along", () => {
    deploy(SHA1);
    deploy(SHA2);
    deploy(SHA3);
    assert.equal(state("current"), SHA3);
    assert.equal(state("previous"), SHA2);
  });
});

describe("backup.sh", () => {
  test("writes a dump, readable only by its owner, and removes dumps older than 7 days", () => {
    mkdirSync(backups, { recursive: true });
    const old = join(backups, "sms-20200101T000000Z.dump");
    const recent = join(backups, "sms-recent.dump");
    writeFileSync(old, "x");
    writeFileSync(recent, "x");
    const longAgo = new Date(Date.now() - 10 * 86_400_000);
    utimesSync(old, longAgo, longAgo);
    const result = run("backup.sh", []);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!existsSync(old));
    assert.ok(existsSync(recent));
    const fresh = spawnSync("ls", [backups], { encoding: "utf8" }).stdout.split("\n").filter((name) => /^sms-\d{8}T\d{6}Z\.dump$/.test(name));
    assert.equal(fresh.length, 1);
    assert.equal(readFileSync(join(backups, fresh[0] ?? ""), "utf8").trim(), "DUMPDATA");
    assert.equal(statSync(join(backups, fresh[0] ?? "")).mode & 0o077, 0);
    assert.ok(!spawnSync("ls", [backups], { encoding: "utf8" }).stdout.includes("partial"));
  });
});

describe("restore.sh", () => {
  test("verify restores the newest backup into a scratch database and deletes it", () => {
    mkdirSync(backups, { recursive: true });
    writeFileSync(join(backups, "sms-1.dump"), "x");
    const result = run("restore.sh", ["verify"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /with 3 table\(s\)/);
    assert.match(logText(), /DROP DATABASE restore_check/);
  });

  test("verify fails when there is no backup", () => {
    const result = run("restore.sh", ["verify"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no backup/);
  });

  test("apply refuses to run without the word yes", () => {
    mkdirSync(backups, { recursive: true });
    writeFileSync(join(backups, "sms-1.dump"), "x");
    const result = run("restore.sh", ["apply", join(backups, "sms-1.dump")]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Add the word yes/);
    assert.ok(!logText().includes("--clean"));
  });

  test("apply restores over the staging database when confirmed", () => {
    mkdirSync(backups, { recursive: true });
    writeFileSync(join(backups, "sms-1.dump"), "x");
    const result = run("restore.sh", ["apply", join(backups, "sms-1.dump"), "yes"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(logText(), /pg_restore .* --clean/);
  });

  test("an unknown action prints the usage", () => {
    assert.equal(run("restore.sh", ["wipe"]).status, 1);
  });
});

describe("init-staging.sh", () => {
  test("creates the settings and a database password that nobody else can read from the folder", () => {
    const result = run("init-staging.sh", ["sms-staging.tail1234.ts.net"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(root, ".env"), "utf8"), "STAGING_HOSTNAME=sms-staging.tail1234.ts.net\n");
    assert.ok(readFileSync(join(root, "secrets", "postgres_password"), "utf8").length >= 32);
    assert.equal(statSync(join(root, "secrets")).mode & 0o077, 0);
  });

  test("running it again keeps the same password", () => {
    run("init-staging.sh", ["a.tail1.ts.net"]);
    const first = readFileSync(join(root, "secrets", "postgres_password"), "utf8");
    run("init-staging.sh", ["b.tail1.ts.net"]);
    assert.equal(readFileSync(join(root, "secrets", "postgres_password"), "utf8"), first);
    assert.match(readFileSync(join(root, ".env"), "utf8"), /b\.tail1\.ts\.net/);
  });

  test("a name that is not a Tailscale name is refused", () => {
    for (const bad of ["", "example.com", "x.ts.net.evil.com", "UPPER.ts.net", "a b.ts.net"]) {
      const result = run("init-staging.sh", bad === "" ? [] : [bad]);
      assert.equal(result.status, 1, bad);
    }
  });
});
