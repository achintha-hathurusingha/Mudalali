import Link from "next/link";
import { signOut } from "@/app/actions";

const LINKS = [
  { href: "/approvals", label: "Approvals" },
  { href: "/catalog", label: "Stock" },
  { href: "/orders", label: "Orders" },
  { href: "/settings", label: "Agent" },
];

/**
 * Floating glass bar. The active route is filled rather than underlined, so it
 * reads at a glance on a phone held at arm's length behind a counter.
 */
export function Nav({ current }: { current: string }) {
  return (
    <header className="rise mb-10 flex flex-wrap items-center justify-between gap-4">
      <Link href="/settings" className="group flex items-center gap-3">
        <span
          className="grid size-9 place-items-center rounded-xl text-sm font-bold text-[#1a1206]"
          style={{ background: "var(--grad-money)" }}
          aria-hidden
        >
          ම
        </span>
        <span className="leading-tight">
          <span className="font-display block text-[15px] font-600 tracking-tight">Mudalali</span>
          <span className="text-faint block text-[11px]" lang="si">
            මුදලාලි
          </span>
        </span>
      </Link>

      <nav className="glass flex items-center gap-1 rounded-full p-1">
        {LINKS.map((link) => {
          const active = link.href === current;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "bg-surface-3 text-foreground rounded-full px-3.5 py-1.5 text-sm font-medium shadow-sm"
                  : "text-dim hover:text-foreground hover:bg-surface-2 rounded-full px-3.5 py-1.5 text-sm transition-colors"
              }
            >
              {link.label}
            </Link>
          );
        })}
        <form action={signOut}>
          <button
            type="submit"
            className="text-faint hover:text-rose cursor-pointer rounded-full px-3 py-1.5 text-sm transition-colors"
          >
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}
