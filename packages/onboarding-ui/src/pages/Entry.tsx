/** The front door.
 *
 *  A first-run operator has nothing to operate. Landing them on Mission
 *  Control gave them a dashboard of empty slots — "No company selected",
 *  an empty KPI scoreboard, "Loading fleet…", a Claude Max allocation
 *  slider — and a "Start onboarding →" button somewhere inside it. The
 *  product's onboarding surface is /build (chat left, canvas right), and
 *  before this there was no first-run state anywhere in the UI.
 *
 *  So: no companies at all → go to /build. Anything exists → Mission
 *  Control, which is what it is for.
 *
 *  The question is deliberately "are there ANY companies", not "is one
 *  selected". The no-company-SELECTED card stays correct and reachable for
 *  an operator who has companies but has not picked one — that is a
 *  different state and it keeps its own copy.
 *
 *  `replace` so the redirect does not trap the back button in a loop. */
import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";

type Decision = "deciding" | "onboard" | "dashboard";

/** A gate over its children rather than a renderer of Mission Control:
 *  the route wraps Mission Control in <Legacy> for the dark-surface
 *  styling, and rendering it bare here would silently drop that. */
export function Entry({ children }: { children: ReactNode }): JSX.Element | null {
  const [decision, setDecision] = useState<Decision>("deciding");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/companies")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { companies?: unknown[] };
        if (cancelled) return;
        setDecision((j.companies?.length ?? 0) === 0 ? "onboard" : "dashboard");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Fail towards the dashboard, and say so. Redirecting an operator
        // who DOES have companies into onboarding because one fetch failed
        // is the worse error of the two — it looks like their work is gone.
        // Silence is the other failure mode this repo has already been
        // bitten by, so this is loud even though it is recoverable.
        console.error(
          "[entry] GET /api/companies failed; landing on Mission Control instead of deciding. " +
            "A first-run operator will see the dashboard's empty state rather than the build flow.",
          e,
        );
        setDecision("dashboard");
      });
    return () => { cancelled = true; };
  }, []);

  // Render nothing while deciding: showing Mission Control first and then
  // redirecting would flash a dashboard of empty slots at exactly the
  // operator this exists to spare.
  if (decision === "deciding") return null;
  if (decision === "onboard") return <Navigate to="/build" replace />;
  return <>{children}</>;
}
