import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { checkInfra } from "./infra.ts";
import { createProject, type Project } from "../test-support/project.ts";

let project: Project | undefined;
afterEach(() => {
  project?.cleanup();
  project = undefined;
});

const COMPOSE = "infra/staging/compose.yaml";
const rules = (files: Record<string, string>): string[] => {
  project = createProject(files);
  return checkInfra(project.root).findings.map((item) => item.rule);
};
const compose = (body: string): Record<string, string> => ({ [COMPOSE]: `services:\n  app:\n${body}` });

test("a project without infrastructure files passes", () => {
  assert.deepEqual(rules({}), []);
});

test("a careful compose file passes", () => {
  const body = [
    "    image: postgres:17.5-alpine",
    "    ports:",
    '      - "${TAILSCALE_IP}:443:443"',
    '      - "127.0.0.1:5432:5432"',
    "    cap_drop: [ALL]",
    "    cap_add: [NET_BIND_SERVICE]",
    "    environment:",
    "      POSTGRES_PASSWORD_FILE: /run/secrets/pw",
    "      POSTGRES_PASSWORD: ${FROM_ENV}",
    "      POSTGRES_USER: sms",
    "  mine:",
    "    image: minesup/core-api:${APP_VERSION}",
    "",
  ].join("\n");
  assert.deepEqual(rules(compose(body)), []);
});

describe("images", () => {
  const cases: [string, string, boolean][] = [
    ["a full version", "postgres:17.5-alpine", true],
    ["major and minor", "caddy:2.10-alpine", true],
    ["a digest", "postgres@sha256:" + "a".repeat(64), true],
    ["a version with a v", "axllent/mailpit:v1.27.7", true],
    ["latest", "postgres:latest", false],
    ["no tag", "postgres", false],
    ["only a major version", "node:22-alpine", false],
    ["a registry with a port and no tag", "registry.example.com:5000/app", false],
  ];
  for (const [name, image, allowed] of cases) {
    test(`${name}: ${image}`, () => {
      assert.deepEqual(rules(compose(`    image: ${image}\n`)), allowed ? [] : ["infra-image-tag"]);
    });
  }

  test("images built by this repository are exempt", () => {
    assert.deepEqual(rules(compose("    image: minesup/core-api:abc\n")), []);
  });

  test("the base image of a Dockerfile is checked, a build stage is not", () => {
    assert.deepEqual(rules({ "apps/core-api/Dockerfile": "FROM node:22.23.4-alpine AS build\nFROM build\n" }), []);
    assert.deepEqual(rules({ "apps/core-api/Dockerfile": "FROM node:alpine\n" }), ["infra-image-tag"]);
    assert.deepEqual(rules({ "apps/core-api/Dockerfile": "FROM scratch\n" }), []);
  });
});

describe("compose rules", () => {
  const cases: [string, string, string][] = [
    ["a port without an address", "infra-port-binding", '    ports:\n      - "8080:80"\n'],
    ["a port on every address", "infra-port-binding", '    ports:\n      - "0.0.0.0:8080:80"\n'],
    ["an inline port list", "infra-port-binding", '    ports: ["8080:80"]\n'],
    ["a privileged container", "infra-privileged", "    privileged: true\n"],
    ["the host network", "infra-privileged", "    network_mode: host\n"],
    ["the host process space", "infra-privileged", "    pid: host\n"],
    ["the Docker socket", "infra-privileged", "    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n"],
    ["a dangerous capability, inline", "infra-capability", "    cap_add: [SYS_ADMIN]\n"],
    ["a dangerous capability, as a list", "infra-capability", "    cap_add:\n      - NET_ADMIN\n"],
    ["a password written in the file", "infra-literal-secret", "    environment:\n      DB_PASSWORD: hunter2hunter2\n"],
    ["a token written as a list entry", "infra-literal-secret", "    environment:\n      - API_TOKEN=abc\n"],
  ];
  for (const [name, rule, body] of cases) {
    test(name, () => {
      assert.deepEqual(rules(compose(`    image: postgres:17.5\n${body}`)), [rule]);
    });
  }

  test("dropping every capability is fine", () => {
    assert.deepEqual(rules(compose("    image: postgres:17.5\n    cap_drop: [ALL]\n    cap_drop:\n      - ALL\n")), []);
  });

  test("a block ends where its indentation ends", () => {
    const body = '    image: postgres:17.5\n    ports:\n      - "127.0.0.1:1:1"\n    labels:\n      - "8080:80"\n';
    assert.deepEqual(rules(compose(body)), []);
  });
});

describe("references to production", () => {
  test("a production host name in staging is reported", () => {
    assert.deepEqual(rules({ "infra/staging/Caddyfile": "scholarships.minesup.gov.cm {\n}\n" }), ["infra-forbidden-reference"]);
    assert.deepEqual(rules({ "infra/staging/compose.yaml": "services:\n  a:\n    environment:\n      HOST: db.prod.internal\n" }), ["infra-forbidden-reference"]);
  });

  test("a comment may talk about production", () => {
    assert.deepEqual(rules({ "infra/staging/Caddyfile": "# Never the production server\n{\n}\n" }), []);
  });
});

describe("shell scripts", () => {
  test("a strict script passes", () => {
    assert.deepEqual(rules({ "infra/staging/bin/a.sh": "#!/usr/bin/env bash\nset -euo pipefail\necho hi\n" }), []);
  });

  test("a script without strict mode is reported", () => {
    assert.deepEqual(rules({ "infra/staging/bin/a.sh": "#!/usr/bin/env bash\necho hi\n" }), ["infra-script-strict"]);
  });

  test("a download piped into a shell is reported", () => {
    const script = "#!/usr/bin/env bash\nset -euo pipefail\ncurl -fsSL https://example.com/install.sh | sh\n";
    assert.deepEqual(rules({ "infra/staging/bin/a.sh": script }), ["infra-pipe-to-shell"]);
    assert.deepEqual(rules({ "infra/staging/bin/a.sh": script.replace("| sh", "| sudo bash") }), ["infra-pipe-to-shell"]);
  });
});

describe("generated server file", () => {
  const TEMPLATE = 'users:\n  - name: deploy\n    ssh_authorized_keys:\n      - \'restrict,command="/opt/staging/bin/x.sh" __DEPLOY_PUBLIC_KEY__\'\nfiles:\n  - content: |\n      {{file:infra/staging/bin/x.sh}}\n';
  const SCRIPT = "set -euo pipefail\necho hi\n";
  const files = (rendered?: string): Record<string, string> => ({
    "infra/staging/cloud-init.template.yaml": TEMPLATE,
    "infra/staging/bin/x.sh": SCRIPT,
    ...(rendered === undefined ? {} : { "infra/staging/cloud-init.yaml": rendered }),
  });
  const RENDERED = TEMPLATE.replace("      {{file:infra/staging/bin/x.sh}}", "      set -euo pipefail\n      echo hi");

  test("an up to date rendered file passes", () => {
    assert.deepEqual(rules(files(RENDERED)), []);
  });

  test("a missing or stale rendered file is reported", () => {
    assert.deepEqual(rules(files()), ["infra-cloud-init-stale"]);
    assert.deepEqual(rules(files(RENDERED.replace("echo hi", "echo changed"))), ["infra-cloud-init-stale"]);
  });

  test("a script that changed after rendering makes the file stale", () => {
    const changed = files(RENDERED);
    changed["infra/staging/bin/x.sh"] = "set -euo pipefail\necho changed\n";
    assert.deepEqual(rules(changed), ["infra-cloud-init-stale"]);
  });

  test("a template that includes a missing file is reported, not a crash", () => {
    const broken = files(RENDERED);
    broken["infra/staging/cloud-init.template.yaml"] = TEMPLATE.replace("x.sh}}", "missing.sh}}");
    assert.deepEqual(rules(broken), ["infra-cloud-init-stale"]);
  });

  test("a deploy key without restrictions is reported", () => {
    const loose = TEMPLATE.replace('restrict,command="/opt/staging/bin/x.sh" ', "");
    const found = rules({ "infra/staging/cloud-init.template.yaml": loose, "infra/staging/bin/x.sh": SCRIPT, "infra/staging/cloud-init.yaml": loose.replace("      {{file:infra/staging/bin/x.sh}}", "      set -euo pipefail\n      echo hi") });
    assert.deepEqual(found, ["infra-deploy-key-unrestricted"]);
  });
});
