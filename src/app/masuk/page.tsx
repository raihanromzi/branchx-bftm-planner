import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { safeNext } from "@/lib/safe-next";
import { getAdmin } from "@/server/auth/page";

// The sign-in screen (E0-S5, docs/design/E0-S5.md). No app shell: one 400 px column in the top third,
// left-aligned at 96 px from tablet up. The title prerenders into the static shell; the form streams in
// behind Suspense because it first checks the session (Cache Components), so a signed-in Admin is sent on
// without ever seeing the form. The page title stays "BFTM Planner" (the root layout's default).
export default function SignInPage({ searchParams }: PageProps<"/masuk">) {
  return (
    <main className="flex w-full flex-1 flex-col px-4 pt-12 pb-12 md:pt-24 md:pl-24">
      <div className="flex w-full max-w-[400px] flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">BFTM Planner</h1>
          <p className="text-base text-muted-foreground">Masuk untuk mengelola Prospect dan Pipeline tim.</p>
        </header>
        <Suspense fallback={<SignInFormSkeleton />}>
          <SignInGate searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function SignInGate({ searchParams }: { searchParams: PageProps<"/masuk">["searchParams"] }) {
  const raw = (await searchParams).next;
  const next = typeof raw === "string" ? raw : undefined;
  // Already signed in: go on to the page asked for (a safe `next`), or the dashboard.
  if (await getAdmin()) redirect(safeNext(next));
  return <SignInForm next={next} />;
}

function SignInFormSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-5">
      {[0, 1].map((field) => (
        <div key={field} className="flex flex-col gap-2">
          <span className="h-6 w-24 rounded-lg bg-muted" />
          <span className="h-12 w-full rounded-lg bg-muted" />
        </div>
      ))}
      <span className="mt-1 h-12 w-full rounded-lg bg-muted" />
    </div>
  );
}
