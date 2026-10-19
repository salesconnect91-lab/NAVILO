import { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { supabase } from "@/lib/supabase";

export type ExpenseCategory={name:string;detail_type:string|null;amount:number;previous_amount:number};
export type ExpenseBreakdown={
  month:string; currency:string; total:number; previous_total:number;
  categories:ExpenseCategory[];basis:string;
};
const COLORS=["#2563eb","#0d9488","#7c3aed","#f97316","#64748b"];
const money=(amount:number,currency:string)=>`${currency||"SAR"} ${new Intl.NumberFormat("en-US",{maximumFractionDigits:2,minimumFractionDigits:2}).format(amount)}`;
export function expenseMonth(period:"last"|"current",now=new Date()):string{
 const offset=period==="last"?-1:0;
 const d=new Date(now.getFullYear(),now.getMonth()+offset,1);
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
}
export function expenseSlices(items:ExpenseCategory[]){
 const entries=items.filter(x=>Number(x.amount)>0).sort((a,b)=>b.amount-a.amount);
 const visible=entries.slice(0,4).map(x=>({name:x.name,value:Number(x.amount)}));
 const other=entries.slice(4).reduce((total,x)=>total+Number(x.amount),0);
 if(other>0)visible.push({name:"Other expenses",value:other});
 return visible;
}
export function expenseChange(current:number,previous:number){
 if(previous===0)return current===0?null:{label:"No previous-month expenses",increased:current>0};
 const pct=((current-previous)/Math.abs(previous))*100;
 return {label:`${pct>0?"+":""}${pct.toFixed(1)}% vs previous month`,increased:pct>0};
}

export default function DashboardExpensesCard({
 companyId,businessUnitId,enabled,
}:{companyId:string|null;businessUnitId:string|null;enabled:boolean}){
 const [period,setPeriod]=useState<"last"|"current">("last");
 const [data,setData]=useState<ExpenseBreakdown|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const month=expenseMonth(period);
 useEffect(()=>{
   if(!enabled||!companyId||!businessUnitId)return;
   const controller=new AbortController();
   setData(null);setLoading(true);setError("");
   void (async()=>{
     try{
       const result=await supabase.rpc("dashboard_expense_breakdown",{p_month:month})
         .abortSignal(controller.signal);
       if(controller.signal.aborted)return;
       if(result.error)throw result.error;
       const value=result.data as ExpenseBreakdown;
       if(!value||!Array.isArray(value.categories))throw new Error("Invalid posted expense summary.");
       setData(value);
     }catch(e){
       if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Unable to load expenses.");
     }finally{
       if(!controller.signal.aborted)setLoading(false);
     }
   })();
   return()=>controller.abort();
 },[companyId,businessUnitId,enabled,month]);

 const categories=useMemo(()=>expenseSlices(data?.categories??[]),[data]);
 const total=Number(data?.total??0),previous=Number(data?.previous_total??0);
 const difference=expenseChange(total,previous);
 const displayMonth=new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric",timeZone:"UTC"})
   .format(new Date(month+"T12:00:00Z"));
 const sliceTotal=categories.reduce((n,x)=>n+x.value,0);
 return <section aria-label="Posted expenses breakdown" className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
   <div className="flex flex-wrap items-center justify-between gap-2">
     <div>
       <h3 className="text-xs font-black text-slate-900">Expenses Breakdown</h3>
       <p className="mt-0.5 text-[10px] text-slate-500">Posted expense GL · VAT control excluded</p>
     </div>
     <select aria-label="Expense comparison month" value={period}
       onChange={e=>setPeriod(e.target.value as "last"|"current")}
       className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-700">
       <option value="last">Last month</option><option value="current">This month</option>
     </select>
   </div>
   <div className="mt-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
     <div>
       <p className="text-[11px] font-semibold text-slate-600">Expenses for {displayMonth}</p>
       <p className="mt-0.5 text-2xl font-black tabular-nums text-slate-950">
         {loading?"…":data?money(total,data.currency):"—"}
       </p>
     </div>
     {data&&difference&&<span className={`text-[11px] font-bold ${difference.increased?"text-rose-600":"text-emerald-700"}`}>
       {difference.increased?"↑":"↓"} {difference.label}
     </span>}
   </div>
   {error&&<p role="alert" className="mt-3 rounded-md bg-amber-50 px-2 py-2 text-xs text-amber-800">
     Expense summary unavailable. {error}
   </p>}
   {loading&&<div className="flex h-36 items-center justify-center text-xs text-slate-500">Loading posted expenses…</div>}
   {!loading&&data&&categories.length===0&&<div className="flex h-36 items-center justify-center rounded-lg bg-slate-50 text-center text-xs text-slate-500">
     No posted Expense GL movements for this month.
   </div>}
   {!loading&&data&&categories.length>0&&
     <div className="mt-2 grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3">
       <div className="relative h-36 w-full">
         <ResponsiveContainer width="100%" height="100%">
           <PieChart>
             <Pie data={categories} dataKey="value" nameKey="name"
               cx="50%" cy="50%" innerRadius={43} outerRadius={63}
               startAngle={90} endAngle={-270} stroke="#fff" strokeWidth={2}>
               {categories.map((item,i)=><Cell key={item.name} fill={COLORS[i%COLORS.length]}/>)}
             </Pie>
             <Tooltip formatter={value=>money(Number(value),data.currency)}/>
           </PieChart>
         </ResponsiveContainer>
         <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
           <span className="text-[10px] font-bold text-slate-400">Categories</span>
           <span className="text-base font-black text-slate-800">{categories.length}</span>
         </div>
       </div>
       <div className="min-w-0 space-y-2">
         {categories.map((item,i)=><div key={item.name} className="flex items-center gap-2 text-[10px]">
           <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{backgroundColor:COLORS[i%COLORS.length]}}/>
           <span title={item.name} className="min-w-0 flex-1 truncate font-semibold text-slate-700">{item.name}</span>
           <span className="shrink-0 tabular-nums text-slate-600">{money(item.value,data.currency)}</span>
           <span className="w-9 shrink-0 text-right font-bold tabular-nums text-slate-500">
             {sliceTotal>0?(100*item.value/sliceTotal).toFixed(0):"0"}%
           </span>
         </div>)}
       </div>
     </div>}
   {!loading&&data&&<div className="mt-2 border-t border-slate-100 pt-2 text-[10px] text-slate-500">
     Previous month: {money(previous,data.currency)}
     {Math.abs(sliceTotal-total)>0.01?" · Total includes net credits/reversals.":""}
     <span className="block">GL expense, not cash paid. Purchase invoices and expense bills post here when accounted.</span>
   </div>}
 </section>;
}
