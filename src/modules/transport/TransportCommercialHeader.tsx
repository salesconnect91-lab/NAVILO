type Props={title:string;side:'customer'|'supplier';tripNo?:string|null;party?:string|null;customer?:string|null;from?:string|null;to?:string|null;vehicle?:string|null;titleId?:string};
export default function TransportCommercialHeader({title,side,tripNo,party,customer,from,to,vehicle,titleId}:Props){
 const supplier=side==='supplier';
 return <div className={`mb-2 rounded border p-2 ${supplier?'border-rose-200 bg-rose-50':'border-emerald-200 bg-emerald-50'}`}>
  <div className="flex flex-wrap items-center justify-between gap-1"><h2 id={titleId} className={`text-sm font-bold ${supplier?'text-rose-900':'text-emerald-900'}`}>{title}</h2><span className={`rounded px-2 py-1 text-xs font-bold tracking-wide ${supplier?'bg-rose-700 text-white':'bg-emerald-700 text-white'}`}>Trip · {tripNo||'—'}</span></div>
  <p className="mt-1 text-xs font-semibold text-slate-800">{supplier?'Supplier':'Customer'} · {party||'—'}</p>
  {supplier&&customer&&<p className="mt-0.5 text-[11px] font-medium text-slate-700">Customer · {customer}</p>}
  <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs"><div className="rounded border border-slate-200 bg-white px-2 py-1"><span className="block text-[9px] font-medium uppercase text-slate-500">From</span><strong className="text-slate-900">{from||'—'}</strong></div><span aria-hidden="true" className="font-bold text-slate-500">→</span><div className="rounded border border-slate-200 bg-white px-2 py-1"><span className="block text-[9px] font-medium uppercase text-slate-500">To</span><strong className="text-slate-900">{to||'—'}</strong></div></div>
  {vehicle&&<p className="mt-1 text-[11px] font-semibold text-slate-700">Vehicle · {vehicle}</p>}
 </div>;
}
export function TransportCommercialSummary({base,charges,total,side}:{base:number;charges:number;total:number;side:'customer'|'supplier'}){
 return <div className="my-2 grid grid-cols-3 gap-2 rounded border bg-slate-50 p-2 text-center text-xs"><div><span className="block text-[10px] font-medium text-slate-500">{side==='supplier'?'Base Rent':'Base Rate'}</span><strong>{base.toFixed(2)}</strong></div><div><span className="block text-[10px] font-medium text-slate-500">Charges</span><strong>{charges.toFixed(2)}</strong></div><div className={`rounded ${side==='supplier'?'bg-rose-100 text-rose-900':'bg-emerald-100 text-emerald-900'}`}><span className="block text-[10px] font-semibold">{side==='supplier'?'Total Rent':'Customer Rate'}</span><strong>{total.toFixed(2)}</strong></div></div>;
}
