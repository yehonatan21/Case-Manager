import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { countPushDevices } from "@/lib/services/push";
import { NATIVE_PLATFORMS, hasNativePushToken, nativePushConfigured, removeNativePushToken, saveNativePushToken } from "@/lib/services/native-push";

const Token = z.object({ platform: z.enum(NATIVE_PLATFORMS), token: z.string().min(20).max(4096) });

/** Whether push is on for this app install (the app sends its current token). */
export const GET = route(async (req) => {
  const user = await requireApiUser();
  const token = new URL(req.url).searchParams.get("token") ?? "";
  return ok({ on: token ? await hasNativePushToken(await getDb(), user.id, token) : false });
});

/** Turn push on for this phone (the iPhone/Android app's device token). */
export const POST = route(async (req) => {
  const user = await requireApiUser();
  const body = await readJson(req, Token);
  const db = await getDb();
  await saveNativePushToken(db, user, body);
  return ok({ devices: await countPushDevices(db, user.id), configured: nativePushConfigured(body.platform) });
});

/** Turn push off for this phone. */
export const DELETE = route(async (req) => {
  const user = await requireApiUser();
  const { token } = await readJson(req, z.object({ token: z.string().max(4096) }));
  const db = await getDb();
  await removeNativePushToken(db, user, token);
  return ok({ devices: await countPushDevices(db, user.id) });
});
