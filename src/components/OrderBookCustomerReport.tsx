import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Download, Printer, RefreshCw, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

type OrderType = "sales" | "purchase";
type ViewTab = "open" | "history" | "analysis" | "exceptions";
type Party = { id:string; name:string; name_urdu?:string|null; phone?:string|null; address?:string|null };
type Commitment = { id:string; item_id:string; item_name:string; ordered_qty:number|string; fulfilled_qty:number|string; cancelled_qty:number|string; uom:string|null; rate_status:string; agreed_rate:number|string|null; effective_at:string|null; status:string; remarks:string|null };
type Header = { id:string; order_no:string; order_date:string; party_id:string; party_name:string; salesperson_name:string|null; status:string; remarks:string|null; order_book_commitments?:Commitment[] };
type History = { id:string; commitment_id:string; old_rate:number|string|null; new_rate:number|string|null; effective_at:string; reason:string; created_at?:string };
type Fulfillment = { id:string; commitment_id:string; document_type:string; document_id:string; document_no:string; document_date:string; qty:number|string; rate:number|string; created_at:string };
type SalesLine = { id:string; order_id:string; item_id:string; order_book_commitment_id:string|null; qty:number|string; unit_price:number|string; line_total?:number|string|null; unit_cost_at_posting:number|string|null; cogs_total:number|string|null };
type PurchaseLine = { id:string; order_id:string; item_id:string; order_book_commitment_id:string|null; qty:number|string; unit_cost:number|string };
type DocHeader = { id:string; status:string; order_no:string; order_date:string };
type CostRow = { item_id:string; avg_cost:number|string };
type StockRow = { item_id:string; quantity:number|string };

type IntelligenceRow = {
  orderId:string;
  orderNo:string;
  orderDate:string;
  salesperson:string|null;
  commitment:Commitment;
  ordered:number;
  fulfilled:number;
  cancelled:number;
  balance:number;
  bookedRate:number;
  openValue:number;
  avgActualRate:number;
  ageDays:number;
  realizedQty:number;
  realizedSales:number;
  realizedCost:number;
  realizedMargin:number;
  realizedMarginPct:number;
  avgCost:number;
  expectedOpenCost:number;
  expectedOpenMargin:number;
  expectedOpenMarginPct:number;
  availableStock:number;
  shortage:number;
  actualPurchaseValue:number;
  purchaseRateVariance:number;
  exceptions:string[];
};

const n=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
const money=(v:unknown)=>`Rs ${n(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const qty=(v:unknown)=>n(v).toLocaleString(undefined,{maximumFractionDigits:3});
const pct=(v:unknown)=>`${n(v).toLocaleString(undefined,{maximumFractionDigits:2})}%`;
const shortOrderNo=(v:string)=>{const m=v.match(/^(SO|PO|POB)-(?:\d{8}-)?(\d+)$/i);return m?`${m[1].toUpperCase()}-${String(Number(m[2])).padStart(4,"0")}`:v};
const partyDisplay=(party?:Party)=>party?`${party.name}${party.name_urdu?` / ${party.name_urdu}`:""}`:"—";
const dayDiff=(date:string)=>Math.max(0,Math.floor((Date.now()-new Date(`${date}T00:00:00`).getTime())/86400000));
const csvCell=(v:unknown)=>`"${String(v??"").replace(/"/g,'""')}"`;

export default function OrderBookCustomerReport({ type }: { type: OrderType }){
  const sales=type==="sales";
  const partyLabel=sales?"Customer":"Supplier";
  const partyLabelUrdu=sales?"کسٹمر":"سپلائر";
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [partyId,setPartyId]=useState("");
  const [parties,setParties]=useState<Party[]>([]);
  const [orders,setOrders]=useState<Header[]>([]);
  const [history,setHistory]=useState<History[]>([]);
  const [fulfillments,setFulfillments]=useState<Fulfillment[]>([]);
  const [salesLines,setSalesLines]=useState<SalesLine[]>([]);
  const [purchaseLines,setPurchaseLines]=useState<PurchaseLine[]>([]);
  const [salesDocs,setSalesDocs]=useState<DocHeader[]>([]);
  const [purchaseDocs,setPurchaseDocs]=useState<DocHeader[]>([]);
  const [costs,setCosts]=useState<CostRow[]>([]);
  const [stock,setStock]=useState<StockRow[]>([]);
  const [tab,setTab]=useState<ViewTab>("open");
  const [search,setSearch]=useState("");
  const [status,setStatus]=useState<"all"|"open"|"completed"|"rate_pending">("all");
  const [itemId,setItemId]=useState("");

  const loadParties=useCallback(async()=>{
    const table=sales?"customers":"suppliers";
    const {data,error}=await supabase.from(table).select("id,name,name_urdu,phone,address").order("name");
    if(error){setError(error.message);return;}
    setParties((data||[]) as Party[]);
  },[sales]);
  useEffect(()=>{void loadParties()},[loadParties]);

  const loadReport=async(id:string)=>{
    setPartyId(id); setError(null); setSearch(""); setItemId(""); setStatus("all");
    if(!id){setOrders([]);setHistory([]);setFulfillments([]);setSalesLines([]);setPurchaseLines([]);return;}
    setLoading(true);
    try{
      const {data:o,error:e}=await supabase.from("order_book_headers")
        .select("id,order_no,order_date,party_id,party_name,salesperson_name,status,remarks,order_book_commitments(id,item_id,item_name,ordered_qty,fulfilled_qty,cancelled_qty,uom,rate_status,agreed_rate,effective_at,status,remarks)")
        .eq("order_type",type).eq("party_id",id).order("order_date",{ascending:false});
      if(e)throw e;
      const os=((o||[]) as Header[]).filter(x=>(x.order_book_commitments||[]).length>0);
      setOrders(os);
      const commitmentIds=os.flatMap(x=>(x.order_book_commitments||[]).map(c=>c.id));
      const itemIds=Array.from(new Set(os.flatMap(x=>(x.order_book_commitments||[]).map(c=>c.item_id)).filter(Boolean)));
      if(!commitmentIds.length){setHistory([]);setFulfillments([]);setSalesLines([]);setPurchaseLines([]);setCosts([]);setStock([]);return;}

      const [hr,fr,costRes,stockRes,lineRes]=await Promise.all([
        supabase.from("order_book_rate_history").select("id,commitment_id,old_rate,new_rate,effective_at,reason,created_at").in("commitment_id",commitmentIds).order("effective_at",{ascending:true}),
        supabase.from("order_book_fulfillments").select("id,commitment_id,document_type,document_id,document_no,document_date,qty,rate,created_at").in("commitment_id",commitmentIds).order("document_date",{ascending:true}),
        itemIds.length?supabase.from("inventory_costs").select("item_id,avg_cost").in("item_id",itemIds):Promise.resolve({data:[],error:null}),
        itemIds.length?supabase.from("warehouse_stock").select("item_id,quantity").in("item_id",itemIds):Promise.resolve({data:[],error:null}),
        sales
          ? supabase.from("sales_order_lines").select("id,order_id,item_id,order_book_commitment_id,qty,unit_price,line_total,unit_cost_at_posting,cogs_total").in("order_book_commitment_id",commitmentIds)
          : supabase.from("purchase_order_lines").select("id,order_id,item_id,order_book_commitment_id,qty,unit_cost").in("order_book_commitment_id",commitmentIds),
      ]);
      const firstError=[hr,fr,costRes,stockRes,lineRes].find(r=>r.error)?.error;
      if(firstError)throw firstError;
      setHistory((hr.data||[]) as History[]);
      setFulfillments((fr.data||[]) as Fulfillment[]);
      setCosts((costRes.data||[]) as CostRow[]);
      setStock((stockRes.data||[]) as StockRow[]);

      if(sales){
        const lines=(lineRes.data||[]) as SalesLine[]; setSalesLines(lines); setPurchaseLines([]);
        const docIds=Array.from(new Set(lines.map(l=>l.order_id)));
        if(docIds.length){const d=await supabase.from("sales_orders").select("id,status,order_no,order_date").in("id",docIds);if(d.error)throw d.error;setSalesDocs((d.data||[]) as DocHeader[])}else setSalesDocs([]);
      }else{
        const lines=(lineRes.data||[]) as PurchaseLine[]; setPurchaseLines(lines); setSalesLines([]);
        const docIds=Array.from(new Set(lines.map(l=>l.order_id)));
        if(docIds.length){const d=await supabase.from("purchase_orders").select("id,status,order_no,order_date").in("id",docIds);if(d.error)throw d.error;setPurchaseDocs((d.data||[]) as DocHeader[])}else setPurchaseDocs([]);
      }
    }catch(e:any){setError(e?.message||`Could not load ${partyLabel.toLowerCase()} order intelligence.`)}finally{setLoading(false)}
  };

  const party=parties.find(c=>c.id===partyId);
  const costMap=useMemo(()=>new Map(costs.map(c=>[c.item_id,n(c.avg_cost)])),[costs]);
  const stockMap=useMemo(()=>{const m=new Map<string,number>();stock.forEach(s=>m.set(s.item_id,(m.get(s.item_id)||0)+n(s.quantity)));return m},[stock]);
  const fulfillmentMap=useMemo(()=>{const m=new Map<string,Fulfillment[]>();fulfillments.forEach(f=>m.set(f.commitment_id,[...(m.get(f.commitment_id)||[]),f]));return m},[fulfillments]);
  const postedSalesIds=useMemo(()=>new Set(salesDocs.filter(d=>d.status==="posted").map(d=>d.id)),[salesDocs]);
  const postedPurchaseIds=useMemo(()=>new Set(purchaseDocs.filter(d=>d.status==="posted").map(d=>d.id)),[purchaseDocs]);

  const rows=useMemo<IntelligenceRow[]>(()=>orders.flatMap(order=>(order.order_book_commitments||[]).map(c=>{
    const ordered=n(c.ordered_qty),fulfilled=n(c.fulfilled_qty),cancelled=n(c.cancelled_qty),balance=Math.max(0,ordered-fulfilled-cancelled),bookedRate=c.rate_status==="agreed"?n(c.agreed_rate):0;
    const fs=fulfillmentMap.get(c.id)||[];
    const fQty=fs.reduce((a,f)=>a+n(f.qty),0);
    const fVal=fs.reduce((a,f)=>a+n(f.qty)*n(f.rate),0);
    const avgActualRate=fQty>0?fVal/fQty:0;
    const avgCost=costMap.get(c.item_id)||0;
    let realizedQty=0,realizedSales=0,realizedCost=0,actualPurchaseValue=0;
    if(sales){
      salesLines.filter(l=>l.order_book_commitment_id===c.id&&postedSalesIds.has(l.order_id)).forEach(l=>{const q=n(l.qty);realizedQty+=q;realizedSales+=n(l.line_total??q*n(l.unit_price));realizedCost+=n(l.cogs_total)||q*n(l.unit_cost_at_posting)});
    }else{
      purchaseLines.filter(l=>l.order_book_commitment_id===c.id&&postedPurchaseIds.has(l.order_id)).forEach(l=>{const q=n(l.qty);realizedQty+=q;actualPurchaseValue+=q*n(l.unit_cost)});
    }
    const realizedMargin=realizedSales-realizedCost;
    const realizedMarginPct=realizedSales?realizedMargin/realizedSales*100:0;
    const openValue=balance*bookedRate;
    const expectedOpenCost=balance*avgCost;
    const expectedOpenMargin=sales&&bookedRate>0&&avgCost>0?openValue-expectedOpenCost:0;
    const expectedOpenMarginPct=sales&&openValue?expectedOpenMargin/openValue*100:0;
    const availableStock=stockMap.get(c.item_id)||0;
    const shortage=sales?Math.max(0,balance-availableStock):0;
    const purchaseActualRate=!sales&&realizedQty>0?actualPurchaseValue/realizedQty:avgActualRate;
    const purchaseRateVariance=!sales&&bookedRate>0&&purchaseActualRate>0?purchaseActualRate-bookedRate:0;
    const exceptions:string[]=[];
    if(balance>0&&c.rate_status==="pending")exceptions.push("Rate pending");
    if(balance>0&&dayDiff(order.order_date)>=30)exceptions.push("Open 30+ days");
    if(sales&&shortage>0)exceptions.push("Stock shortage");
    if(sales&&realizedSales>0&&realizedMargin<0)exceptions.push("Negative realized margin");
    if(sales&&balance>0&&bookedRate>0&&avgCost>0&&expectedOpenMargin<0)exceptions.push("Negative expected margin");
    if(bookedRate>0&&avgActualRate>0&&Math.abs(avgActualRate-bookedRate)>0.01)exceptions.push("Rate variance");
    if(!sales&&bookedRate>0&&purchaseActualRate>0&&Math.abs(purchaseRateVariance)>0.01)exceptions.push("Purchase rate variance");
    return {orderId:order.id,orderNo:order.order_no,orderDate:order.order_date,salesperson:order.salesperson_name,commitment:c,ordered,fulfilled,cancelled,balance,bookedRate,openValue,avgActualRate,ageDays:dayDiff(order.order_date),realizedQty,realizedSales,realizedCost,realizedMargin,realizedMarginPct,avgCost,expectedOpenCost,expectedOpenMargin,expectedOpenMarginPct,availableStock,shortage,actualPurchaseValue,purchaseRateVariance,exceptions};
  })),[orders,fulfillmentMap,costMap,stockMap,sales,salesLines,purchaseLines,postedSalesIds,postedPurchaseIds]);

  const itemOptions=useMemo(()=>Array.from(new Map(rows.map(r=>[r.commitment.item_id,r.commitment.item_name])).entries()).sort((a,b)=>a[1].localeCompare(b[1])),[rows]);
  const filteredRows=useMemo(()=>rows.filter(r=>{
    const q=search.trim().toLowerCase();
    if(itemId&&r.commitment.item_id!==itemId)return false;
    if(status==="open"&&r.balance<=0)return false;
    if(status==="completed"&&r.balance>0)return false;
    if(status==="rate_pending"&&r.commitment.rate_status!=="pending")return false;
    return !q||`${r.orderNo} ${r.commitment.item_name} ${r.salesperson||""} ${r.commitment.remarks||""}`.toLowerCase().includes(q);
  }),[rows,search,itemId,status]);
  const openRows=filteredRows.filter(r=>r.balance>0);
  const exceptionRows=filteredRows.filter(r=>r.exceptions.length>0);

  const summary=useMemo(()=>filteredRows.reduce((a,r)=>{a.orders.add(r.orderId);a.ordered+=r.ordered;a.fulfilled+=r.fulfilled;a.cancelled+=r.cancelled;a.balance+=r.balance;a.openValue+=r.openValue;a.realizedSales+=r.realizedSales;a.realizedCost+=r.realizedCost;a.realizedMargin+=r.realizedMargin;a.expectedMargin+=r.expectedOpenMargin;a.shortage+=r.shortage;a.exceptions+=r.exceptions.length>0?1:0;return a},{orders:new Set<string>(),ordered:0,fulfilled:0,cancelled:0,balance:0,openValue:0,realizedSales:0,realizedCost:0,realizedMargin:0,expectedMargin:0,shortage:0,exceptions:0}),[filteredRows]);
  const overallMarginPct=summary.realizedSales?summary.realizedMargin/summary.realizedSales*100:0;

  const exportCsv=()=>{
    if(!filteredRows.length)return setError("No report data to export.");
    const headers=sales?["Order","Date","Item","Ordered","Fulfilled","Balance","Booked Rate","Open Value","Avg Cost","Realized Sales","Realized Cost","Realized Margin","Margin %","Expected Open Margin","Available Stock","Shortage","Exceptions"]:["Order","Date","Item","Ordered","Received","Balance","Booked Rate","Actual Rate","Rate Variance","Open Value","Received Value","Exceptions"];
    const data=filteredRows.map(r=>sales?[shortOrderNo(r.orderNo),r.orderDate,r.commitment.item_name,r.ordered,r.fulfilled,r.balance,r.bookedRate,r.openValue,r.avgCost,r.realizedSales,r.realizedCost,r.realizedMargin,r.realizedMarginPct,r.expectedOpenMargin,r.availableStock,r.shortage,r.exceptions.join("; ")]:[shortOrderNo(r.orderNo),r.orderDate,r.commitment.item_name,r.ordered,r.fulfilled,r.balance,r.bookedRate,r.avgActualRate,r.purchaseRateVariance,r.openValue,r.actualPurchaseValue,r.exceptions.join("; ")]);
    const csv=[headers.map(csvCell).join(","),...data.map(row=>row.map(csvCell).join(","))].join("\r\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`${sales?"Customer":"Supplier"}_Order_Intelligence_${party?.name||"Report"}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  };
  const print=()=>{const old=document.title;document.title=`${partyLabel} Order Intelligence - ${partyDisplay(party)}`;window.print();document.title=old};

  return <>
    <button type="button" className="btn" onClick={()=>setOpen(true)} title={`${partyLabel} Order Intelligence`}><BarChart3 size={14}/> {partyLabel} Intelligence / {partyLabelUrdu} رپورٹ</button>
    {open&&<div className="fixed inset-0 z-[140] overflow-auto bg-slate-950/55 p-3 md:p-5"><div className="mx-auto max-w-[1500px] overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="no-print border-b bg-slate-50 p-4">
        <div className="flex flex-wrap items-center gap-2"><div className="mr-auto"><h2 className="text-lg font-black text-slate-900">{partyLabel} Order Intelligence</h2><p className="text-xs text-slate-500">Order balance, fulfillment, rate control, profitability and exceptions — separate from financial ledger</p></div><button className="btn" onClick={()=>partyId&&void loadReport(partyId)} disabled={!partyId||loading}><RefreshCw size={14}/>Refresh</button><button className="btn" onClick={exportCsv} disabled={!partyId||loading}><Download size={14}/>Excel / CSV</button><button className="btn btn-primary" onClick={print} disabled={!partyId||loading}><Printer size={14}/>Print / PDF</button><button className="btn" onClick={()=>setOpen(false)}><X size={16}/></button></div>
        <div className="mt-3 grid gap-2 md:grid-cols-4"><SearchableSelect className="input" value={partyId} onChange={e=>void loadReport(e.target.value)}><option value="">Select {partyLabel.toLowerCase()}...</option>{parties.map(p=><option key={p.id} value={p.id}>{partyDisplay(p)}</option>)}</SearchableSelect><SearchableSelect className="input" value={itemId} onChange={e=>setItemId(e.target.value)}><option value="">All items</option>{itemOptions.map(([id,name])=><option key={id} value={id}>{name}</option>)}</SearchableSelect><SearchableSelect nativeCompatibility preserveLabel className="input" value={status} onChange={e=>setStatus(e.target.value as any)}><option value="all">All status</option><option value="open">Open only</option><option value="completed">Completed only</option><option value="rate_pending">Rate pending</option></SearchableSelect><input className="input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search order, item, salesperson..."/></div>
      </div>
      {error&&<div className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading?<div className="p-12 text-center text-sm text-slate-500">Loading report...</div>:!partyId?<div className="p-12 text-center text-sm text-slate-500">Select a {partyLabel.toLowerCase()} to open the report.</div>:<div id="order-intelligence-report" className="print-report p-4 md:p-5 text-slate-900">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b pb-3"><div><h1 className="text-xl font-black">{partyLabel} Order Intelligence Report</h1><div className="mt-1 text-base font-bold">{partyDisplay(party)}</div><div className="text-xs text-slate-500">{party?.phone||""}{party?.address?` · ${party.address}`:""}</div></div><div className="text-right text-xs text-slate-500"><div>Report basis: Order Book commitments + posted transactions</div><div>Generated: {new Date().toLocaleString()}</div></div></div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <Stat label="Orders" value={summary.orders.size}/><Stat label="Ordered Qty" value={qty(summary.ordered)}/><Stat label={sales?"Delivered / Invoiced":"Received"} value={qty(summary.fulfilled)}/><Stat label="Open Qty" value={qty(summary.balance)} highlight/><Stat label="Open Value" value={money(summary.openValue)}/>{sales?<><Stat label="Realized Margin" value={money(summary.realizedMargin)} tone={summary.realizedMargin<0?"bad":"good"}/><Stat label="Margin %" value={pct(overallMarginPct)} tone={overallMarginPct<0?"bad":"good"}/><Stat label="Exceptions" value={summary.exceptions} tone={summary.exceptions?"bad":"normal"}/></>:<><Stat label="Cancelled Qty" value={qty(summary.cancelled)}/><Stat label="Exceptions" value={summary.exceptions} tone={summary.exceptions?"bad":"normal"}/><Stat label="Open Commitments" value={openRows.length}/></>}
        </div>

        <div className="no-print my-4 flex flex-wrap gap-2">{([['open','Open Commitments'],['history','Fulfillment History'],['analysis',sales?'Margin Analysis':'Rate / Cost Analysis'],['exceptions','Exceptions']] as [ViewTab,string][]).map(([k,label])=><button key={k} className={tab===k?"btn-primary":"btn-secondary"} onClick={()=>setTab(k)}>{label}{k==='exceptions'&&exceptionRows.length?` (${exceptionRows.length})`:''}</button>)}</div>

        {tab==="open"&&<Section title="Open Order Commitments" subtitle="Every booked rate remains a separate commitment line, so balance quantity and value stay traceable."><TableHead sales={sales}/><tbody>{openRows.length?openRows.map(r=><OpenRow key={r.commitment.id} row={r} sales={sales}/>):<Empty col={13} text="No open commitments for the selected filters."/>}</tbody></Section>}

        {tab==="history"&&<Section title="Fulfillment / Invoice History" subtitle={sales?"Every delivery or invoice consumption against the booking.":"Every receipt / purchase fulfillment against the supplier booking."}><thead><tr>{["Order","Item","Document","Date","Qty","Actual Rate","Booked Rate","Variance"].map(h=><th key={h} className="border-b p-2 text-left">{h}</th>)}</tr></thead><tbody>{filteredRows.flatMap(r=>(fulfillmentMap.get(r.commitment.id)||[]).map(f=><tr key={f.id} className="border-b last:border-0"><td className="p-2 font-semibold">{shortOrderNo(r.orderNo)}</td><td className="p-2">{r.commitment.item_name}</td><td className="p-2">{f.document_no}</td><td className="p-2">{f.document_date}</td><td className="p-2 text-right">{qty(f.qty)} {r.commitment.uom||""}</td><td className="p-2 text-right">{money(f.rate)}</td><td className="p-2 text-right">{r.bookedRate?money(r.bookedRate):"Pending"}</td><td className={`p-2 text-right font-bold ${r.bookedRate&&n(f.rate)>r.bookedRate?(sales?"text-emerald-700":"text-red-700"):r.bookedRate&&n(f.rate)<r.bookedRate?(sales?"text-red-700":"text-emerald-700"):""}`}>{r.bookedRate?money(n(f.rate)-r.bookedRate):"—"}</td></tr>))}{fulfillments.length===0&&<Empty col={8} text="No fulfillment history found."/>}</tbody></Section>}

        {tab==="analysis"&&(sales?<Section title="Item-wise Margin Analysis" subtitle="Realized margin uses posted sales line cost. Expected open margin uses current inventory average cost for planning only."><thead><tr>{["Order","Item","Realized Qty","Sales Value","Actual Cost","Margin","Margin %","Booked Rate","Avg Cost","Open Qty","Expected Open Margin"].map(h=><th key={h} className="border-b p-2 text-left">{h}</th>)}</tr></thead><tbody>{filteredRows.map(r=><tr key={r.commitment.id} className="border-b last:border-0"><td className="p-2 font-semibold">{shortOrderNo(r.orderNo)}</td><td className="p-2">{r.commitment.item_name}</td><td className="p-2 text-right">{qty(r.realizedQty)}</td><td className="p-2 text-right">{money(r.realizedSales)}</td><td className="p-2 text-right">{money(r.realizedCost)}</td><td className={`p-2 text-right font-bold ${r.realizedMargin<0?"text-red-700":"text-emerald-700"}`}>{money(r.realizedMargin)}</td><td className={`p-2 text-right font-bold ${r.realizedMarginPct<0?"text-red-700":"text-emerald-700"}`}>{pct(r.realizedMarginPct)}</td><td className="p-2 text-right">{r.bookedRate?money(r.bookedRate):"Pending"}</td><td className="p-2 text-right">{r.avgCost?money(r.avgCost):"—"}</td><td className="p-2 text-right">{qty(r.balance)}</td><td className={`p-2 text-right font-bold ${r.expectedOpenMargin<0?"text-red-700":"text-slate-800"}`}>{r.bookedRate&&r.avgCost?money(r.expectedOpenMargin):"—"}</td></tr>)}</tbody></Section>:<Section title="Supplier Rate / Cost Analysis" subtitle="Compare committed purchase rates with actual receipt / posted purchase rates item by item."><thead><tr>{["Order","Item","Booked Rate","Actual Avg Rate","Variance","Received Qty","Received Value","Open Qty","Open Value","Age"].map(h=><th key={h} className="border-b p-2 text-left">{h}</th>)}</tr></thead><tbody>{filteredRows.map(r=><tr key={r.commitment.id} className="border-b last:border-0"><td className="p-2 font-semibold">{shortOrderNo(r.orderNo)}</td><td className="p-2">{r.commitment.item_name}</td><td className="p-2 text-right">{r.bookedRate?money(r.bookedRate):"Pending"}</td><td className="p-2 text-right">{r.avgActualRate?money(r.avgActualRate):"—"}</td><td className={`p-2 text-right font-bold ${r.purchaseRateVariance>0?"text-red-700":r.purchaseRateVariance<0?"text-emerald-700":""}`}>{r.bookedRate&&r.avgActualRate?money(r.purchaseRateVariance):"—"}</td><td className="p-2 text-right">{qty(r.fulfilled)}</td><td className="p-2 text-right">{money(r.actualPurchaseValue||r.fulfilled*r.avgActualRate)}</td><td className="p-2 text-right">{qty(r.balance)}</td><td className="p-2 text-right">{r.bookedRate?money(r.openValue):"—"}</td><td className="p-2 text-right">{r.ageDays}d</td></tr>)}</tbody></Section>)}

        {tab==="exceptions"&&<Section title="Order Exception Control" subtitle="Action list for rate, ageing, margin, stock and fulfillment variance issues."><thead><tr>{["Severity","Order","Item","Open Qty","Booked Rate",sales?"Stock / Shortage":"Actual Rate","Age","Exception"].map(h=><th key={h} className="border-b p-2 text-left">{h}</th>)}</tr></thead><tbody>{exceptionRows.length?exceptionRows.map(r=><tr key={r.commitment.id} className="border-b last:border-0"><td className="p-2"><span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700"><AlertTriangle size={12}/>Review</span></td><td className="p-2 font-semibold">{shortOrderNo(r.orderNo)}</td><td className="p-2">{r.commitment.item_name}</td><td className="p-2 text-right">{qty(r.balance)}</td><td className="p-2 text-right">{r.bookedRate?money(r.bookedRate):"Pending"}</td><td className="p-2 text-right">{sales?`${qty(r.availableStock)} / ${qty(r.shortage)}`:(r.avgActualRate?money(r.avgActualRate):"—")}</td><td className="p-2 text-right">{r.ageDays}d</td><td className="p-2 font-semibold text-red-700">{r.exceptions.join(" · ")}</td></tr>):<Empty col={8} text="No exceptions found for the selected filters."/>}</tbody></Section>}

        <div className="mt-4 rounded-lg border bg-slate-50 p-3 text-[11px] text-slate-500"><b>Control note:</b> Order Book remains a commitment register and does not post accounting by itself. Realized profitability uses posted sales transactions only. Open-order expected margin is a planning indicator based on current inventory average cost and can change before final fulfillment.</div>
      </div>}
    </div></div>}
    <style>{`@media print{body *{visibility:hidden!important}#order-intelligence-report,#order-intelligence-report *{visibility:visible!important}#order-intelligence-report{position:absolute;left:0;top:0;width:100%;padding:7mm;font-size:9px}.no-print{display:none!important}@page{size:A4 landscape;margin:7mm}#order-intelligence-report table{width:100%;border-collapse:collapse;page-break-inside:auto}#order-intelligence-report thead{display:table-header-group}#order-intelligence-report tr{page-break-inside:avoid}#order-intelligence-report section{break-inside:auto}.print-report .shadow-sm{box-shadow:none!important}}`}</style>
  </>;
}

function Stat({label,value,highlight=false,tone="normal"}:{label:string;value:string|number;highlight?:boolean;tone?:"normal"|"good"|"bad"}){
  const cls=tone==="bad"?"text-red-700":tone==="good"?"text-emerald-700":highlight?"text-blue-700":"text-slate-900";
  return <div className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div><div className={`mt-1 text-sm font-black ${cls}`}>{value}</div></div>;
}
function Section({title,subtitle,children}:{title:string;subtitle:string;children:React.ReactNode}){return <section className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="border-b bg-slate-50 px-3 py-2"><div className="text-sm font-black text-slate-900">{title}</div><div className="text-[11px] text-slate-500">{subtitle}</div></div><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-xs">{children}</table></div></section>}
function TableHead({sales}:{sales:boolean}){return <thead><tr>{["Order","Date","Item","Ordered",sales?"Delivered":"Received","Cancelled","Open Qty","Booked Rate","Open Value",sales?"Avg Cost":"Actual Rate",sales?"Expected Margin":"Rate Variance","Age","Status"].map(h=><th key={h} className="border-b p-2 text-left">{h}</th>)}</tr></thead>}
function OpenRow({row:r,sales}:{row:IntelligenceRow;sales:boolean}){return <tr className="border-b last:border-0"><td className="p-2 font-semibold">{shortOrderNo(r.orderNo)}</td><td className="p-2">{r.orderDate}</td><td className="p-2"><div className="font-semibold">{r.commitment.item_name}</div>{r.commitment.remarks&&<div className="text-[10px] text-slate-500">{r.commitment.remarks}</div>}</td><td className="p-2 text-right">{qty(r.ordered)}</td><td className="p-2 text-right">{qty(r.fulfilled)}</td><td className="p-2 text-right">{qty(r.cancelled)}</td><td className="p-2 text-right font-black">{qty(r.balance)} {r.commitment.uom||""}</td><td className="p-2 text-right">{r.bookedRate?money(r.bookedRate):<span className="font-bold text-amber-700">Pending</span>}</td><td className="p-2 text-right">{r.bookedRate?money(r.openValue):"—"}</td><td className="p-2 text-right">{sales?(r.avgCost?money(r.avgCost):"—"):(r.avgActualRate?money(r.avgActualRate):"—")}</td><td className={`p-2 text-right font-bold ${sales&&r.expectedOpenMargin<0?"text-red-700":!sales&&r.purchaseRateVariance>0?"text-red-700":""}`}>{sales?(r.bookedRate&&r.avgCost?money(r.expectedOpenMargin):"—"):(r.bookedRate&&r.avgActualRate?money(r.purchaseRateVariance):"—")}</td><td className={`p-2 text-right ${r.ageDays>=30?"font-bold text-amber-700":""}`}>{r.ageDays}d</td><td className="p-2"><div className="uppercase">{r.commitment.status}</div>{r.exceptions.length>0&&<div className="mt-1 text-[10px] font-semibold text-red-600">{r.exceptions.join(" · ")}</div>}</td></tr>}
function Empty({col,text}:{col:number;text:string}){return <tr><td colSpan={col} className="p-10 text-center text-slate-400">{text}</td></tr>}
