import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MissionControl from "./pages/MissionControl";
import Pricing from "./pages/Pricing";
import TonyApplePricing from "./pages/TonyApplePricing";
import DesignPartners from "./pages/DesignPartners";
import { Signup } from "./pages/Signup";
import CanvasPage from "./canvas/CanvasPage";
import BuildOrgPage from "./build/BuildOrgPage";
import { ReasoningCanvas } from "./reasoning/ReasoningCanvas";
import { CompanyProvider } from "./wavex-os/lib/CompanyContext";
import { QaCelebrationController } from "./wavex-os/components/QaCelebrationController";
import { AvatarDashboard } from "./pages/AvatarDashboard";
import { AvatarSettings } from "./pages/AvatarSettings";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

/** Opt a route out of the light default (see `.legacy-dark` in styles.css).
 *  Wrapping at the route is the only single point that works for all of
 *  them — DesignPartners returns a fragment, so it has no root element of
 *  its own to hang a class on. */
/** Redirect that KEEPS the query string.
 *
 *  `<Navigate to="/build" />` drops `?companyId=…`, and every link into
 *  onboarding carries one — a bare redirect would drop the operator into a
 *  fresh build for no company at all. */
function KeepQuery({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

function Legacy({ children }: { children: React.ReactNode }) {
  return <div className="legacy-dark">{children}</div>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <CompanyProvider>
          {/* ORPHANED, not deleted: the 3-step operator overlay
              (OnboardingWizard — "Connect your repo" / "Connect your
              workspace" / "Run your first smoke test"). It predates the
              cutover and was never unmounted, so while is_new_user=true it
              rendered above <Routes> on every surface and a brand-new
              operator's FIRST screen was "Connect your repo" rather than the
              build flow. Onboarding is /build: chat on the left, canvas on
              the right, always. Two "STEP 1 OF n" wizards in front of each
              other is what the cutover existed to remove.

              It was invisible until the migration journal was repaired —
              /api/users/me was 500ing and the component's catch read that as
              "no backend" — so this collision is younger than it looks.

              The component and its server routes are intact. Repo
              connection and the first smoke test are worth having; they
              belong INSIDE the build flow, not in front of it. See
              e2e/RETIRED.md. */}
          <QaCelebrationController />
          <Routes>
            {/* `.legacy-dark` marks the surfaces NOT yet standardized on the
                architectural system (styles.css). Light is the product
                default now; these opt back out so they render exactly as
                they did before the inversion. Remove the wrapper when the
                surface is redesigned — Mission Control's rebuild is scoped
                in docs/MISSION_CONTROL_SALVAGE.md. */}
            <Route path="/" element={<Legacy><MissionControl /></Legacy>} />
            {/* CUTOVER: both legacy onboarding entrances now land on Build
                Your Organization. The query string is PRESERVED — every
                inbound link carries ?companyId=, and dropping it would strand
                the operator on a fresh flow for the wrong company. */}
            <Route path="/onboarding" element={<KeepQuery to="/build" />} />
            <Route path="/onboarding-chat" element={<KeepQuery to="/build" />} />
            <Route path="/avatar/:id" element={<AvatarDashboard />} />
            <Route path="/avatar/:id/settings" element={<AvatarSettings />} />
            <Route path="/pricing" element={<Legacy><TonyApplePricing /></Legacy>} />
            <Route path="/lp/design-partners" element={<Legacy><DesignPartners /></Legacy>} />
            <Route path="/wavex-pricing" element={<Legacy><Pricing /></Legacy>} />
            <Route path="/signup" element={<Legacy><Signup /></Legacy>} />
            <Route path="/canvas" element={<CanvasPage />} />
            {/* Build Your Organization — the five-phase canvas-first flow.
                THE onboarding surface: /onboarding and /onboarding-chat both
                redirect here. */}
            <Route path="/build" element={<BuildOrgPage />} />
            {/* The Living Canvas — the organization's understanding of
                itself. Additive and read-only: it renders the reasoning
                model without touching the build flow. */}
            <Route path="/reasoning" element={<ReasoningCanvas />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </CompanyProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
