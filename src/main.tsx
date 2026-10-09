import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ApplicationErrorBoundary from "./components/ApplicationErrorBoundary";
import { AuthProvider } from "./auth/AuthContext";
import GlobalLanguageRuntime from "./components/GlobalLanguageRuntime";
import LanguageVisibilityRuntime from "./components/LanguageVisibilityRuntime";
import JurisdictionRuntime from "./components/JurisdictionRuntime";
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
import "./naviloAccountantUi.css";
import "./naviloModuleUi.css";
import "./modules/transport/transportProfessionalUi.css";
import "./naviloCompactSpacing.css";

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

rootElement.setAttribute("data-navilo-react-mounted", "true");

createRoot(rootElement).render(
  <StrictMode>
    <ApplicationErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <GlobalLanguageRuntime />
          <LanguageVisibilityRuntime />
          <JurisdictionRuntime><App /></JurisdictionRuntime>
        </AuthProvider>
      </BrowserRouter>
    </ApplicationErrorBoundary>
  </StrictMode>
);

const startOptionalRuntime = (label: string, loader: () => Promise<unknown>) => {
  void loader().catch((error) => {
    console.error(`[NAVILO startup] ${label} runtime failed`, error);
  });
};

// These DOM enhancement runtimes are not required to mount the application.
// Start them only after React has been mounted so a runtime import failure can
// never leave #root completely blank.

startOptionalRuntime("account name display", () => import("./accountNameDisplayRuntime"));
startOptionalRuntime("document language isolation", () => import("./documentLanguageIsolationRuntime"));
