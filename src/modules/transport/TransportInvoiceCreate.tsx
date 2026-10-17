import {useNavigate,useSearchParams} from 'react-router-dom';
import TransportBulkCustomerRate from './TransportBulkCustomerRate';
import TransportBulkSupplierRent from './TransportBulkSupplierRent';
import TransportNormalInvoiceCreate from './TransportNormalInvoiceCreate';

export default function TransportInvoiceCreate({side}:{side:'customer'|'supplier'}){
 const navigate=useNavigate();
 const [params]=useSearchParams();
 const isSale=params.get('type')==='normal';
 const close=()=>navigate(side==='customer'?'/sales':'/purchase');
 const title=isSale
   ? (side==='customer'?'Sale Invoice':'Purchase Invoice')
   : (side==='customer'?'Service Invoice':'Service Purchase Invoice');
 return <div className="space-y-3">
  <header>
   <h1 className="text-lg font-semibold">{title}</h1>
   <p className="text-xs text-slate-600">{isSale
     ? 'Direct invoice from Customer/Supplier Master and descriptions. No Trip required.'
     : 'Invoice for one or more Transport Trips using the existing Service accounting flow.'}</p>
  </header>
  {isSale
   ? <TransportNormalInvoiceCreate key={`sale-${side}`} side={side}/>
   : side==='customer'
     ? <TransportBulkCustomerRate onClose={close} onChanged={async()=>{}}/>
     : <TransportBulkSupplierRent onClose={close} onChanged={async()=>{}}/>}
 </div>;
}
