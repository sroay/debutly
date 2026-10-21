"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Arrow keys (or j/k) move through the steps; the current step stays in view in the list. */
export function StepKeys({ prev, next }: { prev: string | null; next: string | null }) {
  const router = useRouter();
  useEffect(() => {
    document.querySelector('.steps [aria-current="step"]')?.scrollIntoView({ block: "nearest" });
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === "ArrowLeft" || e.key === "k") && prev) router.push(prev, { scroll: false });
      if ((e.key === "ArrowRight" || e.key === "j") && next) router.push(next, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, router]);
  return null;
}
