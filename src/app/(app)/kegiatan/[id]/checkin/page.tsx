import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/server/auth/page";
import { getActivity } from "@/server/activities";
import { CheckInForm } from "@/components/activities/checkin-form";

async function CheckInContent({ id }: { id: string }) {
  const activity = await getActivity(id).catch((error: unknown) => {
    if ((error as { code?: string })?.code === "not_found") notFound();
    throw error;
  });
  if (activity.status !== "scheduled") notFound();
  return <CheckInForm activity={activity} />;
}

export default async function CheckInPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage("/kegiatan/[id]/checkin");
  const { id } = await params;

  return (
    <Suspense fallback={<CheckInSkeleton />}>
      <CheckInContent id={id} />
    </Suspense>
  );
}

function CheckInSkeleton() {
  return <div className="p-4">Memuat Check-in...</div>;
}
