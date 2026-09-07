import { describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/agent/default-prompt";

describe("default PointGuide system prompt", () => {
  it("requires repository evidence, concise answers, and beginner-friendly numbered steps", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("source of truth");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Never invent");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("clear numbered steps");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("beginner");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Web findings remain supplemental");
  });
});
