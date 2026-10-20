"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { icons } from "./icons";

export const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: icons.dashboard },
  { href: "/metrics", label: "Health metrics", icon: icons.metrics },
  { href: "/nutrition", label: "Nutrition", icon: icons.nutrition },
  { href: "/training", label: "Training", icon: icons.training },
  { href: "/body", label: "Body measurements", icon: icons.body },
  { href: "/integrations/apple-health", label: "Apple Health sync", icon: icons.apple },
  { href: "/settings", label: "Settings", icon: icons.settings },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {NAV_ITEMS.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}>
            {i.icon}
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
