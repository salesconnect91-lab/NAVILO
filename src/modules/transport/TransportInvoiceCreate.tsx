import {useNavigate} from 'react-router-dom';
import TransportBulkCustomerRate from './TransportBulkCustomerRate';
import TransportBulkSupplierRent from './TransportBulkSupplierRent';
export default function TransportInvoiceCreate({side,consolidated=false}:{side:'customer'|'supplier';consolidated?:boolean}){
 const navigate=useNavigate();const close=()=>navigate(side==='customer'?'/sales':'/purchase');
 return <div className="space-y-3"><h1 className="text-lg font-semibold">{consolidated?'Consolidated ':''}{side==='customer'?'Sales':'Purchase'} Transport Service Invoice</h1><p className="text-xs">Select the {side==='customer'?'Customer and Trips':'Supplier and Trip rents'}, review the service amounts, invoice date and VAT option, then post the selected services. Posting multiple eligible lines for the same party creates one canonical service invoice linked to every selected Trip / rent. Finalize only saves agreed amounts; it does not post. Check selected lines, invoice number and VAT before posting.</p>{side==='customer'?<TransportBulkCustomerRate onClose={close} onChanged={async()=>{}}/>:<TransportBulkSupplierRent onClose={close} onChanged={async()=>{}}/>}</div>;
}
