// Which pushes Vercel builds (scripts/vercel-ignore-build.cjs + vercel.json): every deployment Vercel keeps counts
// toward the plan's storage, so only main and dev are deployed, and docs/tests/CI/mobile-only pushes are not.
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { decide } = require("../scripts/vercel-ignore-build.cjs") as {
  decide: (env: Record<string, string>, changed: string[] | null) => { build: boolean; reason: string };
};
const build = (branch: string | undefined, changed: string[] | null) =>
  decide(branch ? { VERCEL_GIT_COMMIT_REF: branch } : {}, changed).build;

describe("Vercel build filter", () => {
  it("builds main (production) and dev (the dev site), and no other branch", () => {
    expect(build("main", ["src/app/page.tsx"])).toBe(true);
    expect(build("dev", ["src/app/page.tsx"])).toBe(true);
    expect(build("claude/hopeful-bardeen-yjfnro", ["src/app/page.tsx"])).toBe(false);
    expect(build("dependabot/npm_and_yarn/dev/web-push-4.0.0", ["package.json"])).toBe(false);
  });

  it("builds main and dev even when only docs, tests, CI or the mobile app changed (a redeploy for new variables)", () => {
    expect(build("main", ["README.md", "CHANGELOG.md", "docs/setup.md", "tests/flow.test.ts"])).toBe(true);
    expect(build("dev", ["mobile/app.json", ".github/workflows/mobile.yml"])).toBe(true);
  });

  it("always builds a redeploy, a new branch, unknown changes, and deployments made through the API", () => {
    expect(build("main", [])).toBe(true);
    expect(build("main", null)).toBe(true);
    expect(build(undefined, null)).toBe(true);
  });

  it("is wired into vercel.json, which also turns off automatic deployments of work and Dependabot branches", () => {
    const v = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "vercel.json"), "utf8"));
    expect(v.ignoreCommand).toBe("node scripts/vercel-ignore-build.cjs");
    expect(v.git.deploymentEnabled["claude/**"]).toBe(false);
    expect(v.git.deploymentEnabled["dependabot/**"]).toBe(false);
    expect(v.git.deploymentEnabled.main).not.toBe(false);
    expect(v.git.deploymentEnabled.dev).not.toBe(false);
  });
});
