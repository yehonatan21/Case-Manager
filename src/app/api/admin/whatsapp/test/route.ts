import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { queueWhatsAppTest, scheduleWhatsAppDispatch } from "@/lib/services/whatsapp";

/** Admin: send the WhatsApp template to the admin's own opted-in number. */
export const POST = route(async () => {
  const user = await requireApiStaff();
  await queueWhatsAppTest(await getDb(), user);
  scheduleWhatsAppDispatch();
  return ok();
});
