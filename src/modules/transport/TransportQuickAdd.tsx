import Customers from '@/modules/master-data/Customers';
import Suppliers from '@/modules/master-data/Suppliers';
import TransportMaster from '@/modules/master-data/TransportMaster';
import TransportFoundationMaster from '@/modules/master-data/TransportFoundationMaster';
import type { QuickAddKind } from './transportTripEntry';

// Use the canonical Master editor so fields, validation and persistence agree.
export default function TransportQuickAdd({kind,truckTypeId,supplierId,initialName,onCreated,onClose,allowTransportMobileCreate=false}:{
  kind:QuickAddKind;truckTypeId:string;supplierId:string;initialName?:string;truckTypes:any[];suppliers:any[];
  onCreated:(record:any)=>Promise<void>;onClose:()=>void;allowTransportMobileCreate?:boolean;
}) {
  const quickCreate={onCreated,onClose,truckTypeId,supplierId,initialName,allowTransportMobileCreate};
  if(kind==='customer')return <Customers quickCreate={quickCreate} transportEnglishOnly/>;
  if(kind==='supplier')return <Suppliers quickCreate={quickCreate} transportEnglishOnly/>;
  if(kind==='vehicle'||kind==='driver')return <TransportMaster kind={kind==='vehicle'?'vehicles':'drivers'} quickCreate={quickCreate}/>;
  return <TransportFoundationMaster kind={kind==='truckType'?'truck_types':'locations'} quickCreate={quickCreate}/>;
}
