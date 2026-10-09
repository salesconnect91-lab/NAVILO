import { Boxes, Building2, CheckCircle2, CircleDollarSign, Database, Layers3, PackageOpen, Ruler, Truck, Users, UserRound, Warehouse, XCircle } from "lucide-react";

type Kind="categories"|"customers"|"suppliers"|"employees"|"warehouses"|"godowns"|"uom"|"transporters"|"vehicles"|"drivers"|"charges";
const icons={categories:Layers3,customers:Users,suppliers:Building2,employees:UserRound,warehouses:Warehouse,godowns:Boxes,uom:Ruler,transporters:Truck,vehicles:Truck,drivers:UserRound,charges:CircleDollarSign} as const;

export default function MasterSummaryStrip({kind,title,subtitle,total,active,inactive,fourthLabel,fourthValue}:{kind:Kind;title:string;subtitle:string;total:number;active:number;inactive:number;fourthLabel:string;fourthValue:number|string}){
 const MainIcon=icons[kind]??PackageOpen;
 return <section data-navilo-summary-strip="true" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-no-print data-no-export>
  <div className="grid min-h-[40px] grid-cols-[1.75fr_repeat(4,minmax(0,1fr))] divide-x divide-slate-200">
   <div className="flex items-center gap-3 px-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600"><MainIcon className="h-5 w-5"/></span><div><h1 className="text-xl font-bold text-slate-900">{title}</h1><p className="mt-0.5 text-xs text-slate-500">{subtitle}</p></div></div>
   <div className="flex items-center gap-3 px-4"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600"><Database className="h-4 w-4"/></span><div><div className="text-xs text-slate-500">Total {title}</div><div className="text-lg font-bold text-slate-900">{total}</div></div></div>
   <div className="flex items-center gap-3 px-4"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-4 w-4"/></span><div><div className="text-xs text-slate-500">Active</div><div className="text-lg font-bold text-slate-900">{active}</div></div></div>
   <div className="flex items-center gap-3 px-4"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-600"><XCircle className="h-4 w-4"/></span><div><div className="text-xs text-slate-500">Inactive</div><div className="text-lg font-bold text-slate-900">{inactive}</div></div></div>
   <div className="flex items-center gap-2 px-3"><Layers3 className="h-4 w-4 shrink-0 text-amber-500"/><div><div className="text-xs text-slate-500">{fourthLabel}</div><strong className="text-slate-700">{fourthValue}</strong></div></div>
  </div>
 </section>
}