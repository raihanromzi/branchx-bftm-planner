"use client";

import { Ellipsis, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { MAIN_DESTINATIONS, SETTINGS_DESTINATIONS, SETTINGS_PREFIX, isCurrent } from "./destinations";
import { SignOutButton } from "./sign-out-button";

const itemClass =
  "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-sm font-medium text-muted-foreground";

/** The icon with its indicator: an --accent pill behind it when current, so colour is never the only signal. */
function NavIcon({ icon: Icon, current }: { icon: typeof Ellipsis; current: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("flex h-7 w-12 items-center justify-center rounded-full", current && "bg-accent")}
    >
      <Icon className="size-6" strokeWidth={current ? 2.5 : 2} />
    </span>
  );
}

/** Mobile and tablet navigation (below 1024 px): four destinations and "Lainnya". */
export function BottomNav({ className }: { className?: string }) {
  const routePathname = usePathname();
  const [pathname, setPathname] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  // Next.js documents this two-phase render to avoid pathname hydration mismatches after client navigation.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPathname(routePathname), [routePathname]);
  const settingsCurrent = isCurrent(pathname, SETTINGS_PREFIX);

  return (
    <nav
      aria-label="Navigasi utama"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      <ul className="flex h-(--bottom-nav-height) items-stretch px-1">
        {MAIN_DESTINATIONS.map(({ href, label, icon }) => {
          const current = isCurrent(pathname, href);
          return (
            <li key={href} className="flex flex-1 py-1">
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(itemClass, current && "font-semibold text-primary")}
              >
                <NavIcon icon={icon} current={current} />
                {label}
              </Link>
            </li>
          );
        })}
        <li className="flex flex-1 py-1">
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger
              aria-current={settingsCurrent ? "page" : undefined}
              className={cn(itemClass, settingsCurrent && "font-semibold text-primary")}
            >
              <NavIcon icon={Ellipsis} current={settingsCurrent} />
              Lainnya
            </SheetTrigger>
            <SheetContent side="bottom" className="gap-0 rounded-t-lg pb-[calc(env(safe-area-inset-bottom)+8px)]">
              <SheetHeader className="px-4 pt-4 pb-2">
                <SheetTitle className="text-xl font-semibold">Lainnya</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col px-2 pb-2">
                <p className="flex items-center gap-3 px-3 pt-2 pb-1 text-sm font-medium text-muted-foreground">
                  <Settings aria-hidden className="size-5" />
                  Pengaturan
                </p>
                <ul>
                  {SETTINGS_DESTINATIONS.map(({ href, label }) => {
                    const current = isCurrent(pathname, href);
                    return (
                      <li key={href}>
                        <Link
                          href={href}
                          onClick={() => setMoreOpen(false)}
                          aria-current={current ? "page" : undefined}
                          className={cn(
                            "relative flex min-h-12 items-center rounded-lg pr-3 pl-11 text-base",
                            current
                              ? "bg-accent font-semibold text-primary before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary"
                              : "hover:bg-accent",
                          )}
                        >
                          {label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <Separator className="my-2" />
                <SignOutButton className="min-h-12 text-base" />
              </div>
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  );
}
