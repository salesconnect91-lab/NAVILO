import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';

type Side='customer'|'supplier';
type BillingMode='Cash'|'Credit';
type VatChoice='master'|'with_vat'|'without_vat';

export function normalInvoiceVatQuote(amounts:number[],rate:number){
 const netCents=amounts.reduce((sum,amount)=>sum+Math.round(amount*100),0);
 const vatCents=Math.round(netCents*rate/100+Number.EPSILON);
 return {net:netCents/100,vat:vatCents/100,gross:(netCents+vatCents)/100};
}

/** Preview uses the same party billing mode and dated fixed rate as the posting RPC. */
export function useNormalInvoiceVatQuote({company,bu,side,party,date,choice,amounts}:{
 company?:string;bu?:string;side:Side;party:string;date:string;choice:VatChoice;amounts:number[];
}){
 const key=`${company??''}:${bu??''}:${side}:${party}:${date}`;
 const [fetched,setFetched]=useState<{key:string;mode:BillingMode|null;rate:number|null;error:string}>({
  key:'',mode:null,rate:null,error:''
 });
 useEffect(()=>{
  let alive=true;
  if(!company||!bu||!party||!date){setFetched({key,mode:null,rate:null,error:''});return()=>{alive=false};}
  setFetched({key:'',mode:null,rate:null,error:''});
  void (async()=>{
   try{
    const modes=await supabase.rpc('transport_billing_modes',{p_side:side});
    if(modes.error)throw modes.error;
    if(modes.data?.enabled!==true||!Array.isArray(modes.data?.rows))throw new Error('Transport Master billing rules unavailable.');
    const found=modes.data.rows.find((row:{id:string})=>row.id===party);
    const mode:BillingMode|null=found?.mode==='Cash'||found?.mode==='Credit'?found.mode:null;
    if(!mode)throw new Error('Set Customer/Supplier Cash/Credit in Master Billing Rules.');
    if(mode==='Cash'){if(alive)setFetched({key,mode,rate:0,error:''});return;}
    const tax=await supabase.rpc('fixed_tax_rate_on',{
     p_company:company,p_context:side==='customer'?'sales':'purchase',p_date:date
    });
    if(tax.error)throw tax.error;
    const rate=tax.data==null?NaN:Number(tax.data);
    if(!Number.isFinite(rate)||rate<=0||rate>100)throw new Error('Effective positive VAT rate not configured for this invoice date.');
    if(alive)setFetched({key,mode,rate,error:''});
   }catch(e:any){if(alive)setFetched({key,mode:null,rate:null,error:e?.message||'Unable to load VAT rule.'});}
  })();
  return()=>{alive=false};
 },[key,company,bu,side,party,date]);

 const fresh=fetched.key===key;
 const mode=fresh?fetched.mode:null;
 const rate=fresh?fetched.rate:null;
 const conflict=Boolean(mode&&((choice==='with_vat'&&mode!=='Credit')||(choice==='without_vat'&&mode!=='Cash')));
 const error=fresh?fetched.error||(
  conflict?`Selected VAT treatment conflicts with ${mode} billing mode in Master.`:''
 ):'';
 const preview=useMemo(()=>rate===null?null:normalInvoiceVatQuote(amounts,rate),[amounts,rate]);
 return {mode,rate,preview,error,loading:Boolean(party&&!fresh),ready:!party?false:fresh&&rate!==null&&!error};
}
