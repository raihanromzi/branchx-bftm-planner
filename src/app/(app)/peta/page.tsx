import { Suspense } from "react";
import { requireAdminPage } from "@/server/auth/page";
import { PetaScreen } from "@/components/map/peta-screen";

export const metadata = { title: "Peta" };

export default async function PetaPage() {
  await requireAdminPage("/peta");

  return (
    <Suspense fallback={<PetaSkeleton />}>
      <PetaScreen />
    </Suspense>
  );
}

function PetaSkeleton() {
  return <div className="p-4">Memuat peta...</div>;
}
