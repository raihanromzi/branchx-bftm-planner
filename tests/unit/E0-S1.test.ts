import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import playwrightConfig from "../../playwright.config";

const root = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

// Environment variables that only tooling sets (CI runners, Node, Vercel), not the app's own configuration.
const PLATFORM_VARS = new Set(["CI", "NODE_ENV", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "NEXT_RUNTIME"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts|js|mjs)$/.test(name) ? [path] : [];
  });
}

describe("E0-S1 scaffold", () => {
  it("resolves the @/ path alias and merges conflicting Tailwind classes", () => {
    expect(cn("px-2 text-sm", "px-4")).toBe("text-sm px-4");
  });

  it("criterion 1: defines the npm scripts CI and CLAUDE.md call, with exactly these names", () => {
    const { scripts } = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    for (const name of ["dev", "lint", "typecheck", "test", "test:e2e", "db:generate", "db:migrate", "build", "vercel-build"]) {
      expect(scripts, `missing npm script "${name}"`).toHaveProperty(name);
    }
    expect(scripts["vercel-build"]).toContain('"$RUN_MIGRATIONS" = "true"');
  });

  it("criterion 2: has the mobile, tablet and desktop Playwright projects at the agreed sizes", () => {
    const viewports = Object.fromEntries(
      (playwrightConfig.projects ?? []).map((project) => [project.name, project.use?.viewport]),
    );
    expect(viewports).toEqual({
      mobile: { width: 360, height: 800 },
      tablet: { width: 768, height: 1024 },
      desktop: { width: 1280, height: 800 },
    });
  });

  it("criterion 3: lists every environment variable the app reads in .env.example", () => {
    const declared = new Set(
      read(".env.example")
        .split("\n")
        .map((line) => line.match(/^([A-Z0-9_]+)=/)?.[1])
        .filter(Boolean),
    );
    const files = [...sourceFiles("src"), ...sourceFiles("scripts"), "drizzle.config.ts", "next.config.ts"];
    const used = new Set(
      files.flatMap((file) => [...read(file).matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1])),
    );
    const missing = [...used].filter((name) => !PLATFORM_VARS.has(name) && !declared.has(name));
    expect(missing).toEqual([]);
  });

  it("criterion 3: .env.example holds names only, never values", () => {
    const assignments = read(".env.example")
      .split("\n")
      .filter((line) => /^[A-Z0-9_]+=/.test(line));
    expect(assignments.length).toBeGreaterThan(0);
    for (const line of assignments) expect(line, line).toMatch(/^[A-Z0-9_]+=$/);
  });
});
