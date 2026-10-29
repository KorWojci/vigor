"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { icons } from "./icons";

export const NAV_ITEMS = [
  { href: "/today", label: "Today", icon: icons.today },
  { href: "/", label: "Dashboard", icon: icons.dashboard },
  { href: "/metrics", label: "Health metrics", icon: icons.metrics },
  { href: "/nutrition", label: "Nutrition", icon: icons.nutrition },
  { href: "/training", label: "Training", icon: icons.training },
  { href: "/body", label: "Body measurements", icon: icons.body },
  { href: "/integrations/apple-health", label: "Apple Health sync", icon: icons.apple },
  { href: "/settings", label: "Settings", icon: icons.settings },
];

// On the mobile topbar, Nav is rendered inside a <details> dropdown; <details> doesn't
// close itself when a descendant link is clicked, so close it by hand. No-op on the
// desktop sidebar, which has no <details> ancestor.
function closeMenu(e: React.MouseEvent<HTMLAnchorElement>) {
  e.currentTarget.closest("details")?.removeAttribute("open");
}

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {NAV_ITEMS.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} onClick={closeMenu}>
            {i.icon}
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
