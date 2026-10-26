import { pathToFileURL } from "node:url";

export interface NotifyInput {
  readonly repository: string;
  readonly workflow: string;
  readonly ref: string;
  readonly actor: string;
  readonly event: string;
  readonly runUrl: string;
}

/** Slack treats &, < and > as markup. */
function escapeSlack(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function buildSlackPayload(input: NotifyInput): { text: string } {
  const lines = [
    `The workflow "${escapeSlack(input.workflow)}" failed on ${escapeSlack(input.ref)} in ${escapeSlack(input.repository)}.`,
    `Started by ${escapeSlack(input.actor)} (${escapeSlack(input.event)}).`,
    `<${input.runUrl}|Open the run>`,
  ];
  return { text: lines.join("\n") };
}

/** Only real Slack webhook addresses are accepted, so a wrong secret cannot send the message elsewhere. */
export function isSlackWebhook(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "hooks.slack.com" && /^\/(services|workflows)\//.test(url.pathname);
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL ?? "";
  if (webhook === "") {
    console.log("No SLACK_WEBHOOK_URL secret is set. Skipping the Slack message.");
    return;
  }
  if (!isSlackWebhook(webhook)) {
    console.log("SLACK_WEBHOOK_URL is not a Slack webhook address (https://hooks.slack.com/services/...). Nothing was sent.");
    process.exitCode = 1;
    return;
  }
  const env = process.env;
  const payload = buildSlackPayload({
    repository: env.GITHUB_REPOSITORY ?? "unknown repository",
    workflow: env.GITHUB_WORKFLOW ?? "unknown workflow",
    ref: env.GITHUB_REF_NAME ?? "unknown ref",
    actor: env.GITHUB_ACTOR ?? "unknown",
    event: env.GITHUB_EVENT_NAME ?? "unknown",
    runUrl: `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY ?? ""}/actions/runs/${env.GITHUB_RUN_ID ?? ""}`,
  });
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    console.log(`Slack answered with status ${response.status}. The message was not delivered.`);
    process.exitCode = 1;
    return;
  }
  console.log("Slack message sent.");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.log("The Slack message could not be sent (network error).");
    process.exitCode = 1;
  });
}
