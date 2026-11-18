import { Suspense } from "react";
import { BottomNav } from "@/components/shell/bottom-nav";
import { ContentSkeleton } from "@/components/shell/page-header";
import { Sidebar } from "@/components/shell/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { getAdmin, requireAdminPage } from "@/server/auth/page";

// The signed-in app shell (E0-S4). The navigation renders at once; anything that reads the session streams
// in behind a Suspense boundary (Cache Components). proxy.ts already sent cookie-less visits to /masuk; the
// gate below is the real check (ADR 0002), for a cookie whose session has ended.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-1">
      <a
        href="#konten"
        className="hidden lg:sr-only lg:block lg:focus:not-sr-only lg:focus:fixed lg:focus:top-2 lg:focus:left-2 lg:focus:z-50 lg:focus:rounded-lg lg:focus:bg-background lg:focus:px-4 lg:focus:py-2 lg:focus:text-sm lg:focus:font-medium"
      >
        Lewati ke konten
      </a>
      <Sidebar
        className="hidden lg:flex"
        account={
          <Suspense fallback={<span className="block h-5 w-40 rounded-lg bg-muted" />}>
            <AdminEmail />
          </Suspense>
        }
      />
      <main
        id="konten"
        tabIndex={-1}
        className="flex min-w-0 flex-1 flex-col pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom))] outline-none lg:pb-0"
      >
        <Suspense fallback={<ContentSkeleton />}>
          <AdminGate>{children}</AdminGate>
        </Suspense>
      </main>
      <BottomNav className="lg:hidden" />
      <Toaster position="top-center" />
    </div>
  );
}

async function AdminGate({ children }: { children: React.ReactNode }) {
  await requireAdminPage("/");
  return children;
}

async function AdminEmail() {
  const admin = await getAdmin();
  return admin ? <span title={admin.email}>{admin.email}</span> : null;
}
