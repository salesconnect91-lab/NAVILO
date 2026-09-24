import { ArrowRight, FileText, Landmark, Truck, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { hasPermission, type ModuleKey } from "@/auth/permissions";

export default function ImportCenter() {
  const { activeCompany, activeBusinessUnit, isPlatformOwner } = useAuth();
  const role = activeBusinessUnit?.membership_role ?? activeCompany?.membership_role;
  const permissions = activeBusinessUnit?.permissions ?? activeCompany?.permissions;
  const canImport = (module: ModuleKey) =>
    (activeCompany?.enabled_modules?.includes(module) ?? true) &&
    (activeBusinessUnit?.enabled_modules.includes(module) ?? true) &&
    (isPlatformOwner || hasPermission(role, module, "create", permissions, false));

  const cards = [
    { title: "Bank Data", detail: "Statement file import is not available yet.", icon: Landmark, destinations: [] },
    { title: "Customers", detail: "Use the customer Excel/CSV template.", icon: Users, destinations: canImport("master") ? [{ label: "Open customer import", to: "/master-data/customers" }] : [] },
    { title: "Suppliers", detail: "Use the supplier Excel/CSV template.", icon: Truck, destinations: canImport("master") ? [{ label: "Open supplier import", to: "/master-data/suppliers" }] : [] },
    { title: "Invoices", detail: "Upload draft invoices using a CSV template.", icon: FileText, destinations: [
      ...(canImport("sales") ? [{ label: "Sales", to: "/sales" }] : []),
      ...(canImport("purchase") ? [{ label: "Purchase", to: "/purchase" }] : []),
    ] },
  ];

  return <div className="mx-auto max-w-6xl space-y-5 py-3">
    <div><h1 className="text-xl font-bold text-slate-900">Import Center</h1><p className="mt-1 text-sm text-slate-600">Choose a data type, download its template and review records before posting.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(card => {
        const Icon = card.icon;
        return <section key={card.title} className="flex min-h-52 flex-col items-center rounded-xl border border-slate-200 bg-white px-5 py-6 text-center shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Icon className="h-6 w-6" aria-hidden="true"/></div>
          <h2 className="mt-4 text-sm font-bold text-slate-900">{card.title}</h2>
          <p className="mt-1 min-h-10 text-xs leading-5 text-slate-600">{card.detail}</p>
          {card.destinations.length ? <div className="mt-auto flex flex-wrap justify-center gap-2 pt-3">{card.destinations.map(destination =>
            <Link key={destination.to} to={destination.to} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">{destination.label}<ArrowRight className="h-3.5 w-3.5"/></Link>
          )}</div> : <span className="mt-auto pt-3 text-xs font-medium text-slate-500">{card.title === "Bank Data" ? "Not available" : "No import permission"}</span>}
        </section>;
      })}
    </div>
  </div>;
}
