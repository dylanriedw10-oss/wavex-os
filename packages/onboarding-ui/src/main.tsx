import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MissionControl from "./pages/MissionControl";
import Pricing from "./pages/Pricing";
import TonyApplePricing from "./pages/TonyApplePricing";
import DesignPartners from "./pages/DesignPartners";
import { Signup } from "./pages/Signup";
import CanvasPage from "./canvas/CanvasPage";
import { CompanyProvider } from "./wavex-os/lib/CompanyContext";
import { OnboardingShell } from "./wavex-os/pages/OnboardingShell";
import { OnboardingWizard } from "./wavex-os/components/OnboardingWizard";
import { QaCelebrationController } from "./wavex-os/components/QaCelebrationController";
import { AvatarDashboard } from "./pages/AvatarDashboard";
import { AvatarSettings } from "./pages/AvatarSettings";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <CompanyProvider>
          <OnboardingWizard />
          <QaCelebrationController />
          <Routes>
            <Route path="/" element={<MissionControl />} />
            {/* Legacy wizard route redirected to the chat-first flow.
                 WavexOsOnboarding component is retained as dead code for
                 reference; not reachable through any UI link. */}
            <Route path="/onboarding" element={<Navigate to="/onboarding-chat" replace />} />
            <Route path="/onboarding-chat" element={<OnboardingShell />} />
            <Route path="/avatar/:id" element={<AvatarDashboard />} />
            <Route path="/avatar/:id/settings" element={<AvatarSettings />} />
            <Route path="/pricing" element={<TonyApplePricing />} />
            <Route path="/lp/design-partners" element={<DesignPartners />} />
            <Route path="/wavex-pricing" element={<Pricing />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/canvas" element={<CanvasPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </CompanyProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
