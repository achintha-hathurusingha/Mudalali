"use client";

import { useActionState } from "react";
import { signIn } from "@/app/actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, {} as { error?: string });

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <form action={action} className="rise glass w-full max-w-sm rounded-3xl p-7">
        <span
          className="grid size-11 place-items-center rounded-2xl text-base font-bold text-[#1a1206]"
          style={{ background: "var(--grad-money)" }}
          aria-hidden
        >
          ම
        </span>

        <h1 className="font-display mt-5 text-2xl font-semibold tracking-tight">Mudalali</h1>
        <p className="text-dim mt-1 text-sm">
          <span lang="si">මුදලාලි</span> — the shop console
        </p>

        <label htmlFor="password" className="text-dim mt-7 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          className="bg-surface-2 border-line focus:border-saffron mt-2 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors"
        />
        {state?.error ? (
          <p className="text-rose mt-2 text-sm" role="alert">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="bg-saffron mt-5 w-full cursor-pointer rounded-xl py-2.5 text-sm font-semibold text-[#1a1206] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
        >
          {pending ? "Checking…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
