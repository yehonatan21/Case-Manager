// Performance budgets: for each page in e2e/perf-budget.json, how much JavaScript the browser downloads, how fast
// the server answers (median of 5) and when the page has loaded, against its limits. Prints a table (and adds it
// to the GitHub Actions summary), saves the numbers, and fails when a page is over a limit.
// Requires a running production build in demo mode: BASE=http://localhost:3000 node e2e/perf-budget.cjs
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "screenshots", "perf");
fs.mkdirSync(OUT, { recursive: true });
const budget = JSON.parse(fs.readFileSync(path.join(__dirname, "perf-budget.json"), "utf8"));

(async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "he" });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/login?as=admin@example.com`);
    await p.waitForTimeout(800);
    const code = (await p.locator("text=/הקוד שלך הוא \\d{6}/").first().innerText({ timeout: 15000 })).match(/\d{6}/)[0];
    await p.fill('input[autocomplete="one-time-code"]', code);
    await p.click("button[type=submit]");
    await p.waitForURL((u) => !new URL(u).pathname.startsWith("/login"), { timeout: 20000 });

    const rows = [];
    for (const [page, own] of Object.entries(budget.pages)) {
      const limit = { ...budget.default, ...own };
      // The server: the median of 5 answers, after one warm-up.
      const times = [];
      for (let i = 0; i < 6; i++) {
        const start = Date.now();
        const r = await p.request.get(BASE + page, { maxRedirects: 0 });
        await r.body();
        if (i) times.push(Date.now() - start);
      }
      times.sort((a, b) => a - b);
      const serverMs = times[Math.floor(times.length / 2)];
      // The browser: a fresh load in a new profile (same sign-in, empty cache); the JavaScript it downloaded, as the
      // browser measured it (compressed size of every script), once the network is quiet.
      const freshCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "he", storageState: await ctx.storageState() });
      const fresh = await freshCtx.newPage();
      await fresh.goto(BASE + page, { waitUntil: "networkidle" });
      const { jsBytes, loadMs } = await fresh.evaluate(() => ({
        jsBytes: performance
          .getEntriesByType("resource")
          .filter((r) => r.initiatorType === "script" || /\.js(\?|$)/.test(r.name))
          .reduce((sum, r) => sum + (r.encodedBodySize || r.transferSize || 0), 0),
        loadMs: Math.round(performance.getEntriesByType("navigation")[0].loadEventEnd),
      }));
      await freshCtx.close();
      const jsKb = Math.round(jsBytes / 1024);
      const over = [jsKb > limit.jsKb && "JS", serverMs > limit.serverMs && "server", loadMs > limit.loadMs && "load"].filter(Boolean);
      rows.push({ page, jsKb, serverMs, loadMs, limit, over });
      console.log(
        `${over.length ? "✗" : "✓"} ${page}: JS ${jsKb} KB (≤ ${limit.jsKb}), server ${serverMs} ms (≤ ${limit.serverMs}), load ${loadMs} ms (≤ ${limit.loadMs})${over.length ? `  — over: ${over.join(", ")}` : ""}`,
      );
    }

    fs.writeFileSync(path.join(OUT, "perf.json"), JSON.stringify(rows, null, 2));
    const table = [
      "### Performance budgets",
      "",
      "| Page | JS (KB) | Server (ms) | Load (ms) | |",
      "|---|---:|---:|---:|---|",
      ...rows.map(
        (r) => `| \`${r.page}\` | ${r.jsKb} / ${r.limit.jsKb} | ${r.serverMs} / ${r.limit.serverMs} | ${r.loadMs} / ${r.limit.loadMs} | ${r.over.length ? `❌ ${r.over.join(", ")}` : "✅"} |`,
      ),
      "",
    ].join("\n");
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
    const failed = rows.filter((r) => r.over.length);
    if (failed.length) {
      console.error(`\nPERF BUDGET FAILED: ${failed.map((r) => `${r.page} (${r.over.join(", ")})`).join("; ")}`);
      process.exit(1);
    }
    console.log("\nPERF BUDGET: all within limits");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("PERF BUDGET FAILED:", e);
  process.exit(1);
});
