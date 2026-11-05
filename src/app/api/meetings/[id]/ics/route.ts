import { errorResponse } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { meetingIcsFile } from "@/lib/services/meetings";

/** The meeting as an .ics file, for any calendar app. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await ctx.params;
    const ics = await meetingIcsFile(await getDb(), user, id);
    return new Response(ics, {
      headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="meeting-${id.slice(0, 8)}.ics"`, "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
