import { Routes, Route } from "react-router-dom";
import CompanySettings from "./CompanySettings";
import TaxSettings from "./TaxSettings";
import DocumentPrintSettings from "./DocumentPrintSettings";
import OrderBookSettings from "./OrderBookSettings";
import GatePassWeighbridgeSettings from "./GatePassWeighbridgeSettings";
import AccessManagementSettings from "./AccessManagementSettings";
import ApprovalWorkflowSettings from "./ApprovalWorkflowSettings";

export default function Settings() {
  return (
    <Routes>
      <Route path="/" element={<CompanySettings />} />
      <Route path="/access" element={<AccessManagementSettings />} />
      <Route path="/approvals" element={<ApprovalWorkflowSettings />} />
      <Route path="/tax" element={<TaxSettings />} />
      <Route path="/documents" element={<DocumentPrintSettings />} />
      <Route path="/order-book" element={<OrderBookSettings />} />
      <Route path="/gate-pass" element={<GatePassWeighbridgeSettings />} />
    </Routes>
  );
}
