import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/server/auth/page";
import { getActivity } from "@/server/activities";
import { CheckInForm } from "@/components/activities/checkin-form";

export const dynamic = "force-dynamic";

async function CheckInContent({ id }: { id: string }) {
  try {
    const activity = await getActivity(id);
    if (activity.status !== "scheduled") {
      notFound();
    }
    return <CheckInForm activity={activity} />;
  } catch (error) {
    if ((error as { code?: string })?.code === "not_found") {
      notFound();
    }
    throw error;
  }
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
