import { describe, it, expect } from "vitest";
import { gradleInitScript } from "../../src/install-agents/build-hooks/gradle.js";
import { xcodePostBuildScript } from "../../src/install-agents/build-hooks/xcode.js";

describe("gradleInitScript", () => {
  it("references both APK and AAB outputs", () => {
    const script = gradleInitScript("build-delivery-mcp deliver");
    expect(script).toContain("'**/*.apk'");
    expect(script).toContain("'**/*.aab'");
  });

  it("honors BUILD_DELIVERY_DISABLE escape hatch", () => {
    const script = gradleInitScript("build-delivery-mcp deliver");
    expect(script).toContain("BUILD_DELIVERY_DISABLE");
  });

  it("escapes single quotes in the deliver command", () => {
    const script = gradleInitScript("'/quoted/path' deliver");
    expect(script).not.toContain("'/quoted/path'");
    expect(script).toContain("\\'");
  });
});

describe("xcodePostBuildScript", () => {
  it("emits a bash script with set -euo pipefail", () => {
    const snippet = xcodePostBuildScript("build-delivery-mcp deliver");
    expect(snippet).toContain("set -euo pipefail");
  });

  it("scans BUILT_PRODUCTS_DIR for *.ipa", () => {
    const snippet = xcodePostBuildScript("build-delivery-mcp deliver");
    expect(snippet).toContain("BUILT_PRODUCTS_DIR");
    expect(snippet).toContain("*.ipa");
  });

  it("respects BUILD_DELIVERY_DISABLE env var", () => {
    const snippet = xcodePostBuildScript("build-delivery-mcp deliver");
    expect(snippet).toContain("BUILD_DELIVERY_DISABLE");
  });
});
