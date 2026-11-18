import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("E0-S1 scaffold", () => {
  it("resolves the @/ path alias and merges conflicting Tailwind classes", () => {
    expect(cn("px-2 text-sm", "px-4")).toBe("text-sm px-4");
  });
});
