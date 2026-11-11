/** Shared by browser push (push.ts) and app push (native-push.ts). */

/** Devices kept per user (per kind); the oldest are dropped beyond this. */
export const MAX_DEVICES_PER_USER = 10;

/** What a device receives: the service worker (public/sw.js) or the app's notification. */
export type PushPayload = { title: string; body: string; url: string; tag: string };
