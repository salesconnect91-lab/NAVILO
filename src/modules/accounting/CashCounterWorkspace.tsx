import { NavLink } from "react-router-dom";
import CashCounter from "./CashCounter";

export default function CashCounterWorkspace(){
  return <div className="space-y-4">
    <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3" data-no-print data-no-export>
      <div className="flex flex-wrap gap-2">
        <NavLink to="/accounting/cash-counter" className={({isActive})=>isActive?"btn-primary":"btn-secondary"}>Cash Counter</NavLink>
        <NavLink to="/accounting/payroll" className="btn-secondary">Payroll & Salary Ledger</NavLink>
        <NavLink to="/accounting/loans" className="btn-secondary">Loan & Lender Ledger</NavLink>
      </div>
      <span data-navilo-standard-tools-host className="contents" />
    </div>
    <CashCounter />
  </div>;
}
