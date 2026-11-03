import { PublicHeader } from "@/components/app/public-header";

export default function IntakeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}
