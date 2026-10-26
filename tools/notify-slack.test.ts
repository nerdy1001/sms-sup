import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildSlackPayload, isSlackWebhook } from "./notify-slack.ts";

const INPUT = { repository: "orchard/minesup-sms", workflow: "ci", ref: "main", actor: "akere", event: "push", runUrl: "https://github.com/orchard/minesup-sms/actions/runs/1" };

describe("buildSlackPayload", () => {
  test("names the workflow, branch, repository and links the run", () => {
    const { text } = buildSlackPayload(INPUT);
    assert.match(text, /"ci" failed on main in orchard\/minesup-sms/);
    assert.match(text, /<https:\/\/github\.com\/orchard\/minesup-sms\/actions\/runs\/1\|Open the run>/);
  });

  test("escapes Slack markup in values that someone else controls", () => {
    const { text } = buildSlackPayload({ ...INPUT, ref: "<!channel> & co", actor: "<@U123>" });
    assert.ok(!text.includes("<!channel>"));
    assert.ok(!text.includes("<@U123>"));
    assert.match(text, /&lt;!channel&gt; &amp; co/);
  });
});

describe("isSlackWebhook", () => {
  test("accepts Slack webhook addresses", () => {
    assert.equal(isSlackWebhook("https://hooks.slack.com/services/T000/B000/xyz"), true);
    assert.equal(isSlackWebhook("https://hooks.slack.com/workflows/T000/A000/xyz"), true);
  });

  test("rejects anything else", () => {
    for (const value of ["", "not a url", "http://hooks.slack.com/services/a", "https://example.com/services/a", "https://hooks.slack.com.evil.example/services/a", "https://hooks.slack.com/other/a"]) {
      assert.equal(isSlackWebhook(value), false, value);
    }
  });
});
