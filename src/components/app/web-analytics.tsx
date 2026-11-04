"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

/** Drops query strings and fragments (e.g. /register?email=…) so no personal data reaches Vercel Analytics. */
function stripQuery(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url);
  return { ...event, url: url.origin + url.pathname };
}

/** Vercel Web Analytics: cookieless page views. */
export function WebAnalytics() {
  return <Analytics beforeSend={stripQuery} />;
}
