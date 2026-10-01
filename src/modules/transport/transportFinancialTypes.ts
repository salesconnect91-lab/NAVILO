export type TransportFinanceAction = 'billing' | 'rent' | 'settlement' | 'driver' | 'cost' | 'adjustment' | 'close';
export const financeActions: TransportFinanceAction[] = ['billing','rent','settlement','driver','cost','adjustment','close'];
export type FinancialTrip = {
 id: string; trip_no: string; customer_id?: string; driver_id?: string; vehicle_id?: string;
 customer_name?: string|null; driver_name?: string|null; vehicle_no?: string|null; customer_rate?: number|null;
 owner_rent?: number|null; driver_pay?: number|null; trip_status?: string; financial_status?: string;
 customer_rate_locked?: boolean; supplier_rate_locked?: boolean; invoiced?: boolean;
 billed_customer_net?: number | null; billed_supplier_net?: number | null; driver_accrued?: number | null;
 received_from_company?: number | null; remaining_with_company?: number | null;
 remaining_with_us?: number | null; payment_date?: string | null; payment_amount?: number | null;
 customer_received_gross?: number; customer_outstanding_gross?: number; customer_credit_gross?: number;
 supplier_paid_net?: number; supplier_outstanding_gross?: number; supplier_credit_gross?: number;
 driver_paid?: number; driver_outstanding?: number; trip_profit?: number | null; commission_paid_net?: number;
};
export type ServiceBalance = {
 side: 'customer'|'supplier'; order_id: string; order_no: string; party_id: string;
 billed_net: number; billed_gross: number; paid_gross: number; refunded_gross: number;
 outstanding_gross: number; credit_gross: number; tax_percent: number;
};
export function financialNumber(value: unknown) {
 return value == null ? '' : Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}
