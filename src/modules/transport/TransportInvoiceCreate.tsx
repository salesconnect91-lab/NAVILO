import {useNavigate} from 'react-router-dom';
import TransportBulkCustomerRate from './TransportBulkCustomerRate';
import TransportBulkSupplierRent from './TransportBulkSupplierRent';
export default function TransportInvoiceCreate({side}:{side:'customer'|'supplier'}){
 const navigate=useNavigate();const close=()=>navigate(side==='customer'?'/sales':'/purchase');
 return <div className="space-y-3"><h1 className="text-lg font-semibold">{side==='customer'?'Sales':'Purchase'} Transport Service Invoice</h1><p className="text-xs">Select the {side==='customer'?'Customer and Trips':'Supplier and Trip rents'}, review the service amounts, invoice date and VAT option, then post the selected services. Each selected Trip / supplier rent creates its own canonical service invoice. Finalize saves agreed amounts before posting.</p>{side==='customer'?<TransportBulkCustomerRate onClose={close} onChanged={async()=>{}}/>:<TransportBulkSupplierRent onClose={close} onChanged={async()=>{}}/>}</div>;
}
