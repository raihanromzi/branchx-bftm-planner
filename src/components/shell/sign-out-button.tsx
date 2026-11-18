"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * "Keluar": ends the session with POST /api/auth/sign-out, then loads /masuk. A 401 means the session had
 * already ended, which is also signed out. The refresh drops every cached signed-in screen.
 */
export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin" });
      if (response.status === 204 || response.status === 401) {
        router.replace("/masuk");
        router.refresh();
        return;
      }
    } catch {
      // Network failure: fall through to the message below.
    }
    setPending(false);
    setFailed(true);
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 text-left font-medium text-foreground hover:bg-accent disabled:cursor-progress disabled:opacity-60",
          className,
        )}
      >
        <LogOut aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        {pending ? "Keluar…" : "Keluar"}
      </button>
      {failed && (
        <p role="alert" className="px-3 text-sm text-danger">
          Gagal keluar. Periksa koneksi, lalu coba lagi.
        </p>
      )}
    </div>
  );
}
