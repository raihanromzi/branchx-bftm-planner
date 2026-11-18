"use client";

import { Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { MAIN_DESTINATIONS, SETTINGS_DESTINATIONS, isCurrent } from "./destinations";
import { SignOutButton } from "./sign-out-button";

/** Current item: accent text, 600 weight, a tinted row and a 3 px bar on the left (never colour alone). */
function rowClass(current: boolean) {
  return cn(
    "relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium",
    current
      ? "bg-accent font-semibold text-primary before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary"
      : "text-foreground hover:bg-accent",
  );
}

/** Desktop navigation (1024 px and wider). `account` shows the signed-in email. */
export function Sidebar({ account, className }: { account: ReactNode; className?: string }) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "sticky top-0 h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-4",
        className,
      )}
    >
      <p className="px-3 pb-4 text-base font-semibold">BFTM Planner</p>
      <nav aria-label="Navigasi utama" className="flex flex-1 flex-col gap-4 overflow-y-auto">
        <ul className="flex flex-col gap-1">
          {MAIN_DESTINATIONS.map(({ href, label, icon: Icon }) => {
            const current = isCurrent(pathname, href);
            return (
              <li key={href}>
                <Link href={href} aria-current={current ? "page" : undefined} className={rowClass(current)}>
                  <Icon aria-hidden className="size-5 shrink-0" strokeWidth={current ? 2.5 : 2} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col gap-1">
          <p className="flex h-8 items-center gap-3 px-3 text-sm font-medium text-muted-foreground">
            <Settings aria-hidden className="size-5 shrink-0" />
            Pengaturan
          </p>
          <ul className="flex flex-col gap-1">
            {SETTINGS_DESTINATIONS.map(({ href, label }) => {
              const current = isCurrent(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={current ? "page" : undefined}
                    className={cn(rowClass(current), "pl-11")}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
      <Separator className="my-3" />
      <div className="flex flex-col gap-1">
        <div className="truncate px-3 text-sm text-muted-foreground">{account}</div>
        <SignOutButton className="h-10 text-sm" />
      </div>
    </aside>
  );
}
