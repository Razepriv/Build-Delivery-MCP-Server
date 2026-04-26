import { describe, it, expect } from "vitest";
import { redactWebhook as redactDiscord } from "../../src/delivery/discord.js";
import { redactWebhook as redactTeams } from "../../src/delivery/teams.js";

describe("redactWebhook (Discord)", () => {
  it("strips the secret token segment of a Discord webhook URL", () => {
    const url =
      "https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKl-secret-do-not-leak";
    const redacted = redactDiscord(url);
    expect(redacted).not.toContain("secret");
    expect(redacted).toContain("123456789012345678");
    expect(redacted.endsWith("/…")).toBe(true);
  });

  it("falls back gracefully on non-URL input", () => {
    expect(redactDiscord("not-a-url").endsWith("…")).toBe(true);
  });
});

describe("redactWebhook (Teams)", () => {
  it("strips the secret path segments of a Teams webhook URL", () => {
    const url =
      "https://outlook.office.com/webhook/abc-1234-tenant/IncomingWebhook/abcdef-secret/00000";
    const redacted = redactTeams(url);
    expect(redacted).not.toContain("secret");
    expect(redacted.endsWith("/…")).toBe(true);
  });
});
