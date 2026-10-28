"use client";

// /cv is two surfaces, not one: the CV itself (cv.md) and the facts behind it
// that never appear on the page — date of birth, availability, salary floor,
// languages, EEO answers. A second route would have been easy, but these belong
// together (both answer "what do I know about this candidate?"), and the tab
// keeps the nav honest: one destination, two views.

import { useState } from "react";
import { cn } from "@/lib/cn";
import { CvEditor } from "@/components/cv-editor";
import { MyDataForm } from "@/components/cv/my-data-form";

const TABS = [
  { id: "cv", label: "CV" },
  { id: "data", label: "My data" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function CvTabs({ initialTab = "cv" }: { initialTab?: TabId }) {
  const [tab, setTab] = useState<TabId>(initialTab);

  return (
    <>
      <div className="mx-auto max-w-6xl px-6 pt-8">
        <div role="tablist" aria-label="CV" className="inline-flex gap-1 rounded-full border border-border bg-surface/60 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-colors max-sm:min-h-[44px]",
                tab === t.id ? "bg-brand text-brand-foreground" : "text-muted hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "cv" ? <CvEditor /> : <MyDataForm />}
    </>
  );
}
