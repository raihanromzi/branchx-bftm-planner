import { Suspense } from "react";
import { requireAdminPage } from "@/server/auth/page";
import { JadwalScreen } from "@/components/activities/jadwal-screen";

export const metadata = { title: "Jadwal" };

export default async function JadwalPage() {
  await requireAdminPage("/jadwal");

  return (
    <Suspense fallback={<JadwalSkeleton />}>
      <JadwalScreen />
    </Suspense>
  );
}

function JadwalSkeleton() {
  return <div className="p-4">Memuat jadwal...</div>;
}
