import { describe, it, expect } from "vitest";
import {
  telegramCaption,
  whatsappCaption,
  slackCaption,
  discordCaption,
  emailTextBody,
  emailHtmlBody,
  teamsCard,
  type IntelPayload,
} from "../../src/delivery/captions.js";
import type { BuildMetadata } from "../../src/types.js";

const meta: BuildMetadata = {
  filePath: "/tmp/build.apk",
  fileSize: 1024 * 1024,
  appName: "Acme",
  packageName: "com.acme.app",
  versionName: "2.4.1",
  versionCode: "241",
  buildType: "release",
  source: "aapt2",
};

const intel: IntelPayload = {
  changelog: {
    fromRef: "v2.4.0",
    toRef: "v2.4.1",
    totalCommits: 1,
    groups: { feat: [{ sha: "abc1234", type: "feat", subject: "shiny thing" }] },
  },
  crashStats: {
    versionName: "2.4.0",
    crashFreeRate: 0.99,
    totalCrashes: 3,
    source: "file",
    fetchedAt: 0,
  },
  installUrl: "https://x.test/install/abc",
};

describe("captions with intel payload", () => {
  it("telegramCaption appends install link, changelog, and crash stats", () => {
    const text = telegramCaption(meta, "ship it", intel);
    expect(text).toContain("Tap to install");
    expect(text).toContain("v2.4.0 → v2.4.1");
    expect(text).toContain("Stability of v2.4.0");
  });

  it("whatsappCaption appends plain-text intel sections", () => {
    const text = whatsappCaption(meta, "ship it", intel);
    expect(text).toContain("Install:");
    expect(text).toContain("What's changed");
    expect(text).toContain("Stability of v2.4.0");
  });

  it("slackCaption appends mrkdwn intel sections", () => {
    const text = slackCaption(meta, "ship it", intel);
    expect(text).toContain("Install:");
    expect(text).toContain("Features");
  });

  it("discordCaption appends intel after metadata", () => {
    const text = discordCaption(meta, "ship it", intel);
    expect(text).toContain("Install:");
    expect(text).toContain("Stability");
  });

  it("emailTextBody includes intel sections", () => {
    const text = emailTextBody(meta, "ship it", intel);
    expect(text).toContain("Install:");
    expect(text).toContain("What's changed");
    expect(text).toContain("Stability");
  });

  it("emailHtmlBody includes intel as separate blocks", () => {
    const html = emailHtmlBody(meta, "ship it", intel);
    expect(html).toContain("Tap to install");
    expect(html).toContain("<b>Features</b>");
    expect(html).toContain("Stability of v2.4.0");
  });

  it("teamsCard includes Install action and changelog text", () => {
    const card = teamsCard(meta, "ship it", intel) as {
      attachments: { content: { actions?: { url: string }[]; body: unknown[] } }[];
    };
    const actions = card.attachments[0]!.content.actions;
    expect(actions).toBeDefined();
    expect(actions![0]!.url).toBe("https://x.test/install/abc");
    expect(JSON.stringify(card.attachments[0]!.content.body)).toContain("v2.4.0 → v2.4.1");
  });

  it("intel-less call still produces a caption (regression for Phase 1/2 callers)", () => {
    const text = telegramCaption(meta);
    expect(text).toContain("Acme");
    expect(text).not.toContain("Tap to install");
  });
});
