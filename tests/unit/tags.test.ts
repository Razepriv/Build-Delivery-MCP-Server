import { describe, it, expect } from "vitest";
import { filterByTags, tagTelegramChats } from "../../src/delivery/tags.js";

describe("filterByTags", () => {
  const recipients = [
    { id: "qa@team", tags: ["qa-team", "internal"] },
    { id: "design@leads", tags: ["design-leads"] },
    { id: "ceo@board", tags: ["board"] },
    { id: "loose@everyone" /* no tags */ },
  ];

  it("returns all recipients when filter is empty", () => {
    expect(filterByTags(recipients).map((r) => r.id)).toEqual([
      "qa@team",
      "design@leads",
      "ceo@board",
      "loose@everyone",
    ]);
  });

  it("returns recipients matching ANY of the requested tags", () => {
    const result = filterByTags(recipients, ["qa-team"]);
    expect(result.map((r) => r.id)).toEqual(["qa@team"]);
  });

  it("matches multiple tags with OR semantics", () => {
    const result = filterByTags(recipients, ["board", "design-leads"]);
    expect(result.map((r) => r.id).sort()).toEqual(["ceo@board", "design@leads"]);
  });

  it("excludes untagged recipients once a filter is set", () => {
    const result = filterByTags(recipients, ["any-tag"]);
    expect(result).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const result = filterByTags(recipients, ["QA-TEAM"]);
    expect(result.map((r) => r.id)).toEqual(["qa@team"]);
  });
});

describe("tagTelegramChats", () => {
  it("pairs chat IDs with tags from the parallel map", () => {
    const result = tagTelegramChats(
      ["-100123", "-100456"],
      { "-100123": ["qa-team"], "-100456": ["board"] },
    );
    expect(result).toEqual([
      { id: "-100123", tags: ["qa-team"] },
      { id: "-100456", tags: ["board"] },
    ]);
  });

  it("leaves tags undefined when no map is provided", () => {
    const result = tagTelegramChats(["-100123"], undefined);
    expect(result[0]?.tags).toBeUndefined();
  });
});
