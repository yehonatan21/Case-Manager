"use client";

import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";

export function MarkAllRead() {
  const { d } = useI18n();
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await api("/api/notifications", { body: {} });
        router.refresh();
      }}
    >
      {d.notificationsUi.markAllRead}
    </Button>
  );
}
