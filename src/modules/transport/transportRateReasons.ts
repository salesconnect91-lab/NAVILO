export const CUSTOMER_RATE_REASON_OPTIONS = [
 "Customer rate updated",
 "Customer agreed rate revised",
 "Customer confirmation received",
 "Rate entered incorrectly",
 "Route / trip details corrected",
 "Rate list correction",
 "Commercial adjustment",
] as const;

export const SUPPLIER_RATE_REASON_OPTIONS = [
 "Supplier rent updated",
 "Supplier agreed rent revised",
 "Supplier rent finalized",
 "Supplier confirmation received",
 "Rent entered incorrectly",
 "Vehicle / route details corrected",
 "Commercial adjustment",
] as const;

export const TRIP_EDIT_REASON_OPTIONS = [
 "Trip details updated",
 "Data entry correction",
 "Trip date correction",
 "Customer / job details correction",
 "Truck Type / vehicle correction",
 "Driver / assignment replacement",
 "Route / location correction",
 "Customer rate correction",
 "Supplier rent correction",
 "Driver Pay correction",
] as const;
export const TRIP_DELETE_REASON_OPTIONS = [
 "Unposted Trip removed",
 "Trip created by mistake",
 "Duplicate Trip entry",
 "Incorrect customer or vehicle selected",
 "Trip cancelled before operations",
 "Test / training entry entered in error",
] as const;
export const CUSTOMER_CHARGE_REASON_OPTIONS = [
 "Customer charges updated",
 "Waiting charges added / revised",
 "Loading / unloading charges revised",
 "Customer charge entered incorrectly",
 "Customer charge confirmed",
 "Charge removed as agreed",
 "Commercial adjustment",
] as const;
export const SUPPLIER_CHARGE_REASON_OPTIONS = [
 "Supplier charges updated",
 "Waiting charges added / revised",
 "Loading / unloading charges revised",
 "Supplier charge entered incorrectly",
 "Supplier charge confirmed",
 "Charge removed as agreed",
 "Commercial adjustment",
] as const;
export const FINANCE_REASON_OPTIONS = [
 "Invoice details updated",
 "Accounting data entry correction",
 "Revised commercial agreement",
 "Invoice / rent correction",
 "Credit / debit note adjustment",
 "Supporting document correction",
] as const;
export const SETTLEMENT_REASON_OPTIONS = [
 "Payment / receipt corrected",
 "Payment / receipt amount correction",
 "Wrong Cash / Bank account selected",
 "Duplicate receipt / payment correction",
 "Allocation correction",
 "Bank reconciliation adjustment",
] as const;
export const EXPENSE_REASON_OPTIONS = [
 "Trip expense updated",
 "Approved trip operating expense",
 "Vehicle / workshop expense",
 "Supplier cost adjustment",
 "Expense entry correction",
] as const;
export const JOB_REASON_OPTIONS = [
 "Trip status updated",
 "Delivery completed and confirmed",
 "PPR received and verified",
 "Operations team confirmation",
 "Administrative closure",
] as const;

export const INVOICE_DELETE_REASON_OPTIONS = [
 "Invoice removed",
 "Invoice created by mistake",
 "Duplicate invoice entry",
 "Incorrect Trip selection",
 "Test / training invoice cleanup",
] as const;
export const INVOICE_NOTE_REASON_OPTIONS = [
 "Credit / debit note issued",
 "Invoice amount correction",
 "Revised commercial agreement",
 "Incorrect invoice entry",
 "Supporting document correction",
] as const;
export type TransportReasonKind = "trip_edit"|"trip_delete"|"customer_rate"|"supplier_rate"|"customer_charges"|"supplier_charges"|"finance"|"settlement"|"expense"|"job"|"invoice_delete"|"invoice_note";
export const TRANSPORT_REASON_OPTIONS: Record<TransportReasonKind, readonly string[]> = {
 invoice_delete: INVOICE_DELETE_REASON_OPTIONS,
 invoice_note: INVOICE_NOTE_REASON_OPTIONS,
 trip_edit: TRIP_EDIT_REASON_OPTIONS,
 trip_delete: TRIP_DELETE_REASON_OPTIONS,
 customer_rate: CUSTOMER_RATE_REASON_OPTIONS,
 supplier_rate: SUPPLIER_RATE_REASON_OPTIONS,
 customer_charges: CUSTOMER_CHARGE_REASON_OPTIONS,
 supplier_charges: SUPPLIER_CHARGE_REASON_OPTIONS,
 finance: FINANCE_REASON_OPTIONS,
 settlement: SETTLEMENT_REASON_OPTIONS,
 expense: EXPENSE_REASON_OPTIONS,
 job: JOB_REASON_OPTIONS,
};
export function reasonPresetValue(kind:TransportReasonKind, value:string, otherSelected=false):string {
 if(otherSelected)return "__other__";
 if(!value)return defaultTransportReason(kind);
 return TRANSPORT_REASON_OPTIONS[kind].includes(value) ? value : "__other__";
}

export function defaultTransportReason(kind:TransportReasonKind):string {
 return TRANSPORT_REASON_OPTIONS[kind][0];
}
