import {useNavigate,useSearchParams} from 'react-router-dom';
import TransportBulkCustomerRate from './TransportBulkCustomerRate';
import TransportBulkSupplierRent from './TransportBulkSupplierRent';
import TransportNormalInvoiceCreate from './TransportNormalInvoiceCreate';

export default function TransportInvoiceCreate({side}:{side:'customer'|'supplier'}){
 const navigate=useNavigate();const [params,setParams]=useSearchParams();
 const mode=params.get('type')==='normal'?'normal':'trip';
 const close=()=>navigate(side==='customer'?'/sales':'/purchase');
 const title=side==='customer'?'Sales':'Purchase';
 return <div className="space-y-3">
  <header className="flex flex-wrap items-center justify-between gap-3">
   <div><h1 className="text-lg font-semibold">New {title} Invoice</h1>
    <p className="text-xs text-slate-600">Two separate invoice methods, one canonical accounting and party ledger.</p></div>
   <nav aria-label={`${title} invoice type`} className="flex gap-2 text-xs">
    <button type="button" className={mode==='trip'?'btn-primary':'btn'}
      onClick={()=>setParams({}, {replace:true})}>Trip-based Service</button>
    <button type="button" className={mode==='normal'?'btn-primary':'btn'}
      onClick={()=>setParams({type:'normal'}, {replace:true})}>Normal (No Trips)</button>
   </nav>
  </header>
  {mode==='normal'
   ? <TransportNormalInvoiceCreate key={`normal-${side}`} side={side}/>
   : <>
      <p className="text-xs">Select the {side==='customer'?'Customer and Trips':'Supplier and Trip rents'}, review the agreed rates and VAT, then finalize or post the linked service invoice. Posting uses canonical Sales/Purchase accounting.</p>
      {side==='customer'
       ? <TransportBulkCustomerRate onClose={close} onChanged={async()=>{}}/>
       : <TransportBulkSupplierRent onClose={close} onChanged={async()=>{}}/>}
     </>}
 </div>;
}
