"use client";

import { useRouter } from "next/navigation";
import { AccountStep } from "@/components/intake/account-step";

export function RegisterForm({ next, google, googleProfile }: { next: string | null; google: boolean; googleProfile?: { email: string; name: string } }) {
  const router = useRouter();
  return (
    <AccountStep
      mode={googleProfile ? "google" : "register"}
      google={google}
      googleNext={next ?? undefined}
      googleProfile={googleProfile}
      submitting={false}
      onVerified={async () => {
        router.push(next ?? "/portal");
        router.refresh();
      }}
    />
  );
}
