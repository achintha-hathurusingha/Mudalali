import Link from "next/link";
import { signOut } from "@/app/actions";
import { Button } from "@/components/ui/button";

const LINKS = [
  { href: "/approvals", label: "Approvals" },
  { href: "/catalog", label: "Catalog" },
  { href: "/orders", label: "Orders" },
  { href: "/settings", label: "Agent" },
];

/** Shared chrome for every screen. Owned centrally so screens stay consistent. */
export function Nav({ current }: { current: string }) {
  return (
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b pb-4">
      <nav className="flex flex-wrap items-center gap-1">
        <span className="mr-3 font-semibold tracking-tight">Mudalali</span>
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={
              link.href === current
                ? "bg-accent rounded-md px-3 py-1.5 text-sm font-medium"
                : "text-muted-foreground hover:bg-accent/50 rounded-md px-3 py-1.5 text-sm"
            }
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="sm">
          Sign out
        </Button>
      </form>
    </header>
  );
}
