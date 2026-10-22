"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

/** Record a manually submitted application without opening the AI apply flow. */
export function MarkAppliedButton({ n }: { n: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function markApplied() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n, status: "Applied" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Couldn't update the tracker.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't confirm the update. Check the tracker before relying on it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={markApplied}
        disabled={busy}
        title="Record a manually submitted application without opening Apply"
        className="inline-flex items-center justify-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-400 max-sm:min-h-[44px]"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        {busy ? "Updating…" : "Mark applied"}
      </button>
      {error && <span role="alert" className="max-w-56 text-xs text-red-500">{error}</span>}
    </span>
  );
}
