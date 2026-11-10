"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { errorText } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";

/**
 * Saving from a Settings tab: shows which button is busy, says "Saved" or the error, and reloads the tab's data
 * from the server. `key` names the button that is busy.
 */
export function useSave() {
  const { d } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const call = async (key: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(key);
    try {
      await fn();
      toast("success", d.common.saved);
      after?.();
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };
  return { busy, setBusy, call };
}
