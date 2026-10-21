import {Navigate,useSearchParams} from 'react-router-dom';
import TransportNormalInvoiceCreate from './TransportNormalInvoiceCreate';

export default function TransportInvoiceCreate({side,mode}:{side:'customer'|'supplier';mode?:'service'|'normal'}){
 const [params]=useSearchParams();
 // Explicit routes always win over query parameters. The query alias remains backward compatible.
 const isSale=(mode??params.get('type'))==='normal';
 // Trip-linked billing is operated only from the Trip Register. Keep old URLs
 // working as a redirect so bookmarks cannot open a second invoicing workflow.
 if(!isSale)return <Navigate replace to="/transport?view=trips"/>;
 return <div className="space-y-3" data-navilo-transport-invoice-type="normal">
  <TransportNormalInvoiceCreate key={`sale-${side}`} side={side}/>
 </div>;
}
