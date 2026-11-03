import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getIntake } from "@/lib/services/intake";
import { readOwnerToken } from "@/app/api/intake/_owner";

export async function loadIntake(id: string) {
  const user = await getCurrentUser();
  try {
    const session = await getIntake(await getDb(), id, user, await readOwnerToken());
    return { session, user };
  } catch {
    return { session: null, user };
  }
}
