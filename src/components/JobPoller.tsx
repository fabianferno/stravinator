"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { JobStatus } from "@/lib/types";

const POLL_MS = 2000;

/**
 * Refreshes the rendering screen while a job is still in flight. Renders
 * nothing — the screen itself is a server component, so progress comes from
 * re-fetching it rather than from client state. That keeps a single source of
 * truth and means the bar can never drift ahead of real work.
 */
export function JobPoller({ jobId, status }: { jobId: string; status: JobStatus }) {
  const router = useRouter();
  const finished = status === "done" || status === "failed";

  useEffect(() => {
    if (finished) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) router.refresh();
      } catch {
        // A dropped poll is not worth surfacing; the next tick retries.
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };

    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, finished, router]);

  return null;
}
