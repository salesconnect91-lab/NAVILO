import type { SupabaseClient } from "@supabase/supabase-js";

/** Delete a draft invoice, using the transport-aware cascade when one exists. */
export async function deleteDraftCommercialInvoice(
  client: SupabaseClient,
  side: "customer" | "supplier",
  orderId: string,
) {
  const table = side === "customer" ? "transport_customer_documents" : "transport_supplier_documents";
  const orderColumn = side === "customer" ? "sales_order_id" : "purchase_order_id";
  const { data: document, error: lookupError } = await client
    .from(table)
    .select("id")
    .eq(orderColumn, orderId)
    .maybeSingle();

  if (lookupError) throw lookupError;

  if (document?.id) {
    const { data, error } = await client.rpc("transport_delete_register_draft_invoice", {
      p_side: side,
      p_document_id: document.id,
    });
    if (error) throw error;
    if (data !== true && data?.deleted !== true) throw new Error("Draft transport invoice could not be deleted.");
    return;
  }

  const rpc = side === "customer" ? "delete_draft_sales_invoice" : "delete_draft_purchase_invoice";
  const { data, error } = await client.rpc(rpc, { p_order_id: orderId });
  if (error) throw error;
  if (data !== true) throw new Error(`Draft ${side} invoice could not be deleted.`);
}
