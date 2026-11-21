import { Suspense } from "react";
import { requireAdminPage } from "@/server/auth/page";
import { DashboardScreen } from "@/components/dashboard/dashboard-screen";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  await requireAdminPage("/dashboard");

  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardScreen />
    </Suspense>
  );
}

function DashboardSkeleton() {
  return <div className="p-4">Memuat dashboard...</div>;
}
