import { NavLink } from "react-router-dom";
import CashCounter from "./CashCounter";

const links = [
  { to: "/accounting/cash-counter", label: "Cash Counter", end: true },
  { to: "/accounting/payroll", label: "Payroll & Salary" },
  { to: "/accounting/loans", label: "Loans" },
  { to: "/accounting/daily-closing", label: "Daily Closing" },
];

export default function CashCounterWorkspace() {
  return (
    <div className="min-w-0 space-y-2">
      <nav
        aria-label="Cash Counter related pages"
        className="no-print flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5"
        data-no-print
        data-no-export
      >
        {links.map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `inline-flex min-h-8 items-center rounded-md px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                isActive
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`
            }
          >
            {label}
          </NavLink>
        ))}
        <span data-navilo-standard-tools-host className="contents" />
      </nav>
      <CashCounter />
    </div>
  );
}
