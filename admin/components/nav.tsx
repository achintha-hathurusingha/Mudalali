import Link from "next/link";
import { signOut } from "@/app/actions";

const LINKS = [
  { href: "/approvals", label: "Approvals" },
  { href: "/catalog", label: "Stock" },
  { href: "/orders", label: "Orders" },
  { href: "/settings", label: "Agent" },
];

/**
 * The ledger's masthead. Ruled underneath, like the header of an account book,
 * with the current page inked rather than boxed.
 */
export function Nav({ current }: { current: string }) {
  return (
    <header className="border-rule-strong mb-10 flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b pb-3">
      <div className="flex items-baseline gap-3">
        <Link href="/settings" className="font-display text-2xl leading-none tracking-tight">
          Mudalali
        </Link>
        <span className="text-ink-faint text-sm leading-none" lang="si">
          මුදලාලි
        </span>
      </div>

      <nav className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {LINKS.map((link) => {
          const active = link.href === current;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "decoration-stop text-ink text-sm font-medium underline decoration-2 underline-offset-[7px]"
                  : "text-ink-soft hover:text-ink text-sm transition-colors"
              }
            >
              {link.label}
            </Link>
          );
        })}
        <form action={signOut} className="ml-2">
          <button
            type="submit"
            className="text-ink-faint hover:text-ink cursor-pointer text-sm transition-colors"
          >
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}
