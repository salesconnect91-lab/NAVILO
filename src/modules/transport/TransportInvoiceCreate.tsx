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
  {isSale
   ? <header><h1 className="text-lg font-semibold">{title}</h1><p className="text-xs text-slate-600">Direct invoice from Customer/Supplier Master and descriptions. No Trip required.</p></header>
   : <header>
       <h1 className="text-lg font-semibold">{side==='customer'?'Sales':'Purchase'} Transport Service Invoice</h1>
       <p className="text-xs">Select the {side==='customer'?'Customer and Trips':'Supplier and Trip rents'}, review the service amounts, invoice date and VAT, then post the selected services. Posting multiple eligible lines for the same party creates one canonical service invoice linked to every selected Trip / rent. Finalize only saves agreed amounts; it does not post. Check selected lines, invoice number and VAT before posting.</p>
     </header>}
  {isSale
   ? <TransportNormalInvoiceCreate key={`sale-${side}`} side={side}/>
   : side==='customer'
     ? <TransportBulkCustomerRate onClose={close} onChanged={async()=>{}}/>
     : <TransportBulkSupplierRent onClose={close} onChanged={async()=>{}}/>}
 </div>;
}
