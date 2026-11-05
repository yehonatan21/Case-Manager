/**
 * The service worker (public/sw.js), run in a sandbox with a fake `self`: what it shows for a push, and
 * which page it opens when the notification is tapped. (Headless browsers can't display notifications.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

type Listener = (e: any) => void;
let listeners: Record<string, Listener>;
let shown: { title: string; options: any }[];
let windows: { url: string; focus: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> }[];
let opened: string[];

function load() {
  listeners = {};
  shown = [];
  opened = [];
  const self = {
    location: { origin: "https://app.example.com" },
    addEventListener: (t: string, fn: Listener) => (listeners[t] = fn),
    skipWaiting: vi.fn(),
    registration: { showNotification: async (title: string, options: any) => void shown.push({ title, options }) },
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: async () => windows,
      openWindow: async (url: string) => void opened.push(url),
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8"), { self, URL, atob, fetch: vi.fn(), Uint8Array, JSON });
}

/** Dispatch an event and wait for everything passed to waitUntil. */
async function fire(type: string, event: Record<string, unknown>) {
  const pending: Promise<unknown>[] = [];
  listeners[type]!({ ...event, waitUntil: (p: Promise<unknown>) => pending.push(p) });
  await Promise.all(pending);
}

const pushEvent = (payload: unknown) => ({ data: { json: () => (typeof payload === "string" ? JSON.parse(payload) : payload), text: () => String(payload) } });

beforeEach(() => {
  windows = [];
  load();
});

describe("service worker", () => {
  it("shows the notification from the payload, with the app icon, and remembers where it leads", async () => {
    await fire("push", pushEvent({ title: "בקשה חדשה", body: "CASE-1", url: "https://app.example.com/admin/cases/1", tag: "n1" }));
    expect(shown).toEqual([
      { title: "בקשה חדשה", options: expect.objectContaining({ body: "CASE-1", tag: "n1", icon: "/icons/icon-192.png", badge: "/icons/badge-96.png", dir: "auto", data: { url: "https://app.example.com/admin/cases/1" } }) },
    ]);
  });

  it("still shows something for an empty or non-JSON push", async () => {
    await fire("push", { data: null });
    await fire("push", { data: { json: () => JSON.parse("not json"), text: () => "plain text" } });
    expect(shown.map((n) => n.title)).toEqual(["Case Manager", "plain text"]);
  });

  it("tapping opens the page, reusing an open window of the app", async () => {
    const close = vi.fn();
    await fire("notificationclick", { notification: { close, data: { url: "https://app.example.com/portal/cases/9?tab=quote" } } });
    expect(close).toHaveBeenCalled();
    expect(opened).toEqual(["https://app.example.com/portal/cases/9?tab=quote"]);

    const w = { url: "https://app.example.com/portal", focus: vi.fn(), navigate: vi.fn() };
    w.focus.mockResolvedValue(w);
    windows = [w];
    opened = [];
    await fire("notificationclick", { notification: { close, data: { url: "/portal/cases/9" } } });
    expect(w.focus).toHaveBeenCalled();
    expect(w.navigate).toHaveBeenCalledWith("https://app.example.com/portal/cases/9");
    expect(opened).toEqual([]);
  });

  it("never opens another site, even if a payload says so", async () => {
    await fire("notificationclick", { notification: { close: vi.fn(), data: { url: "https://evil.example/phish" } } });
    expect(opened).toEqual([]);
  });

  it("activates immediately", async () => {
    await fire("activate", {});
    expect(Object.keys(listeners)).toEqual(expect.arrayContaining(["install", "activate", "push", "notificationclick", "pushsubscriptionchange"]));
  });
});
