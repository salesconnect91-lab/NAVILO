import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ApplicationErrorBoundary from "./components/ApplicationErrorBoundary";
import { AuthProvider } from "./auth/AuthContext";
import GlobalLanguageRuntime from "./components/GlobalLanguageRuntime";
import LanguageVisibilityRuntime from "./components/LanguageVisibilityRuntime";
import JurisdictionRuntime from "./components/JurisdictionRuntime";
import "./printTargetRuntime";
import "./accountNameDisplayRuntime";
import "./documentLanguageIsolationRuntime";
import "./index.css";
import "./contrast.css";
import "./reportPrint.css";
import "./naviloDocumentPrint.css";
import "./naviloEnterprisePrint.css";
import "./naviloPrintParityFix.css";
import "./gatePassPrintFix.css";
import "./printPreviewIsolation.css";
import "./orderBook.css";
import "./accountingStatements.css";
import "./erpProfessionalSystem.css";
import "./invoiceEntryColumnWidths.css";
import "./naviloProfessionalReports.css";
import "./documentLanguage.css";

// A deployment can replace hashed Vite chunks while an already-open browser tab still
// holds the previous entry bundle. Recover once instead of leaving NAVILO on a spinner.
const DEPLOY_RELOAD_KEY = "navilo.deploy-reload";
const recoverFromStaleChunk = (event?: Event) => {
  event?.preventDefault();
  if (sessionStorage.getItem(DEPLOY_RELOAD_KEY) === "1") return;
  sessionStorage.setItem(DEPLOY_RELOAD_KEY, "1");
  window.location.reload();
};
window.addEventListener("vite:preloadError", recoverFromStaleChunk);
window.addEventListener("unhandledrejection", (event) => {
  const message = String(event.reason?.message ?? event.reason ?? "");
  if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message)) recoverFromStaleChunk(event);
});
window.addEventListener("load", () => window.setTimeout(() => sessionStorage.removeItem(DEPLOY_RELOAD_KEY), 5_000), { once: true });

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("NAVILO root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <ApplicationErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <GlobalLanguageRuntime />
          <LanguageVisibilityRuntime />
          <JurisdictionRuntime />
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ApplicationErrorBoundary>
  </StrictMode>
);
