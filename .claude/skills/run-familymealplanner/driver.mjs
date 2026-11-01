#!/usr/bin/env node
// Drive the meal planner in headless Chromium: sign in, screenshot, audit the UI.
// Needs the app on :3000 pointed at fake-supabase (see SKILL.md, "Launch").
//
//   node driver.mjs shot /week [--desktop] [--lang es] [--out file.png]
//   node driver.mjs tour [--lang es]                 every page, phone + desktop
//   node driver.mjs run my-flow.mjs [--desktop]      your own steps (see SKILL.md)
//
// Every command prints a UI audit per page: console errors, horizontal
// overflow, broken images, missing alt text, unnamed buttons and small tap
// targets. Screenshots go to $SHOTS_DIR (default ./shots).

import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

// Claude cloud containers keep Chromium in /opt/pw-browsers; a shell without
// PLAYWRIGHT_BROWSERS_PATH would otherwise look in ~/.cache and fail.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/opt/pw-browsers")) process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const APP = process.env.APP_URL ?? "http://localhost:3000";
const EMAIL = process.env.MEMBER_EMAIL ?? "cook@example.com";
const SHOTS = resolve(process.env.SHOTS_DIR ?? "shots");
const PAGES = ["/week", "/meals", "/history", "/favourites", "/gluten", "/household", "/login"];
export const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 900 } },
};

export async function open({ device = "phone", lang = "en", signedIn = true } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext(VIEWPORTS[device]);
  await context.addCookies([{ name: "lang", value: lang, url: APP }]);
  // Hide the Next.js dev "N" badge, which otherwise sits on top of the bottom-left of every shot.
  await context.addInitScript(() => {
    const css = "nextjs-portal{display:none!important}";
    document.addEventListener("DOMContentLoaded", () => document.head.append(Object.assign(document.createElement("style"), { textContent: css })));
  });
  // Meal photos come from TheMealDB/Wikipedia. When the sandbox blocks them, draw a
  // labelled grey box so layouts still look real, and keep them out of the audit.
  const blocked = new Set();
  await context.route(/^https?:\/\//, async (route) => {
    const req = route.request();
    if (req.url().startsWith(APP)) return route.continue();
    try {
      return await route.fulfill({ response: await route.fetch({ timeout: 8000 }) });
    } catch {
      blocked.add(req.url());
      if (req.resourceType() !== "image") return route.abort();
      return route.fulfill({
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="100%" height="100%" fill="#d4d4d8"/><text x="50%" y="50%" font-size="16" text-anchor="middle" fill="#52525b" font-family="sans-serif">photo</text></svg>`,
      });
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.blockedExternal = blocked;
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/ERR_FAILED|ERR_TUNNEL|ERR_BLOCKED/.test(m.text()) && blocked.size) return; // our own fallback above
    errors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  if (signedIn) await signIn(page);
  return { browser, context, page, errors };
}

// The fake backend accepts the email itself as the magic-link token.
export async function signIn(page, email = EMAIL) {
  await page.goto(`${APP}/auth/confirm?token_hash=${encodeURIComponent(email)}&type=email`);
  if (!page.url().includes("/week")) throw new Error(`sign-in landed on ${page.url()} - is fake-supabase running?`);
}

export async function shot(page, name) {
  mkdirSync(SHOTS, { recursive: true });
  const file = name.endsWith(".png") ? resolve(name) : join(SHOTS, `${name}.png`);
  // caret: "initial" - Playwright's default hides the caret by adding a style to every
  // input, which fires a false React hydration-mismatch error on pages still hydrating.
  await page.screenshot({ path: file, fullPage: true, caret: "initial" });
  return file;
}

// Things a UI reviewer flags by eye, checked in the DOM.
export async function audit(page) {
  const out = await auditDom(page);
  if (page.blockedExternal?.size) out.externalBlockedBySandbox = page.blockedExternal.size; // not an app bug
  return out;
}

function auditDom(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const label = (el) => (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || el.outerHTML).trim().slice(0, 40);
    const out = {};
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + 1) {
      const wide = [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && vis(el))
        .filter((el) => !el.closest("[class*='overflow-x-auto'],[class*='overflow-auto'],[class*='overflow-hidden']"))
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")}`);
      out.horizontalOverflow = `page is ${doc.scrollWidth}px wide in a ${window.innerWidth}px viewport: ${wide.join(", ")}`;
    }
    const imgs = [...document.images].filter(vis);
    const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src);
    if (broken.length) out.brokenImages = broken.slice(0, 5);
    const noAlt = imgs.filter((i) => !i.hasAttribute("alt")).length;
    if (noAlt) out.imagesWithoutAlt = noAlt;
    const controls = [...document.querySelectorAll("button, a[href], [role=button], input, select, textarea")].filter(vis);
    const unnamed = controls
      .filter((el) => /^(BUTTON|A)$/.test(el.tagName) && !(el.innerText.trim() || el.getAttribute("aria-label") || el.getAttribute("title") || el.querySelector("img[alt]:not([alt=''])")))
      .map((el) => el.outerHTML.slice(0, 80));
    if (unnamed.length) out.unnamedControls = unnamed.slice(0, 5);
    const small = controls.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width < 24 || r.height < 24; // WCAG 2.2 AA minimum target size
    });
    if (small.length) out.smallTapTargets = { count: small.length, e_g: small.slice(0, 4).map(label) };
    return out;
  });
}

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      o[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    } else o._.push(argv[i]);
  }
  return o;
}

async function visit(path, device, lang) {
  const s = await open({ device, lang, signedIn: path !== "/login" });
  try {
    await s.page.goto(APP + path, { waitUntil: "networkidle" });
    const file = await shot(s.page, `${path.slice(1) || "home"}-${device}-${lang}`);
    const report = { page: path, device, lang, url: s.page.url(), screenshot: file, ...(await audit(s.page)) };
    if (s.errors.length) report.consoleErrors = s.errors.slice(0, 5);
    console.log(JSON.stringify(report, null, 1));
  } finally {
    await s.browser.close();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const a = args(process.argv.slice(2));
  const [cmd, target] = a._;
  const device = a.desktop ? "desktop" : "phone";
  const lang = a.lang ?? "en";
  if (cmd === "shot") {
    const s = await open({ device, lang, signedIn: target !== "/login" });
    await s.page.goto(APP + (target ?? "/week"), { waitUntil: "networkidle" });
    const file = await shot(s.page, a.out ?? `${(target ?? "/week").slice(1).replace(/\//g, "-")}-${device}-${lang}`);
    console.log(JSON.stringify({ url: s.page.url(), screenshot: file, ...(await audit(s.page)), consoleErrors: s.errors }, null, 1));
    await s.browser.close();
  } else if (cmd === "tour") {
    for (const p of PAGES) for (const d of ["phone", "desktop"]) await visit(p, d, lang);
  } else if (cmd === "run") {
    const flow = (await import(resolve(target))).default;
    const s = await open({ device, lang });
    try {
      await flow({ ...s, APP, shot: (n) => shot(s.page, n), audit: () => audit(s.page) });
      if (s.errors.length) console.log("console errors:", s.errors);
    } finally {
      await s.browser.close();
    }
  } else {
    console.log("usage: driver.mjs shot <path> [--desktop] [--lang es] [--out name] | tour [--lang es] | run <flow.mjs> [--desktop]");
    process.exit(1);
  }
}
