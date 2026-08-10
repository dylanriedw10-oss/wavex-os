/** The ignition read, and the one write that acts on it.
 *
 *  Mission Control had NO read of ignition state at all — the endpoint has
 *  shipped since the plan's Phase 1, `wavexOsOnboardingApi.igniteFleet` has
 *  shipped with zero call sites, and the only way an operator could retry a
 *  failed ignition was to type "ignite the fleet" into the /canvas chat.
 *
 *  A hook rather than inline `useQuery`, because the read and the write are
 *  one unit: igniting is only meaningful as "make this status true", and the
 *  invalidation that follows is what makes the banner report the result
 *  instead of the operator's hope. Splitting them is how a button ends up
 *  claiming success on a POST nobody re-read. */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { wavexOsOnboardingApi, ApiError } from "../../wavex-os/lib/api";
import type { IgnitionStatusResponse } from "../../canvas/contract";

/** Slow on purpose. Ignition is not a live metric — it changes when the
 *  operator activates or ignites, both of which invalidate this key
 *  directly. Polling exists only so a run started elsewhere (the /build
 *  flow, the canvas composer) shows up without a reload. */
const POLL_MS = 15_000;

export function useIgnitionStatus(companyId: string | null) {
  const qc = useQueryClient();
  const [igniting, setIgniting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery<IgnitionStatusResponse>({
    enabled: !!companyId,
    // The SAME key the canvas cells bind to, so a retry here refreshes the
    // attention cell too — one fact, one cache entry.
    queryKey: ["ignition", companyId],
    queryFn: () => wavexOsOnboardingApi.getIgnitionStatus(companyId!),
    refetchInterval: POLL_MS,
    // One retry. A failed read here is reported, not hidden behind a long
    // backoff, and the poll above keeps trying regardless.
    retry: 1,
  });

  async function ignite(): Promise<void> {
    if (!companyId) return;
    setIgniting(true);
    setError(null);
    try {
      await wavexOsOnboardingApi.igniteFleet(companyId);
      // Re-read before releasing the busy state. The POST returns a report,
      // but the BANNER is a statement about persisted state, and the only
      // honest source for that is the read. Ignition is partial-tolerant, so
      // a resolved POST does not mean the fleet came up.
      await qc.invalidateQueries({ queryKey: ["ignition", companyId] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setIgniting(false);
    }
  }

  return { query: q, ignite, igniting, error };
}
