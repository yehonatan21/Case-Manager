// Store images for Google Play, from the running site with its demo data:
//   - phone screenshots (1080×1920) in Hebrew and English, each with a caption above the app;
//   - the feature graphic (1024×500) and the 512 px icon.
// Run from the repository root against a demo-mode server:
//   BASE=http://localhost:3000 node mobile/scripts/store-images.cjs
const { chromium } = require("playwright");
const sharp = require("sharp");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.BASE || "http://localhost:3000";
const STORE = path.join(__dirname, "..", "store", "google-play");
const ROOT = path.join(__dirname, "..", "..");
const LANGS = { "iw-IL": "he", "en-US": "en" };
const BRAND = "#4338CA";
const log = (...a) => console.log("•", ...a);
const glyph = fs.readFileSync(path.join(__dirname, "..", "assets", "glyph.svg"), "utf8");
const font = (f) => `data:font/woff2;base64,${fs.readFileSync(path.join(ROOT, "node_modules/@fontsource-variable/rubik/files", f)).toString("base64")}`;
const FONTS = `
  @font-face { font-family: Rubik; src: url(${font("rubik-hebrew-wght-normal.woff2")}) format("woff2"); font-weight: 100 900; unicode-range: U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F; }
  @font-face { font-family: Rubik; src: url(${font("rubik-latin-wght-normal.woff2")}) format("woff2"); font-weight: 100 900; }`;

const CAPTIONS = {
  home: { he: "מתארים מה צריך – במילים שלכם", en: "Describe what you need, in your own words" },
  next: { he: "תמיד יודעים מה הצעד הבא", en: "Always know your next step" },
  cases: { he: "כל התיקים שלכם במקום אחד", en: "All your cases in one place" },
  quote: { he: "מאשרים הצעת מחיר ומשלמים מהטלפון", en: "Approve the quote and pay from your phone" },
  team: { he: "גם לצוות: מה דורש טיפול עכשיו", en: "For the team: what needs attention now" },
};

/** The app's bridge, so the site shows its in-app state (push for this phone). */
function fakeApp() {
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    nativeCallback(plugin, method, opts, cb) {
      if (plugin === "PushNotifications" && opts && opts.eventName === "registration") setTimeout(() => cb({ value: localStorage.getItem("e2e.tok") }), 30);
      return "cb";
    },
    async nativePromise(plugin, method) {
      if (method === "checkPermissions" || method === "requestPermissions") return { receive: "granted" };
      return {};
    },
  };
  if (!localStorage.getItem("e2e.tok")) localStorage.setItem("e2e.tok", "store" + Math.random().toString(36).slice(2).padEnd(40, "x"));
}
// The demo banner and the cookie notice aren't part of the app.
const HIDE = `body > div[role=note] { display: none !important; }`;

async function signIn(page, email) {
  await page.goto(`${BASE}/login?as=${encodeURIComponent(email)}`);
  const code = (await page.locator("text=/(הקוד שלך הוא|your code is) \\d{6}/").first().innerText({ timeout: 15000 })).match(/\d{6}/)[0];
  await page.fill('input[autocomplete="one-time-code"]', code);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !new URL(u).pathname.startsWith("/login"), { timeout: 20000 });
}

async function shot(page, url) {
  await page.goto(BASE + url);
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(1500);
  return page.screenshot();
}

/** A caption above the app screen, on the brand colour (1080×1920). */
async function compose(browser, png, caption, dir) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.setContent(`<!doctype html><html dir="${dir}"><head><style>${FONTS}
    html,body{margin:0;width:1080px;height:1920px;background:${BRAND};font-family:Rubik,sans-serif;}
    h1{margin:0;position:absolute;top:96px;inset-inline:80px;text-align:center;color:#fff;font-size:76px;line-height:1.2;font-weight:800;}
    .phone{position:absolute;top:400px;left:130px;width:820px;height:1600px;border-radius:64px;background:#0f172a;padding:20px;box-sizing:border-box;box-shadow:0 30px 80px rgba(0,0,0,.35);}
    .phone img{display:block;width:780px;height:1560px;object-fit:cover;object-position:top;border-radius:46px;}
  </style></head><body><h1>${caption}</h1><div class="phone"><img src="data:image/png;base64,${png.toString("base64")}"></div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const out = await page.screenshot();
  await page.close();
  return out;
}

async function featureGraphic(browser, lang, screen) {
  const he = lang === "he";
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 } });
  await page.setContent(`<!doctype html><html dir="${he ? "rtl" : "ltr"}"><head><style>${FONTS}
    html,body{margin:0;width:1024px;height:500px;overflow:hidden;background:linear-gradient(135deg,${BRAND},#312e81);font-family:Rubik,sans-serif;color:#fff;}
    .mark{position:absolute;top:70px;inset-inline-start:64px;width:96px;height:96px;border-radius:24px;background:rgba(255,255,255,.14);}
    .mark svg{width:96px;height:96px}
    h1{position:absolute;top:186px;inset-inline-start:64px;margin:0;font-size:58px;font-weight:800;letter-spacing:-.5px}
    p{position:absolute;top:270px;inset-inline-start:64px;width:520px;margin:0;font-size:30px;line-height:1.35;font-weight:500;opacity:.92}
    .phone{position:absolute;top:56px;inset-inline-end:84px;width:250px;height:500px;border-radius:30px;background:#0f172a;padding:9px;box-sizing:border-box;transform:rotate(${he ? -6 : 6}deg);box-shadow:0 20px 50px rgba(0,0,0,.4)}
    .phone img{width:232px;height:482px;object-fit:cover;object-position:top;border-radius:22px;display:block}
  </style></head><body>
    <div class="mark">${glyph}</div>
    <h1>Case Manager</h1>
    <p>${he ? "כל התיק שלכם במקום אחד: בקשה, הצעת מחיר, תשלום ומעקב." : "Your whole case in one place: request, quote, payment and updates."}</p>
    <div class="phone"><img src="data:image/png;base64,${screen.toString("base64")}"></div>
  </body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const out = await page.screenshot();
  await page.close();
  return out;
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const [store, lang] of Object.entries(LANGS)) {
      const dir = lang === "he" ? "rtl" : "ltr";
      const out = path.join(STORE, store, "images");
      fs.rmSync(path.join(out, "phoneScreenshots"), { recursive: true, force: true });
      fs.mkdirSync(path.join(out, "phoneScreenshots"), { recursive: true });
      const phone = { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: lang === "he" ? "he-IL" : "en-US" };
      const cookie = [{ name: "cm_locale", value: lang, url: BASE }];
      const shots = {};

      // The client.
      const client = await browser.newContext(phone);
      await client.addCookies(cookie);
      await client.addInitScript(fakeApp);
      const c = await client.newPage();
      shots.home = await shot(c, "/");
      await signIn(c, "client@example.com");
      shots.cases = await shot(c, "/portal");
      const links = await c.locator('a[href^="/portal/cases/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href").split("?")[0]))]);
      shots.next = await shot(c, links[0]);
      // A case with a quote: open the tab as the client would.
      const openTab = async (href, name) => {
        await c.goto(BASE + href);
        await c.addStyleTag({ content: HIDE });
        const tab = c.getByRole("tab", { name });
        if (!(await tab.count())) return null;
        await tab.first().click();
        await c.waitForTimeout(1500);
        return c;
      };
      for (const href of links) {
        if (!(await openTab(href, lang === "he" ? "הצעת מחיר ותשלומים" : /Quote/))) continue;
        if (await c.locator('[role=tabpanel] >> text=/₪/').first().isVisible().catch(() => false)) {
          shots.quote = await c.screenshot();
          break;
        }
      }
      // Notifications on for this phone (so the in-app push state is real in the other shots).
      await c.goto(`${BASE}/portal/notifications`);
      const toggle = c.locator('[data-push-kind="app"]');
      await toggle.waitFor();
      if ((await toggle.getAttribute("data-push-state")) === "off") {
        await toggle.locator("button").first().click();
        await c.locator('[data-push-state="on"]').waitFor({ timeout: 15000 });
      }
      await client.close();

      // The team.
      const staff = await browser.newContext(phone);
      await staff.addCookies(cookie);
      await staff.addInitScript(fakeApp);
      const s = await staff.newPage();
      await signIn(s, "admin@example.com");
      shots.team = await shot(s, "/admin");
      await staff.close();

      let i = 0;
      for (const key of ["next", "home", "cases", "quote", "team"]) {
        if (!shots[key]) continue;
        const file = path.join(out, "phoneScreenshots", `${++i}-${key}.png`);
        fs.writeFileSync(file, await sharp(await compose(browser, shots[key], CAPTIONS[key][lang], dir)).png({ compressionLevel: 9 }).toBuffer());
      }
      log(`${store}: ${i} screenshots`);
      fs.writeFileSync(path.join(out, "featureGraphic.png"), await sharp(await featureGraphic(browser, lang, shots.next)).png({ compressionLevel: 9 }).toBuffer());
      log(`${store}: feature graphic`);
      // The icon: Play rounds the corners itself.
      const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="${BRAND}"/>${glyph.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")}</svg>`);
      fs.writeFileSync(path.join(out, "icon.png"), await sharp(svg).png().toBuffer());
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
