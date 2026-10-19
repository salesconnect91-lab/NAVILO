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
 return <div className={isSale?'space-y-3':'navilo-invoice-pro space-y-3'} data-navilo-transport-invoice-type={isSale?'normal':'service'}>
  {!isSale&&<header className="navilo-invoice-hero">
   <div className="navilo-invoice-hero-main">
    <button type="button" className="navilo-invoice-breadcrumb" onClick={close}>← {side==='customer'?'Sales':'Purchase'} Invoices</button>
    <div className="navilo-invoice-eyebrow">NEW DOCUMENT <span aria-hidden="true">/</span> TRIP-LINKED SERVICE</div>
    <h1>{side==='customer'?'Sales Transport Service Invoice':'Purchase Transport Service Invoice'}</h1>
    <p>Choose {side==='customer'?'customer trips':'supplier trips and rents'}, check linked service amounts, invoice date and VAT before posting. Finalize saves agreed rates; posting creates the financial document.</p>
   </div>
   <div className="navilo-invoice-hero-actions"><span className="navilo-invoice-status">Trip-linked</span></div>
  </header>}
  {isSale
   ? <TransportNormalInvoiceCreate key={`sale-${side}`} side={side}/>
   : side==='customer'
     ? <TransportBulkCustomerRate onClose={close} onChanged={async()=>{}}/>
     : <TransportBulkSupplierRent onClose={close} onChanged={async()=>{}}/>}
 </div>;
}
