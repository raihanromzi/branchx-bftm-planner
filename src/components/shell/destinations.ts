// The app shell's destinations (E0-S4, docs/design/E0-S4.md). The bottom nav shows the main ones plus
// "Lainnya"; the desktop sidebar shows the main ones plus the Pengaturan group.
import { Building2, CalendarDays, LayoutDashboard, MapIcon, type LucideIcon } from "lucide-react";

export type Destination = { href: string; label: string; icon: LucideIcon };

export const MAIN_DESTINATIONS: readonly Destination[] = [
  { href: "/", label: "Dasbor", icon: LayoutDashboard },
  { href: "/prospect", label: "Prospect", icon: Building2 },
  { href: "/jadwal", label: "Jadwal", icon: CalendarDays },
  { href: "/peta", label: "Peta", icon: MapIcon },
];

export const SETTINGS_DESTINATIONS: readonly Omit<Destination, "icon">[] = [
  { href: "/pengaturan/funding-officer", label: "Funding Officer" },
  { href: "/pengaturan/template-pipeline", label: "Template Pipeline" },
  { href: "/pengaturan/target", label: "Target" },
];

export const SETTINGS_PREFIX = "/pengaturan";

/** Whether `href` is the current destination: "/" only on the dashboard, any other one on it or below it. */
export function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
