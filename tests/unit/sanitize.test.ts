import { describe, it, expect } from "vitest";
import { sanitizeAppName, sanitizeVersion, sanitizeGeneric } from "../../src/renamer/sanitize.js";

describe("sanitizeAppName", () => {
  it("lowercases and collapses non-alphanumeric runs", () => {
    expect(sanitizeAppName("Webverse  Arena!!")).toBe("webverse_arena");
  });

  it("returns 'app' fallback for empty input", () => {
    expect(sanitizeAppName("---")).toBe("app");
  });

  it("caps length to 64 chars", () => {
    const long = "a".repeat(200);
    expect(sanitizeAppName(long).length).toBeLessThanOrEqual(64);
  });
});

describe("sanitizeVersion", () => {
  it("preserves dots, dashes, underscores, alphanumerics", () => {
    expect(sanitizeVersion("2.4.1-rc.2")).toBe("2.4.1-rc.2");
  });

  it("falls back to 0.0.0 when fully stripped", () => {
    expect(sanitizeVersion("!!!")).toBe("0.0.0");
  });
});

describe("sanitizeGeneric", () => {
  it("replaces unsafe runs with underscore", () => {
    expect(sanitizeGeneric("com/webverse arena")).toBe("com_webverse_arena");
  });
});
