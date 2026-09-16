import { Routes, Route } from "react-router-dom";
import PurchaseOrderList from "./PurchaseOrderList";
import MainPurchaseInvoice from "./MainPurchaseInvoiceV2";
import ConsolidatedPurchaseInvoices from "./ConsolidatedPurchaseInvoices";
import PurchaseInvoiceDetail from "./PurchaseInvoiceDetail";
import OrderBook from "@/modules/orders/OrderBook";
import PreInvoiceWorkspace from "@/modules/commercial/PreInvoiceWorkspace";

export default function Purchase() {
  return (
    <Routes>
      <Route path="/" element={<PurchaseOrderList />} />
      <Route path="/new" element={<MainPurchaseInvoice />} />
      <Route path="/consolidated" element={<ConsolidatedPurchaseInvoices />} />
      <Route path="/order-book" element={<OrderBook type="purchase" />} />
      <Route path="/workflow" element={<PreInvoiceWorkspace side="purchase" />} />
      <Route path="/:id" element={<PurchaseInvoiceDetail />} />
    </Routes>
  );
}
