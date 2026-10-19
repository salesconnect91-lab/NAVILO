import { Routes, Route } from "react-router-dom";
import {useAuth} from "@/auth/AuthContext";
import TransportInvoiceCreate from "@/modules/transport/TransportInvoiceCreate";
import PurchaseOrderList from "./PurchaseOrderList";
import MainPurchaseInvoice from "./MainPurchaseInvoiceV2";
import ConsolidatedPurchaseInvoices from "./ConsolidatedPurchaseInvoices";
import PurchaseInvoiceDetail from "./PurchaseInvoiceDetail";
import GeneralExpenseBillCreate from "./GeneralExpenseBillCreate";
import GeneralExpenseBillImport from "./GeneralExpenseBillImport";
import OrderBook from "@/modules/orders/OrderBook";
import PreInvoiceWorkspace from "@/modules/commercial/PreInvoiceWorkspace";
import ConsolidatedInvoiceGuard from "@/components/ConsolidatedInvoiceGuard";

function PurchaseNewRoute(){
 const {activeBusinessUnit}=useAuth();
 return activeBusinessUnit?.business_unit_type==="transport" ? <TransportInvoiceCreate side="supplier"/> : <MainPurchaseInvoice/>;
}
export default function Purchase() {
  return (
    <Routes>
      <Route index element={<PurchaseOrderList />} />
      <Route path="new" element={<PurchaseNewRoute />} />
      <Route path="expense/new" element={<GeneralExpenseBillCreate />} />
      <Route path="expense/import" element={<GeneralExpenseBillImport />} />
      <Route path="consolidated" element={<ConsolidatedInvoiceGuard side="purchase"><ConsolidatedPurchaseInvoices /></ConsolidatedInvoiceGuard>} />
      <Route path="order-book" element={<OrderBook type="purchase" />} />
      <Route path="workflow" element={<PreInvoiceWorkspace side="purchase" />} />
      <Route path=":id" element={<PurchaseInvoiceDetail />} />
    </Routes>
  );
}
