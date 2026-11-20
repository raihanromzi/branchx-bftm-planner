import { Suspense } from "react";
import { requireAdminPage } from "@/server/auth/page";
import { TargetScreen } from "@/components/targets/target-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Target" };

export default async function TargetPage() {
  await requireAdminPage("/pengaturan/target");

  return (
    <Suspense fallback={<TargetSkeleton />}>
      <TargetScreen />
    </Suspense>
  );
}

function TargetSkeleton() {
  return <div className="p-4">Memuat target...</div>;
}
