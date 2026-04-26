import { describe, it, expect } from "vitest";
import {
  telegramCaption,
  whatsappCaption,
  slackCaption,
  discordCaption,
  emailSubject,
  emailTextBody,
  emailHtmlBody,
  teamsCard,
} from "../../src/delivery/captions.js";
import type { BuildMetadata } from "../../src/types.js";

const meta: BuildMetadata = {
  filePath: "/tmp/seri.apk",
  fileSize: 12_345_678,
  appName: "Seri Mediclinic",
  packageName: "com.seri.app",
  versionName: "2.4.1",
  versionCode: "241",
  buildType: "release",
  minSdkVersion: "24",
  targetSdkVersion: "34",
  source: "aapt2",
};

describe("captions", () => {
  it("telegram caption uses HTML and includes all metadata", () => {
    const text = telegramCaption(meta, "for review");
    expect(text).toContain("<b>Seri Mediclinic</b>");
    expect(text).toContain("2.4.1");
    expect(text).toContain("for review");
    expect(text).toContain("minSDK");
  });

  it("telegram caption escapes HTML in the custom message", () => {
    const text = telegramCaption(meta, "<script>alert(1)</script>");
    expect(text).not.toContain("<script>");
    expect(text).toContain("&lt;script&gt;");
  });

  it("whatsapp caption uses *bold* markdown", () => {
    const text = whatsappCaption(meta);
    expect(text).toContain("*Seri Mediclinic*");
    expect(text).toContain("*Version:*");
  });

  it("slack caption uses mrkdwn and emoji shortcodes", () => {
    const text = slackCaption(meta);
    expect(text).toContain(":package:");
    expect(text).toContain("*Seri Mediclinic*");
    expect(text).toContain("`com.seri.app`");
  });

  it("discord caption uses **bold**", () => {
    const text = discordCaption(meta);
    expect(text).toContain("**Seri Mediclinic**");
    expect(text).toContain("**Version:**");
  });

  it("email subject is short and includes app/version/buildType", () => {
    expect(emailSubject(meta)).toBe(
      "[Build] Seri Mediclinic v2.4.1 (release)",
    );
  });

  it("email text body is plain and readable", () => {
    const body = emailTextBody(meta, "Please test on device.");
    expect(body).not.toContain("<");
    expect(body).toContain("Seri Mediclinic");
    expect(body).toContain("Please test on device.");
  });

  it("email html body escapes user input", () => {
    const html = emailHtmlBody(meta, "<b>oops</b>");
    expect(html).toContain("&lt;b&gt;oops&lt;/b&gt;");
  });

  it("teams card is a Microsoft Adaptive Card payload", () => {
    const card = teamsCard(meta) as {
      type: string;
      attachments: { contentType: string; content: { type: string; body: unknown[] } }[];
    };
    expect(card.type).toBe("message");
    expect(card.attachments[0]!.contentType).toBe(
      "application/vnd.microsoft.card.adaptive",
    );
    expect(card.attachments[0]!.content.type).toBe("AdaptiveCard");
    expect(Array.isArray(card.attachments[0]!.content.body)).toBe(true);
  });
});
