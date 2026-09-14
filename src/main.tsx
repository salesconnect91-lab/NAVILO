import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import GlobalLanguageRuntime from "./components/GlobalLanguageRuntime";
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
import "./naviloProfessionalReports.css";
import "./documentLanguage.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <GlobalLanguageRuntime />
        <JurisdictionRuntime />
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
