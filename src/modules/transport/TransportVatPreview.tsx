import {useEffect,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {financialNumber} from './transportFinancialTypes';
export function vatPreviewAmounts(amounts:number[],rate:number){
 const net=amounts.reduce((s,n)=>s+Math.round(n*100),0);
 const vat=amounts.reduce((s,n)=>s+Math.round(Math.round(n*100)*rate/100),0);
 return {net:net/100,vat:vat/100,total:(net+vat)/100};
}
export default function TransportVatPreview({side,date,withTax,amounts,onReady}:{side:'customer'|'supplier';date:string;withTax:boolean;amounts:number[];onReady?:(ready:boolean)=>void}){
 const {activeCompany}=useAuth();const company=activeCompany?.company_id;
 const key=`${company}:${side}:${date}:${withTax}`;
 const [result,setResult]=useState<{key:string;rate:number|null;error:string}>({key:'',rate:null,error:''});
 useEffect(()=>{let live=true;
 if(!withTax){setResult({key,rate:0,error:''});return()=>{live=false};}
 if(!company||!date){setResult({key,rate:null,error:'Select company and invoice date.'});return()=>{live=false};}
 void (async()=>{try{const r=await supabase.rpc('fixed_tax_rate_on',{p_company:company,p_context:side==='customer'?'sales':'purchase',p_date:date});if(r.error)throw r.error;
 const rate=r.data==null?null:Number(r.data);if(live)setResult({key,rate:Number.isFinite(rate)&&rate!==null&&rate>=0?rate:null,error:rate==null?'Configure an effective fixed VAT rate for this invoice date.':!Number.isFinite(rate)||rate<0?'Configured VAT rate is invalid.':''});
 }catch(e:any){if(live)setResult({key,rate:null,error:e?.message||'VAT rate unavailable.'});}})();return()=>{live=false};
 },[key,company,side,date,withTax]);
 const valid=amounts.every(n=>Number.isFinite(n)&&n>=0);
 const ready=(!withTax||(result.key===key&&result.rate!==null&&!result.error))&&valid;
 useEffect(()=>{onReady?.(ready)},[ready,onReady]);
 const totals=ready?vatPreviewAmounts(amounts,withTax?result.rate!:0):null;
 return <div className="my-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px]" aria-label="VAT posting preview">
 {totals?<p>Net: {financialNumber(totals.net)} · VAT {withTax?`${result.rate}%`:'off'}: {financialNumber(totals.vat)} · Total including VAT: <strong>{financialNumber(totals.total)}</strong></p>:<p role="status">{!valid?'Enter valid nonnegative net amounts.':result.key===key&&result.error?result.error:'Loading VAT rate…'}</p>}
 {withTax&&<p className="text-[10px] text-slate-600">Company and party tax registration are validated on posting. Invoice date selects the VAT rate; payments include VAT. Preview only—no posting.</p>}
 </div>;
}
