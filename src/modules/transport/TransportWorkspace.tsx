import {useLocation,useNavigate,useSearchParams} from 'react-router-dom';
import TransportHorizontalScroll from './TransportHorizontalScroll';
import './transportScrolling.css';
import NaviloDateInput from '@/components/NaviloDateInput';
import { formatNaviloDate } from "@/lib/naviloDate";
import {useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment} from "react";
import { Search, Plus, Upload, Route, History, ReceiptText, UserRound, Truck, RefreshCw, LockKeyhole, Mic, Trash2 } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { canPerformModule } from "@/auth/permissions";
import { useOptionalFeatureAccess } from "@/auth/FeatureAccess";
import { supabase } from "@/lib/supabase";
import TransportBulkSupplierRent from './TransportBulkSupplierRent';
import TransportBulkCustomerRate from './TransportBulkCustomerRate';
import TransportInitialRate from './TransportInitialRate';
import TransportTripCharges from './TransportTripCharges';
import TransportSupplierCharges from './TransportSupplierCharges';
import TransportInvoiceNumber from './TransportInvoiceNumber';
import TransportCostUpload from './TransportCostUpload';
import TransportHistoricalImport from './TransportHistoricalImport';
import TransportAudit from './TransportAudit';
import TransportPartyReports from './TransportPartyReports';
import TransportAccountStatement from './TransportAccountStatement';
import {collectRegisterExport} from './transportRegisterExport';
import {exportMatrixToCSV,exportMatrixToExcel,exportMatrixToWord,exportPackageToPDF,type ExportMatrix} from '@/lib/exportUtils';
import {fetchAllPages} from '@/lib/fetchAllPages';
import {financialNumber, type FinancialTrip} from './transportFinancialTypes';
import * as XLSX from "xlsx";
import {parseTripFile,fileDigest,makeImportJob,runImportJob,storedImport,saveImport,tripImportIdentity,type ImportRow,type ImportJob} from './transportTripImport';
import TransportPagination from './TransportPagination';
import TransportQuickAdd from './TransportQuickAdd';
import {compatibleVehicles,ownershipOnDate,matchingCustomerRate,estimatedMargin,masterKey,validMoney,type QuickAddKind,type OwnershipPeriod} from './transportTripEntry';

type MobileVoiceDraft={id:string;created_at:string;transcript:string;patch:Record<string,string>};
type Tab="trips"|"new"|"mobile"|"audit"|"driver-expenses"|"driver-account"|"vehicle-account";
type Trip=FinancialTrip & {
  id:string;
  trip_no:string;
  trip_date:string;
  status:string|null;
  ppr_status:string|null;
  po_do_job_no:string|null;
  customer_name:string|null;
  vehicle_no:string|null;
  truck_type:string|null;
  driver_name:string|null;
  owner_name:string|null;
  from_location:string;
  to_location:string;
  customer_rate:number|null;
  driver_pay:number|null;
  owner_rent:number|null;
  trip_profit:number|null;
  ppr_received_by_name:string|null;
  ppr_received_date:string|null;
  sale_type:string|null;
  sales_order_id:string|null;
  customer_base_rate?:number|null;
  customer_manual_adjustment?:number|null;
  invoice_no:string|null;
  supplier_invoice_no?:string|null;
  supplier_charges?:number|null;
};

const tabs:{key:Tab;label:string;icon:any}[]=[
  {key:"trips",label:"Trips",icon:Route},{key:"new",label:"New Trip",icon:Plus},{key:"mobile",label:"Mobile Quick Entry",icon:Search},{key:"audit",label:"Trip Audit",icon:History},
  {key:"driver-expenses",label:"Driver Expense Upload",icon:ReceiptText},{key:"driver-account",label:"Driver Account / Hisaab",icon:UserRound},
  {key:"vehicle-account",label:"Vehicle Account / Gari Hisaab",icon:Truck},
];

function Badge({value}:{value?:string|null}){const label=String(value??"").trim();return <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold capitalize text-slate-700">{label?label.replaceAll("_"," "):"?"}</span>}


type BulkTripRow=ImportRow;

const BULK_TRIP_HEADERS=[
  "Trip Date",
  "Customer",
  "Truck Type",
  "Vehicle",
  "Driver",
  "Owner / Supplier",
  "PO / DO / Job No.",
  "From",
  "To",
  "PPR Status",
  "Customer Rate",
  "Supplier Rent",
  "Invoice Number",
  "Notes", "Sale Type", "Driver Pay", "PPR Employee", "PPR Date"
] as const;

const TRANSPORT_TRIP_HEADERS=[
  "DATE",
  "TRUCK TYPE",
  "PO/DO/JOB NO.",
  "INVOICED",
  "COMPANY NAME",
  "DRIVER NAME",
  "OWNER",
  "PLATE #",
  "FROM",
  "TO",
  "PAPER RECEIVED BY",
  "DATE",
  "PAY TO DRIVER",
  "Supplier Rent",
  "REMAINING WITH US",
  "PAYMENT DATE",
  "AMOUNT",
  "Customer Rate",
  "received from company",
  "remaining with company",
  "PROFIT",
  "paid commissin for trip",
  "INVOICE NUMBER",
  "Sale Type (Cash / Credit)",
  "Driver Pay"
] as const;

export default function TransportWorkspace(){
  const navigate=useNavigate();
  const location=useLocation();
  const {user,activeCompany,activeBusinessUnit,isPlatformOwner}=useAuth();
  const scopeKey=`${activeCompany?.company_id}/${activeBusinessUnit?.business_unit_id}`;
  const scopeRef=useRef(scopeKey);scopeRef.current=scopeKey;
  const submissionRef=useRef(false);
  const entryRequest=useRef<{key:string;id:string}|null>(null);
  const [entryPermissions,setEntryPermissions]=useState({master:false,owner:false,rate:false,rent:false,driver:false});

  const [params,setParams]=useSearchParams();
  const featureAccess=useOptionalFeatureAccess();
  const standaloneMobile=location.pathname==="/transport/mobile";
  const role=activeBusinessUnit?.membership_role??activeCompany?.membership_role;
  const rolePermissions=activeBusinessUnit?.permissions??activeCompany?.permissions;
  const canViewFeature=(key:string)=>!featureAccess||(!featureAccess.loading&&featureAccess.isFeatureEnabled(key,"view"));
  const mobileCanCreate=(!featureAccess||(!featureAccess.loading&&featureAccess.isFeatureEnabled("transport-mobile-quick-entry","create")))
    &&canPerformModule(role,"transport","create",rolePermissions,isPlatformOwner);
  const mobileCanEdit=(!featureAccess||(!featureAccess.loading&&featureAccess.isFeatureEnabled("transport-mobile-quick-entry","edit")))
    &&canPerformModule(role,"transport","edit",rolePermissions,isPlatformOwner);
  const requestedView=params.get('view')??(standaloneMobile?'mobile':null);
  const requestedTab:Tab=tabs.some(t=>t.key===requestedView)?requestedView as Tab:'trips';
  const tabFeature:Record<Tab,string>={
    trips:"transport-trips-register",
    new:standaloneMobile?"transport-mobile-quick-entry":"transport-trips-register",
    mobile:"transport-mobile-quick-entry",
    audit:"transport-audit",
    "driver-expenses":"transport-driver-expenses",
    "driver-account":"transport-driver-account",
    "vehicle-account":"transport-vehicle-account",
  };
  const firstAllowedTab=():Tab=>(["trips","mobile","driver-expenses","driver-account","vehicle-account","audit"] as Tab[])
    .find(candidate=>canViewFeature(tabFeature[candidate]))??"trips";
  const tab:Tab=canViewFeature(tabFeature[requestedTab])?requestedTab:firstAllowedTab();
  const setTab=(next:Tab)=>{
    if(!canViewFeature(tabFeature[next]))return;
    const p=new URLSearchParams(params);
    if(standaloneMobile&&next==="mobile")p.delete('view');else p.set('view',next);
    p.delete('panel');setParams(p);
  };
  const [rows,setRows]=useState<Trip[]>([]);
  const [loading,setLoading]=useState(false);
  const [registerLoading,setRegisterLoading]=useState(false);
  const [mobileRows,setMobileRows]=useState<Trip[]>([]);
  const [mobileSearch,setMobileSearch]=useState("");
  const [mobileLoading,setMobileLoading]=useState(false);
  const entryReturnTab=useRef<Tab>(standaloneMobile?"mobile":"trips");
  const tripsGridRef=useRef<HTMLDivElement|null>(null);
  const tripsSectionRef=useRef<HTMLElement|null>(null);
  const compactTripColumnWidths:Record<string,number>={trip_no:96,trip_date:68,truck_type:68,job_no:82,company:138,driver:88,owner:82,plate:70,from:78,to:78,charge:72,paper_received_by:100,rent_driver:112,supplier_charges:112,supplier_paid:112,supplier_balance:126,supplier_credit:126,driver_pay:100,driver_paid:100,driver_balance:108,payment_date:82,amount:104,company_rate:112,received_company:126,remaining_company:126,customer_credit:126,profit:104,commission:116,invoice_no:100,supplier_invoice_no:110,sale_type:72};
  useEffect(()=>{
    if(location.pathname==="/transport"&&params.get("view")==="mobile")navigate("/transport/mobile",{replace:true});
  },[location.pathname,navigate,params]);

  const [tripColumnWidths,setTripColumnWidths]=useState<Record<string,number>>({});
  const [tripColumnOrder,setTripColumnOrder]=useState<string[]>([]);
  const [hiddenTripColumns,setHiddenTripColumns]=useState<string[]>([]);
  const [showTripColumnSetup,setShowTripColumnSetup]=useState(false);
  const tripColumnDragKey=useRef<string|null>(null);

  const startTripColumnResize=(e:React.MouseEvent<HTMLDivElement>,key:string)=>{
    e.preventDefault();
    e.stopPropagation();
    const header=e.currentTarget.parentElement;
    if(!header)return;
    const startX=e.clientX;
    const startWidth=header.getBoundingClientRect().width;

    const onMove=(event:MouseEvent)=>{
      const width=Math.max(amountGridKeys.has(key)?96:52,Math.round(startWidth+event.clientX-startX));
      setTripColumnWidths(current=>({...current,[key]:width}));
    };

    const onUp=()=>{
      document.body.style.cursor="";
      document.body.style.userSelect="";
      window.removeEventListener("mousemove",onMove);
      window.removeEventListener("mouseup",onUp);
    };

    document.body.style.cursor="col-resize";
    document.body.style.userSelect="none";
    window.addEventListener("mousemove",onMove);
    window.addEventListener("mouseup",onUp);
  };

  const [error,setError]=useState("");
  const requestedPanel=params.get('panel');
  const panelFeature:Record<string,string>={
    "customer-reports":"transport-customer-reports",
    "supplier-reports":"transport-supplier-reports",
    "bulk-allocation":"transport-allocation",
  };
  const reportPanel=requestedPanel&&panelFeature[requestedPanel]&&canViewFeature(panelFeature[requestedPanel])?requestedPanel:null;
  const showPartyReports=Boolean(reportPanel);

  const [fromDate,setFromDate]=useState("");
  const [toDate,setToDate]=useState("");
  const [customerFilter,setCustomerFilter]=useState("");
  const [driverFilter,setDriverFilter]=useState("");
  const [vehicleFilter,setVehicleFilter]=useState("");
  const [fromFilter,setFromFilter]=useState("");
  const [toFilter,setToFilter]=useState("");
  const [pprFilter,setPprFilter]=useState("");
  const [statusFilters,setStatusFilters]=useState<string[]>([]);
  const [statusSearch,setStatusSearch]=useState("");
  const [statusOpen,setStatusOpen]=useState(false);

  const [columnFilters,setColumnFilters]=useState<Record<string,string[]>>({});
  const [sortColumn,setSortColumn]=useState<string>("");
  const [sortDirection,setSortDirection]=useState<"asc"|"desc">("asc");
  const [openColumnFilter,setOpenColumnFilter]=useState<string|null>(null);
  const [columnMenuPosition,setColumnMenuPosition]=useState({top:0,left:0});

  const [newTripMode,setNewTripMode]=useState<"single"|"bulk"|"historical">("single");
  const [bulkRows,setBulkRows]=useState<BulkTripRow[]>([]);
  const [bulkFileName,setBulkFileName]=useState("");
  const [bulkSourceHash,setBulkSourceHash]=useState('');
  const [bulkParsing,setBulkParsing]=useState(false);
  const [bulkValidating,setBulkValidating]=useState(false);
  const [bulkImporting,setBulkImporting]=useState(false);
  const [importJob,setImportJob]=useState<ImportJob|null>(null);
  const [bulkPreviewPage,setBulkPreviewPage]=useState(0);
  const importStop=useRef(false);
  const importScope=`${user?.id??'session'}/${scopeKey}`;
  const importScopeRef=useRef(importScope);importScopeRef.current=importScope;
  useEffect(()=>{importStop.current=true;setImportJob(null);void storedImport(importScope).then(job=>{if(importScopeRef.current===importScope)setImportJob(job)}).catch(()=>{});return()=>{importStop.current=true}},[importScope]);
  const [page,setPage]=useState(0);
  const [registerSearch,setRegisterSearch]=useState('');
  const [registerSearchDraft,setRegisterSearchDraft]=useState('');
  const [registerMeta,setRegisterMeta]=useState<any>({count:0,totals:{},completed:0,paper_pending:0,statuses:[]});
  const readGeneration=useRef(0);
  const registerRequest=useRef<AbortController|null>(null);
  const columnOptionsRequest=useRef<AbortController|null>(null);


  const [tripMasters,setTripMasters]=useState<{
    customers:any[];
    truckTypes:any[];
    locations:any[];
    vehicles:any[];
    drivers:any[];
    suppliers:any[];
    employees:any[];
    ownership:OwnershipPeriod[];
    rates:any[];
  }>({customers:[],truckTypes:[],locations:[],vehicles:[],drivers:[],suppliers:[],employees:[],ownership:[],rates:[]});

  const [form,setForm]=useState({
    trip_date:new Date().toISOString().slice(0,10),
    customer_id:"",
    customer_name_snapshot:"",
    truck_type_id:"",
    vehicle_id:"",
    driver_id:"",
    from_location:"",
    to_location:"",
    po_do_job_no:"",
    ppr_status:"pending",
    ppr_received_date:"",
    ppr_received_by_employee_id:"",
    ppr_attachment_path:"",
    customer_rate:"",
    supplier_rent:"",
    driver_pay:"",
    sale_type:"",
    notes:""
  });
  const [voiceDrafts,setVoiceDrafts]=useState<MobileVoiceDraft[]>([]);
  const [voiceListening,setVoiceListening]=useState(false);
  const [voiceStatus,setVoiceStatus]=useState("");
  const [currentVoiceDraftId,setCurrentVoiceDraftId]=useState<string|null>(null);
  const voiceRecognitionRef=useRef<any>(null);
  const voiceStorageKey=`navilo.transport.mobile.voiceDrafts.${user?.id??"user"}.${scopeKey}`;
  useEffect(()=>{try{const parsed=JSON.parse(localStorage.getItem(voiceStorageKey)||"[]");setVoiceDrafts(Array.isArray(parsed)?parsed:[]);}catch{setVoiceDrafts([])}setCurrentVoiceDraftId(null)},[voiceStorageKey]);
  const persistVoiceDrafts=(next:MobileVoiceDraft[])=>{setVoiceDrafts(next);localStorage.setItem(voiceStorageKey,JSON.stringify(next.slice(0,30)))};
  const removeVoiceDraft=(id:string)=>{persistVoiceDrafts(voiceDrafts.filter(d=>d.id!==id));if(currentVoiceDraftId===id)setCurrentVoiceDraftId(null)};
  const [showBulkSupplierRent,setShowBulkSupplierRent]=useState(false);
  const [showBulkCustomerRate,setShowBulkCustomerRate]=useState(false);
  const [bulkSupplierRentTrip,setBulkSupplierRentTrip]=useState<Trip|null>(null);
  const [quickPprTrip,setQuickPprTrip]=useState<Trip|null>(null);
  const [quickPprEmployee,setQuickPprEmployee]=useState("");
  const [quickPprDate,setQuickPprDate]=useState(new Date().toISOString().slice(0,10));
  const [quickPprFile,setQuickPprFile]=useState<File|null>(null);
  const [initialRateTrip,setInitialRateTrip]=useState<Trip|null>(null);
  const [chargeTrip,setChargeTrip]=useState<Trip|null>(null);
  const [supplierChargeTarget,setSupplierChargeTarget]=useState<{rentId:string;tripNo:string}|null>(null);
  const [showRateList,setShowRateList]=useState(false);
  
  const [invoiceTrip,setInvoiceTrip]=useState<Trip|null>(null);
  const [editingRateLocks,setEditingRateLocks]=useState({customer:false,supplier:false});
  const [editingTripId,setEditingTripId]=useState<string|null>(null);
  const editingTripLocked=Boolean(editingTripId&&editingRateLocks.customer&&editingRateLocks.supplier);
  const [editingTripNo,setEditingTripNo]=useState("");
  const [editingOriginalAssignment,setEditingOriginalAssignment]=useState({vehicle_id:"",driver_id:""});

  const [quickAdd,setQuickAdd]=useState<QuickAddKind|null>(null);
  const [bulkFixRowNo,setBulkFixRowNo]=useState<number|null>(null);
  const [quickSupplierId,setQuickSupplierId]=useState('');
  const openSupplierCharges=async(r:Trip)=>{
    setError("");
    const q=await supabase.from('transport_trip_supplier_rents').select('id,state,amount,created_at').eq('trip_id',r.id).order('created_at',{ascending:true});
    if(q.error){setError(q.error.message);return;}
    const rents=q.data??[];
    if(!rents.length){setError(`No supplier rent exists for ${r.trip_no}. Add/finalize Supplier Rent first.`);return;}
    if(rents.length>1){setBulkSupplierRentTrip(r);setShowBulkSupplierRent(true);return;}
    setSupplierChargeTarget({rentId:rents[0].id,tripNo:r.trip_no});
  };

  const selectedVehicle=tripMasters.vehicles.find(v=>v.id===form.vehicle_id);
  const selectedDriver=tripMasters.drivers.find(d=>d.id===form.driver_id);
  const selectedOwnership=ownershipOnDate(tripMasters.ownership,form.vehicle_id,form.trip_date);
  const supplierOwned=selectedOwnership?.owner_type==='third_party';
  const ownerDisplay=selectedOwnership?.owner_name_snapshot||'';
  const vehicleChoices=compatibleVehicles(tripMasters.vehicles,form.truck_type_id);
  const agreedRate=matchingCustomerRate(tripMasters.rates,form,tripMasters.locations);
  const rateSuggestionKey=agreedRate?.id??'';
  const [rateTouched,setRateTouched]=useState(false);
  useEffect(()=>{
    if(!editingTripId&&!rateTouched)setForm(previous=>({...previous,customer_rate:agreedRate?String(agreedRate.amount):''}));
  },[rateSuggestionKey,form.customer_id,form.from_location,form.to_location,form.truck_type_id,form.trip_date,editingTripId,rateTouched]);
  useEffect(()=>{
    if(!editingTripId)setForm(previous=>previous.supplier_rent===''?previous:{...previous,supplier_rent:''});
  },[selectedOwnership?.id,editingTripId]);

  async function loadTripMasters(){
    if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id)throw new Error('Select Company and Business Unit.');
    const companyId=activeCompany.company_id,businessUnitId=activeBusinessUnit.business_unit_id;
    const startedScope=scopeKey;
    const read=(table:string,columns='*',companyOnly=false)=>fetchAllPages<any>((start,end)=>{
      let query=supabase.from(table).select(columns).eq('company_id',companyId);
      if(!companyOnly)query=query.eq('business_unit_id',businessUnitId);
      return query.order('id').range(start,end);
    });
    const [customers,truckTypes,locations,vehicles,drivers,suppliers,employees,ownership,rates]=await Promise.all([
      read('customers','id,name,is_active',true),read('transport_truck_types'),read('transport_locations'),read('transport_vehicles'),
      read('transport_drivers'),read('suppliers','id,name,is_active',true),read('employees','id,name,is_active',true),
      read('transport_vehicle_ownership'),read('transport_customer_rates')]);
    const masters={customers,truckTypes,locations,vehicles,drivers,suppliers,employees,ownership,rates};
    if(scopeRef.current!==startedScope)throw new Error('Workspace changed. Refresh before saving.');
    // Inactive rows remain in the validation snapshot so uploads get useful errors.
    setTripMasters({...masters,customers:customers.filter(r=>r.is_active),truckTypes:truckTypes.filter(r=>r.is_active),
      locations:locations.filter(r=>r.is_active),vehicles:vehicles.filter(r=>r.is_active),drivers:drivers.filter(r=>r.is_active),
      suppliers:suppliers.filter(r=>r.is_active),employees:employees.filter(r=>r.is_active)});
    return masters;
  }
  const openQuickAdd=(kind:QuickAddKind)=>{
    if(!entryPermissions.master||kind==='vehicle'&&!entryPermissions.owner){setError('Master / ownership permission required.');return;}
    setError('');setQuickAdd(kind);
  };
  async function quickMasterCreated(created:any){
    await loadTripMasters();
    if(bulkFixRowNo!==null){
      // A newly-created master can resolve the same rejection in many uploaded rows.
      // Re-run the existing validator for the whole preview; no validation rule is bypassed.
      const validated=await validateBulkMasters(bulkRows,true);
      setBulkRows(validated);
      setBulkFixRowNo(null);setQuickAdd(null);return;
    }
    if(quickAdd==='supplier'){setQuickSupplierId(created.id);return;}
    setForm(previous=>{
      if(quickAdd==='customer')return {...previous,customer_id:created.id,customer_name_snapshot:created.name};
      if(quickAdd==='driver')return {...previous,driver_id:created.id};
      if(quickAdd==='truckType')return {...previous,truck_type_id:created.id,vehicle_id:''};
      if(quickAdd==='vehicle')return {...previous,vehicle_id:created.id,truck_type_id:created.truck_type_id||previous.truck_type_id};
      if(quickAdd==='locationFrom')return {...previous,from_location:created.name};
      if(quickAdd==='locationTo')return {...previous,to_location:created.name};
      return previous;
    });
  }
  async function fixBulkOwnership(row:BulkTripRow){
    if(!entryPermissions.owner)throw new Error('Vehicle ownership permission required.');
    const masters=await loadTripMasters();
    const exact=(records:any[],column:string,value:string)=>records.filter(r=>r.is_active!==false&&masterKey(r[column])===masterKey(value));
    const vehicles=exact(masters.vehicles,'vehicle_no',row.vehicle);
    const suppliers=exact(masters.suppliers,'name',row.owner_supplier);
    if(vehicles.length!==1)throw new Error('Vehicle must resolve to one active master before ownership can be fixed.');
    if(suppliers.length!==1)throw new Error('Owner / Supplier must resolve to one active Supplier before ownership can be fixed.');
    const vehicle=vehicles[0],supplier=suppliers[0];
    const existing=ownershipOnDate(masters.ownership,vehicle.id,row.trip_date);
    if(existing){
      if(existing.owner_type==='third_party'&&existing.supplier_id===supplier.id){
        const validated=await validateBulkMasters(bulkRows,true);setBulkRows(validated);return;
      }
      throw new Error('A different dated owner already covers this Trip Date. Correct it through Vehicle Ownership History; it will not be overwritten.');
    }
    const next=masters.ownership.filter((p:any)=>p.vehicle_id===vehicle.id&&p.effective_from>row.trip_date)
      .sort((a:any,b:any)=>a.effective_from.localeCompare(b.effective_from))[0];
    let effectiveTo:string|null=null;
    if(next){
      const d=new Date(next.effective_from+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);effectiveTo=d.toISOString().slice(0,10);
      if(effectiveTo<row.trip_date)throw new Error('Ownership history has no safe gap covering this Trip Date.');
    }
    const result=await supabase.from('transport_vehicle_ownership').insert({
      company_id:activeCompany?.company_id,business_unit_id:activeBusinessUnit?.business_unit_id,vehicle_id:vehicle.id,
      owner_type:'third_party',supplier_id:supplier.id,owner_name_snapshot:supplier.name,
      effective_from:row.trip_date,effective_to:effectiveTo
    });
    if(result.error)throw result.error;
    window.dispatchEvent(new Event('navilo-master-data-changed'));
    const validated=await validateBulkMasters(bulkRows,true);setBulkRows(validated);
  }

  async function fixBulkTruckType(row:BulkTripRow){
    if(!entryPermissions.master)throw new Error('Master permission required.');
    const masters=await loadTripMasters();
    const vehicles=masters.vehicles.filter((r:any)=>r.is_active!==false&&masterKey(r.vehicle_no)===masterKey(row.vehicle));
    const truckTypes=masters.truckTypes.filter((r:any)=>r.is_active!==false&&masterKey(r.name)===masterKey(row.truck_type));
    if(vehicles.length!==1)throw new Error('Vehicle must resolve to one active master before Truck Type can be fixed.');
    if(truckTypes.length!==1)throw new Error('Truck Type must resolve to one active master before it can be assigned.');
    const vehicle=vehicles[0],truckType=truckTypes[0];
    if(vehicle.truck_type_id===truckType.id){
      const validated=await validateBulkMasters(bulkRows,true);setBulkRows(validated);return;
    }
    const current=masters.truckTypes.find((r:any)=>r.id===vehicle.truck_type_id);
    const currentLabel=current?.name??'Unassigned';
    if(!window.confirm(`Change Vehicle ${vehicle.vehicle_no} Truck Type from "${currentLabel}" to "${truckType.name}"? This updates the Vehicle Master.`))return;
    const result=await supabase.from('transport_vehicles').update({truck_type_id:truckType.id}).eq('id',vehicle.id).select('id').single();
    if(result.error)throw result.error;
    window.dispatchEvent(new Event('navilo-master-data-changed'));
    const validated=await validateBulkMasters(bulkRows,true);setBulkRows(validated);
  }

  async function submitTripRows(payloads:Record<string,unknown>[]){
    const key=JSON.stringify({scopeKey,payloads});
    if(entryRequest.current?.key!==key)entryRequest.current={key,id:crypto.randomUUID()};
    const result=await supabase.rpc('transport_create_trips',{p_request_id:entryRequest.current.id,
      p_company_id:activeCompany?.company_id,p_business_unit_id:activeBusinessUnit?.business_unit_id,p_rows:payloads});
    if(result.error)throw result.error;
    return result.data;
  }

  const registerFilters={fromDate,toDate,customer:customerFilter,driver:driverFilter,vehicle:vehicleFilter,from:fromFilter,to:toFilter,ppr:pprFilter,statuses:statusFilters,columns:columnFilters,search:registerSearch};
  const registerKey=JSON.stringify({scopeKey,registerFilters,sortColumn,sortDirection});
  async function load(silent=false){
    // A successful rent save must refresh the register immediately. A previous
    // in-flight register read is stale at this point, so cancel it instead of
    // silently skipping the refresh (which left Supplier Balance unchanged).
    registerRequest.current?.abort();const controller=new AbortController();registerRequest.current=controller;
    const generation=++readGeneration.current;
    if(!silent)setRegisterLoading(true);setError('');
    try {
      const result=await supabase.rpc('transport_register_query',{p_limit:500,p_offset:page*500,p_filters:registerFilters,p_sort:sortColumn,p_direction:sortDirection}).abortSignal(controller.signal);
      if(result.error)throw result.error;
      if(scopeRef.current!==scopeKey||generation!==readGeneration.current)return;
      const data=result.data;
      setRows((data.rows??[]).map((r:any)=>({...r,status:r.status??r.trip_status,truck_type:r.truck_type_name??r.truck_type})));
      setRegisterMeta(data);
      if(page>Math.max(0,Math.ceil(data.count/500)-1))setPage(Math.max(0,Math.ceil(data.count/500)-1));
    }catch(e:any){if(generation===readGeneration.current){setRows([]);setRegisterMeta({count:0,totals:{},completed:0,paper_pending:0,statuses:[]});setError(e?.message||'Unable to load trips.');}}
    finally{if(registerRequest.current===controller)registerRequest.current=null;if(generation===readGeneration.current)setRegisterLoading(false);}
  }
  const previousRegisterKey=useRef(registerKey);
  useEffect(()=>{
    const changed=previousRegisterKey.current!==registerKey;previousRegisterKey.current=registerKey;
    // Keep the current page visible while a filter request is in flight.
    // Clearing rows made every header-filter click look like a dashboard hang.
    readGeneration.current++;setRegisterLoading(true);
    if(changed&&page!==0){setPage(0);return;}
    if(tab==="mobile"){setRegisterLoading(false);return;}
    if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){setRegisterLoading(false);return;}
    const timer=window.setTimeout(()=>void load(),200);
    return()=>{window.clearTimeout(timer);registerRequest.current?.abort();registerRequest.current=null;readGeneration.current++;};
  },[registerKey,page,tab]);

  const mobileToday=new Date().toISOString().slice(0,10);
  const mobileFromDate=new Date(Date.now()-29*24*60*60*1000).toISOString().slice(0,10);
  async function loadMobileTrips(search=mobileSearch){
    if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id)return;
    setMobileLoading(true);setError("");
    try{
      const result=await supabase.rpc('transport_register_query',{
        p_limit:50,
        p_offset:0,
        p_filters:{fromDate:mobileFromDate,toDate:mobileToday,search:search.trim()},
        p_sort:'trip_date',
        p_direction:'desc'
      });
      if(result.error)throw result.error;
      setMobileRows((result.data?.rows??[]).map((r:any)=>({...r,status:r.status??r.trip_status,truck_type:r.truck_type_name??r.truck_type})));
    }catch(e:any){
      setMobileRows([]);
      setError(e?.message||"Unable to search recent Trips.");
    }finally{setMobileLoading(false);}
  }
  useEffect(()=>{
    if(tab!=="mobile")return;
    void loadMobileTrips("");
  },[tab,scopeKey]);

  useEffect(()=>{
    let active=true;
    setQuickAdd(null);setQuickSupplierId('');setBulkRows([]);setEditingTripId(null);setRateTouched(false);
    setForm(previous=>({...previous,customer_id:'',vehicle_id:'',driver_id:'',truck_type_id:'',from_location:'',to_location:'',customer_rate:'',supplier_rent:'',driver_pay:''}));
    setTripMasters({customers:[],truckTypes:[],locations:[],vehicles:[],drivers:[],suppliers:[],employees:[],ownership:[],rates:[]});
    setEntryPermissions({master:false,owner:false,rate:false,rent:false,driver:false});
    const action=(p_action:string)=>supabase.rpc('has_transport_action_permission',{p_company_id:activeCompany?.company_id,p_action});
    void Promise.all([action('master_manage'),action('vehicle_owner_change'),action('customer_rate_finalize'),action('rent_finalize'),
      supabase.rpc('transport_finance_allowed',{p_action:'rent'}),supabase.rpc('transport_finance_allowed',{p_action:'driver'})])
      .then(results=>{if(active){if(results.some(r=>r.error)){setError('Unable to load entry permissions.');return;}
        setEntryPermissions({master:results[0].data===true,owner:results[1].data===true,rate:results[2].data===true,rent:results[3].data===true&&results[4].data===true,driver:results[5].data===true});}});
    return()=>{active=false};
  },[scopeKey]);

  useEffect(()=>{
    if(activeCompany?.company_id&&activeBusinessUnit?.business_unit_id){
      void loadTripMasters().catch((e:any)=>setError(e?.message||"Unable to load Transport masters."));
    }
  },[activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);

  useEffect(()=>{
    if(tab!=="trips"||!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id)return;
    const refresh=()=>{if(document.visibilityState==="visible")void load(true)};
    const timer=window.setInterval(refresh,30000);
    window.addEventListener("focus",refresh);
    document.addEventListener("visibilitychange",refresh);
    return ()=>{
      window.clearInterval(timer);
      window.removeEventListener("focus",refresh);
      document.removeEventListener("visibilitychange",refresh);
    };
  },[tab,registerKey,page]);

  useEffect(()=>{
    if(tab!=="trips")return;
    const frame=window.requestAnimationFrame(()=>{
      if(tripsGridRef.current)tripsGridRef.current.scrollLeft=0;
    });
    return ()=>window.cancelAnimationFrame(frame);
  },[tab,activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);

  const visible=rows;
  const unique=(values:(string|null|undefined)[])=>Array.from(new Set(values.filter((v):v is string=>Boolean(v)))).sort();
  const customerOptions=unique(tripMasters.customers.map(r=>r.name));
  const driverOptions=unique(tripMasters.drivers.map(r=>r.driver_name));
  const vehicleOptions=unique(tripMasters.vehicles.map(r=>r.vehicle_no));
  const fromOptions=unique(tripMasters.locations.map(r=>r.name));
  const toOptions=fromOptions;
  const pprOptions=['pending','received','not_required'];
  const statusOptions=registerMeta.statuses??[];
  // Canonical Trip Status options, narration and counts are supplied by the register RPC.
  const statusNarration=(option:any)=>String(option?.narration??'');
  const visibleStatusOptions=statusOptions.filter((option:any)=>!statusSearch||`${option.label} ${statusNarration(option)}`.toLowerCase().includes(statusSearch.toLowerCase()));
  const dashboardSummary=registerMeta.summary??{};
  const statusMark=(status?:string|null)=>{
    const key=String(status??'').toLowerCase();
    if(key==='draft')return {mark:'○',className:'text-slate-500',title:'Draft'};
    if(key==='incomplete')return {mark:'◐',className:'text-amber-600',title:'Incomplete'};
    if(key==='complete')return {mark:'✓',className:'text-emerald-600',title:'Complete'};
    if(key==='locked')return {mark:'🔒',className:'text-blue-700',title:'Locked'};
    if(key==='settled')return {mark:'●',className:'text-emerald-700',title:'Settled'};
    return {mark:'?',className:'text-slate-400',title:'Unknown'};
  };

  const resetFilters=()=>{
    setRegisterSearch("");
    setRegisterSearchDraft("");
    setFromDate("");
    setToDate("");
    setCustomerFilter("");
    setDriverFilter("");
    setVehicleFilter("");
    setFromFilter("");
    setToFilter("");
    setPprFilter("");
    setStatusFilters([]);
    setStatusSearch("");
    setStatusOpen(false);
  };

  useEffect(()=>{
    const el=tripsGridRef.current;
    if(!el||tab!=="trips")return;

    const onWheel=(event:WheelEvent)=>{
      // Header and horizontal gestures move columns; ordinary body wheel stays native.
      if(event.ctrlKey)return;
      const onHeader=event.target instanceof Element&&Boolean(event.target.closest('thead'));
      const horizontal=onHeader||event.shiftKey||Math.abs(event.deltaX)>Math.abs(event.deltaY);
      const scale=event.deltaMode===1?16:event.deltaMode===2?el.clientWidth:1;
      const delta=(horizontal?(event.deltaX||event.deltaY):event.deltaY)*scale;
      if(!horizontal)return;
      if(!delta)return;
      event.preventDefault();
      event.stopImmediatePropagation();
      el.scrollLeft+=delta;
    };

    el.addEventListener("wheel",onWheel,{passive:false,capture:true});
    return ()=>el.removeEventListener("wheel",onWheel,{capture:true});
  },[tab,showPartyReports]);


  useLayoutEffect(()=>{
    const section=tripsSectionRef.current;
    if(!section||tab!=="trips"||showPartyReports)return;
    const fit=()=>{
      const viewport=window.visualViewport?.height??window.innerHeight;
      const available=Math.max(360,Math.floor(viewport-section.getBoundingClientRect().top-8));
      section.style.height=`${available}px`;
    };
    fit();
    window.addEventListener('resize',fit);
    window.visualViewport?.addEventListener('resize',fit);
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(fit);
    if(section.parentElement)observer?.observe(section.parentElement);
    return()=>{
      window.removeEventListener('resize',fit);
      window.visualViewport?.removeEventListener('resize',fit);
      observer?.disconnect();
    };
  },[tab,showPartyReports]);

  const DEFAULT_TRIPS_GRID_HEIGHT=520; // retained for legacy saved preference; viewport now owns the Trips height
  const [tripsGridHeight,setTripsGridHeight]=useState(()=>{
    const saved=Number(localStorage.getItem("navilo.transport.tripsGridHeight"));
    return Number.isFinite(saved)&&saved>=220?saved:DEFAULT_TRIPS_GRID_HEIGHT;
  });



  const startTripsGridResize=(event:React.MouseEvent<HTMLDivElement>)=>{
    event.preventDefault();

    const startY=event.clientY;
    const startHeight=tripsGridHeight;

    const onMove=(moveEvent:MouseEvent)=>{
      const maxHeight=Math.max(260,window.innerHeight-150);
      const next=Math.min(
        maxHeight,
        Math.max(220,startHeight+(moveEvent.clientY-startY))
      );
      setTripsGridHeight(next);
    };

    const onUp=()=>{
      window.removeEventListener("mousemove",onMove);
      window.removeEventListener("mouseup",onUp);
    };

    window.addEventListener("mousemove",onMove);
    window.addEventListener("mouseup",onUp);
  };

  const saveTripsGridDefault=()=>{
    localStorage.setItem(
      "navilo.transport.tripsGridHeight",
      String(Math.round(tripsGridHeight))
    );
  };

  const resetTripsGridHeight=()=>{
    localStorage.removeItem("navilo.transport.tripsGridHeight");
    setTripsGridHeight(DEFAULT_TRIPS_GRID_HEIGHT);
  };


  const cleanBulkText=(value:unknown)=>
    String(value??"").trim();

  const normalizeBulkDate=(value:unknown)=>{
    if(value instanceof Date&&!Number.isNaN(value.getTime())){
      return value.toISOString().slice(0,10);
    }

    if(typeof value==="number"&&Number.isFinite(value)){
      const parsed=XLSX.SSF.parse_date_code(value);
      if(parsed){
        const mm=String(parsed.m).padStart(2,"0");
        const dd=String(parsed.d).padStart(2,"0");
        return `${parsed.y}-${mm}-${dd}`;
      }
    }

    const raw=cleanBulkText(value);
    if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;

    const d=new Date(raw);
    return Number.isNaN(d.getTime())?"":d.toISOString().slice(0,10);
  };

  const downloadBulkTemplate=()=>{
    const example=[
      new Date(),
      "FLATBED",
      "PO-001",
      "",
      "Example Customer",
      "Example Driver",
      "Example Supplier",
      "ABC-123",
      "Dammam",
      "Riyadh",
      "PPR PENDING",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Credit",
      ""
    ];

    const ws=XLSX.utils.aoa_to_sheet([
      [...TRANSPORT_TRIP_HEADERS],
      example
    ]);

    ws["!cols"]=TRANSPORT_TRIP_HEADERS.map((header)=>({
      wch:Math.min(28,Math.max(12,String(header).length+3))
    }));

    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Trips");

    const companies=XLSX.utils.aoa_to_sheet([["COMPANY NAME"]]);
    const vehicles=XLSX.utils.aoa_to_sheet([["PLATE #","TRUCK TYPE"]]);
    const owners=XLSX.utils.aoa_to_sheet([["OWNER"]]);
    const places=XLSX.utils.aoa_to_sheet([["PLACE"]]);

    XLSX.utils.book_append_sheet(wb,companies,"compnies");
    XLSX.utils.book_append_sheet(wb,vehicles,"vehicles");
    XLSX.utils.book_append_sheet(wb,owners,"owners");
    XLSX.utils.book_append_sheet(wb,places,"places");

    XLSX.writeFile(wb,"Transport_Trip_Excel_Upload_template-NAVILO.xlsx");
  };

  const validateBulkRow=(row:BulkTripRow)=>{
    const errors:string[]=[];
    if(!row.trip_date)errors.push('Trip Date required');
    if(!row.customer)errors.push('Customer required');
    if(!row.from_location||!row.to_location)errors.push('From and To required');
    if(!['cash','credit'].includes(row.sale_type))errors.push('Sale Type must be Cash or Credit');
    if(!['pending','received','not_required'].includes(row.ppr_status))errors.push('Invalid PPR Status');
    if(row.ppr_status==='received'&&(!row.ppr_employee||!row.ppr_date))errors.push('PPR Received requires Employee and Date');
    for(const [label,value] of [['Customer Rate',row.customer_rate],['Supplier Rent',row.supplier_rent],['Driver Pay',row.driver_pay]])
      if(!validMoney(value))errors.push(`${label} must be nonnegative with at most two decimal places`);
    return errors;
  };
  const validateBulkMasters=async(rowsToValidate:BulkTripRow[],allowRepeatJourneys=false)=>{
    setBulkValidating(true);
    try{
      const masters=await loadTripMasters();const seen=new Set<string>();
      const indexes=new Map<any[],Map<string,any[]>>();
      for(const [records,column] of [[masters.customers,'name'],[masters.truckTypes,'name'],[masters.vehicles,'vehicle_no'],[masters.drivers,'driver_name'],[masters.locations,'name'],[masters.employees,'name']] as const){
        const index=new Map<string,any[]>();for(const r of records){const k=masterKey(r[column]);index.set(k,[...(index.get(k)??[]),r]);}indexes.set(records,index);
      }
      const ownership=new Map<string,OwnershipPeriod[]>();for(const period of masters.ownership)ownership.set(period.vehicle_id,[...(ownership.get(period.vehicle_id)??[]),period]);
      const resolve=(records:any[],name:string,_column='name')=>{
        const found=indexes.get(records)?.get(masterKey(name))??[];
        return found.length===1?found[0]:null;
      };
      return rowsToValidate.map(row=>{
        const errors=validateBulkRow(row);
        const customer=resolve(masters.customers,row.customer),truck=resolve(masters.truckTypes,row.truck_type);
        const vehicle=row.vehicle?resolve(masters.vehicles,row.vehicle,'vehicle_no'):null;
        const driver=row.driver?resolve(masters.drivers,row.driver,'driver_name'):null;
        const from=resolve(masters.locations,row.from_location),to=resolve(masters.locations,row.to_location);
        const employee=row.ppr_status==='received'?resolve(masters.employees,row.ppr_employee):null;
        for(const [label,record,needed] of [['Customer',customer,true],['Truck Type',truck,!!row.truck_type],['Vehicle',vehicle,!!row.vehicle],
          ['Driver',driver,!!row.driver],['From',from,true],['To',to,true],['PPR Employee',employee,row.ppr_status==='received']] as const)
          if(needed&&(!record||!record.is_active))errors.push(`${label} is missing, ambiguous or inactive in the selected workspace`);
        if(truck&&vehicle&&vehicle.truck_type_id!==truck.id)errors.push('Vehicle does not match Truck Type');
        const owner=vehicle?ownershipOnDate(ownership.get(vehicle.id)??[],vehicle.id,row.trip_date):null;
        if(vehicle&&!owner)errors.push('Vehicle Ownership History must cover Trip Date');
        if(row.owner_supplier&&(!owner||masterKey(row.owner_supplier)!==masterKey(owner.owner_name_snapshot)))errors.push('Owner / Supplier does not match dated ownership');
        if(row.supplier_rent!==''&&owner?.owner_type!=='third_party')errors.push('Supplier Rent requires dated Supplier Owned Vehicle');
        if(row.driver_pay!==''&&Number(row.driver_pay)>0&&!driver)errors.push('Driver Pay requires Driver');
        const duplicateKey=tripImportIdentity(row,{customer:customer?.id,vehicle:vehicle?.id,driver:driver?.id,from:from?.id,to:to?.id});
        if(!allowRepeatJourneys&&seen.has(duplicateKey))errors.push('Duplicate row in upload file');seen.add(duplicateKey);
        return {...row,errors,payload:{trip_date:row.trip_date,customer_id:customer?.id,truck_type_id:truck?.id??vehicle?.truck_type_id??null,
          vehicle_id:vehicle?.id??null,driver_id:driver?.id??null,from_location_id:from?.id,to_location_id:to?.id,
          po_do_job_no:row.po_do_job_no||null,ppr_status:row.ppr_status,
          ppr_received_by_employee_id:row.ppr_status==='received'?employee?.id:null,ppr_received_date:row.ppr_status==='received'?row.ppr_date:null,
          customer_rate:row.customer_rate===''?null:Number(row.customer_rate),supplier_rent:row.supplier_rent===''?null:Number(row.supplier_rent),
          driver_pay:row.driver_pay===''?null:Number(row.driver_pay),sale_type:row.sale_type,source_invoice_no:row.source_invoice_no||null,notes:row.notes||null}};
      });
    }finally{setBulkValidating(false)}
  };
  const executeImport=async(job:ImportJob)=>{
    if(submissionRef.current||bulkParsing||bulkValidating)return;
    const startedScope=importScope;
    submissionRef.current=true;importStop.current=false;setBulkImporting(true);setError('');
    try {
      const prepared=await supabase.rpc('transport_prepare_trip_import',{p_source_hash:job.sourceHash,p_file_name:job.fileName,p_manifest:job.batches.map(batch=>batch.rowNos)});
      if(prepared.error)throw prepared.error;
      if(!prepared.data?.id||!Number.isInteger(prepared.data.completed))throw new Error('Invalid import preparation response.');
      job.serverId=prepared.data.id;job.completed=prepared.data.completed;
      setImportJob({...job});
      await runImportJob(job,async(batch)=>{
        if(importScopeRef.current!==startedScope)throw new Error('Workspace changed. Import paused.');
        const r=await supabase.rpc('transport_import_trip_batch',{p_job_id:job.serverId,p_batch:job.completed,p_rows:batch.rows});
        if(r.error)throw r.error;return r.data;
      },saveImport,current=>{if(importScopeRef.current===startedScope)setImportJob({...current})},()=>importStop.current||importScopeRef.current!==startedScope);
      if(importScopeRef.current!==startedScope)return;
      setImportJob({...job});
      if(job.completed===job.batches.length){setBulkRows(current=>current.filter(r=>r.errors.length));await load();window.alert(`${job.total} Trips imported. Rejected rows remain available for review.`);}
    }catch(e:any){if(importScopeRef.current===startedScope)setError(`${e.message||'Import stopped.'} Resume uses the same batch IDs; completed batches are preserved.`);}
    finally{submissionRef.current=false;setBulkImporting(false);}
  };
  const importValidBulkRows=async()=>{
    if(submissionRef.current||bulkParsing||bulkValidating)return;
    try {
      const validated=await validateBulkMasters(bulkRows);setBulkRows(validated);
      if(!validated.some(r=>!r.errors.length))throw new Error('No valid rows are available for import.');
      if(importJob&&importJob.completed<importJob.batches.length)throw new Error('Resume the pending import before starting another file.');
      if(!window.confirm(`Import ${validated.filter(r=>!r.errors.length).length} valid Trips in batches of 100? NAVILO generates Trip Nos. Legacy payment/profit columns do not post accounting.`))return;
      const job={...makeImportJob(importScope,bulkFileName,validated),sourceHash:bulkSourceHash};setImportJob(job);await executeImport(job);
    }catch(e:any){setError(e.message||'Unable to prepare import.');}
  };
  const parseBulkFile=async(file:File)=>{
    if(bulkImporting||bulkParsing||bulkValidating)return;
    if(importJob&&importJob.completed<importJob.batches.length){setError('Resume the pending import before selecting another file.');return;}
    const startedScope=scopeKey;setBulkParsing(true);setError('');
    try {
      if(file.size>30*1024*1024)throw new Error('Maximum upload size is 30 MB.');
      const buffer=await file.arrayBuffer();const hash=await fileDigest(buffer);const normalized=await parseTripFile(buffer);
      if(normalized.some(row=>row.has_accounting_evidence))throw new Error('This file contains historical payments or accounting evidence. Use One-time Historical Import so receipts and paid rent are reconciled instead of omitted.');
      const validated=await validateBulkMasters(normalized);
      if(scopeRef.current!==startedScope)return;
      setBulkRows(validated);setBulkFileName(file.name);setBulkSourceHash(hash);setBulkPreviewPage(0);
    }catch(e:any){if(scopeRef.current===startedScope){setBulkRows([]);setBulkFileName('');setError(e.message||'Unable to read upload file.');}}
    finally{setBulkParsing(false);}
  };
  const clearBulkUpload=()=>{if(bulkImporting||bulkParsing||bulkValidating)return;setBulkRows([]);setBulkFileName('');setBulkPreviewPage(0);};
  const downloadRejected=()=>{
    const rejected=bulkRows.filter(r=>r.errors.length);
    const workbook=XLSX.utils.book_new();const sheet=XLSX.utils.aoa_to_sheet([
      [...TRANSPORT_TRIP_HEADERS,'Source Row','Validation Errors'],
      ...rejected.map(r=>[r.trip_date,r.truck_type,r.po_do_job_no,'',r.customer,r.driver,r.owner_supplier,r.vehicle,r.from_location,r.to_location,
        r.ppr_status==='received'?r.ppr_employee:r.ppr_status==='not_required'?'N/A':'PPR PENDING',r.ppr_date,'',r.supplier_rent,'','','',r.customer_rate,'','','','',r.source_invoice_no,r.sale_type,r.driver_pay,r.rowNo,r.errors.join('; ')])
    ]);
    XLSX.utils.book_append_sheet(workbook,sheet,'Rejected rows');XLSX.writeFile(workbook,'NAVILO-Trip-Import-Rejected.csv',{bookType:'csv'});
  };

  async function openQuickPpr(row:Trip){
    setError("");setLoading(true);
    try{await loadTripMasters();setQuickPprEmployee("");setQuickPprDate(new Date().toISOString().slice(0,10));setQuickPprFile(null);setQuickPprTrip(row);}
    catch(e:any){setError(e?.message||"Unable to load PPR employees.");}finally{setLoading(false);}
  }
  async function saveQuickPpr(){
    if(!quickPprTrip||!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id)return;
    if(!quickPprEmployee||!quickPprDate){setError("Select Received By employee and PPR date.");return;}
    if(quickPprFile&&(quickPprFile.size>10*1024*1024||!['application/pdf','image/jpeg','image/png','image/webp'].includes(quickPprFile.type))){setError('Choose a PDF, JPEG, PNG or WebP up to 10 MB.');return;}
    setLoading(true);setError("");
    let uploadedPath="";
    try{
      if(quickPprFile){
        const {data:branch,error:branchError}=await supabase.rpc('current_operating_location_id');if(branchError)throw branchError;if(!branch)throw new Error('Select an active branch before attaching PPR.');
        uploadedPath=`${activeCompany.company_id}/${activeBusinessUnit.business_unit_id}/${branch}/${quickPprTrip.id}/${crypto.randomUUID()}.${quickPprFile.type==='application/pdf'?'pdf':quickPprFile.type.split('/')[1]}`;
        const {error:uploadError}=await supabase.storage.from('transport-ppr').upload(uploadedPath,quickPprFile,{upsert:false});if(uploadError)throw uploadError;
      }
      const changes:any={ppr_status:'received',ppr_received_by_employee_id:quickPprEmployee,ppr_received_date:quickPprDate};
      if(uploadedPath)changes.ppr_attachment_path=uploadedPath;
      const {data,error}=await supabase.rpc('transport_update_operational_trip',{p_trip_id:quickPprTrip.id,p_changes:changes});
      if(error||!data){if(uploadedPath)await supabase.storage.from('transport-ppr').remove([uploadedPath]);throw error||new Error('PPR is no longer pending.');}
      setQuickPprTrip(null);setQuickPprEmployee("");setQuickPprFile(null);await load();
    }catch(e:any){if(uploadedPath)await supabase.storage.from('transport-ppr').remove([uploadedPath]);setError(e?.message||"Unable to receive PPR.");}finally{setLoading(false);}
  }

  async function startEditTrip(row:Trip,returnTo:Tab="trips"){
    if(returnTo==="mobile"&&!mobileCanEdit){setError("Mobile Trip editing is disabled in Owner Control.");return;}
    entryReturnTab.current=returnTo;
    setLoading(true);
    setError("");
    try{
      // Masters are already loaded for the active workspace. Do not refetch every
      // company/BU master merely to open one Trip; that made ordinary clicks feel hung.
      const {data,error}=await supabase.rpc('transport_edit_trip_read',{p_trip_id:row.id});
      if(error)throw error;
      const savedRents:Array<{amount:number;finalized_amount_snapshot:number}>=data.supplier_rent_total==null?[]:[{amount:Number(data.supplier_rent_total),finalized_amount_snapshot:Number(data.supplier_rent_total)}];
      setForm({
        trip_date:data.trip_date||new Date().toISOString().slice(0,10),
        customer_id:data.customer_id||"",
        customer_name_snapshot:data.customer_name_snapshot||"",
        truck_type_id:data.truck_type_id||"",
        vehicle_id:data.vehicle_id||"",
        driver_id:data.driver_id||"",
        from_location:data.from_location||"",
        to_location:data.to_location||"",
        po_do_job_no:data.po_do_job_no||"",
        ppr_status:data.ppr_status||"pending",
        ppr_received_date:data.ppr_received_date||"",
        ppr_received_by_employee_id:data.ppr_received_by_employee_id||"",
        ppr_attachment_path:data.ppr_attachment_path||"",
        customer_rate:data.customer_rate==null?"":String(data.customer_rate),
        supplier_rent:savedRents.length?String(savedRents.reduce((total,r)=>total+Number(r.finalized_amount_snapshot??r.amount),0)):data.owner_rent==null?"":String(data.owner_rent),
        driver_pay:data.driver_pay==null?"":String(data.driver_pay),
        sale_type:data.sale_type||"",
        notes:data.notes||""
      });
      setEditingRateLocks({customer:Boolean(row.customer_rate_locked),supplier:Boolean(row.supplier_rate_locked)});
      setEditingTripId(data.id);
      setEditingTripNo(data.trip_no);
      setEditingOriginalAssignment({vehicle_id:data.vehicle_id||"",driver_id:data.driver_id||""});
      setNewTripMode("single");
      setTab("new");
    }catch(e:any){
      setError(e?.message||"Unable to open Trip for editing.");
    }finally{
      setLoading(false);
    }
  }

  async function attachPpr(file:File){
    if(!editingTripId||!activeCompany||!activeBusinessUnit)return;
    if(file.size>10*1024*1024||!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type)){setError('Choose a PDF, JPEG, PNG or WebP up to 10 MB.');return}
    setLoading(true);setError('');
    try{
      const {data:branch,error:branchError}=await supabase.rpc('current_operating_location_id');if(branchError)throw branchError;if(!branch)throw new Error('Select an active branch before attaching PPR.');
      const path=`${activeCompany.company_id}/${activeBusinessUnit.business_unit_id}/${branch}/${editingTripId}/${crypto.randomUUID()}.${file.type==='application/pdf'?'pdf':file.type.split('/')[1]}`;
      const {error:uploadError}=await supabase.storage.from('transport-ppr').upload(path,file,{upsert:false});if(uploadError)throw uploadError;
      const {data,error}=await supabase.rpc('transport_update_operational_trip',{p_trip_id:editingTripId,p_changes:{ppr_attachment_path:path}});
      if(error||!data){await supabase.storage.from('transport-ppr').remove([path]);throw error||new Error('Save the Received employee and date before attaching PPR.');}
      setForm(previous=>({...previous,ppr_attachment_path:path}));await load();
    }catch(e:any){setError(e?.message||'Unable to attach PPR.')}finally{setLoading(false)}
  }
  async function openPpr(){
    try{const {data,error}=await supabase.storage.from('transport-ppr').createSignedUrl(form.ppr_attachment_path,60);if(error)throw error;window.open(data.signedUrl,'_blank','noopener,noreferrer')}catch(e:any){setError(e?.message||'Unable to open PPR.')}
  }
  async function updateTrip(){
    if(entryReturnTab.current==="mobile"&&!mobileCanEdit){setError("Mobile Trip editing is disabled in Owner Control.");return;}
    if(!editingTripId||!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id)return;
    
    if(!form.customer_id){setError("Customer is required.");return}
    if(!form.sale_type){setError("Sale Type Cash or Credit is required.");return}
    if(!form.from_location.trim()||!form.to_location.trim()){setError("From and To locations are required.");return}
    if(!form.sale_type){setError("Sale Type Cash or Credit is required.");return}

    if(form.ppr_status==="received"&&(!form.ppr_received_by_employee_id||!form.ppr_received_date)){setError("PPR Received requires the receiving employee and date.");return}
    const customer=tripMasters.customers.find((c:any)=>c.id===form.customer_id);
    if(!customer){setError("Selected Customer is no longer available.");return}

    setLoading(true);
    setError("");
    try{
      const payload=editingTripLocked?{
        ppr_status:form.ppr_status,
        ppr_received_date:form.ppr_status==="received"?(form.ppr_received_date||null):null,
        ppr_received_by_employee_id:form.ppr_status==="received"?form.ppr_received_by_employee_id:null,
        ppr_attachment_path:form.ppr_status==="received"?(form.ppr_attachment_path||null):null,
        notes:form.notes||null
      }:{
        trip_date:form.trip_date,
        customer_id:customer.id,
        customer_name_snapshot:customer.name,
        vehicle_id:form.vehicle_id||null,
        driver_id:form.driver_id||null,
        truck_type_id:form.truck_type_id||null,
        owner_name_snapshot:ownerDisplay||null,
        from_location:form.from_location,
        to_location:form.to_location,
        po_do_job_no:form.po_do_job_no||null,
        ppr_status:form.ppr_status,
        ppr_received_date:form.ppr_status==="received"?(form.ppr_received_date||null):null,
        ppr_received_by_employee_id:form.ppr_status==="received"?form.ppr_received_by_employee_id:null,
        ppr_attachment_path:form.ppr_status==="received"?(form.ppr_attachment_path||null):null,

        sale_type:form.sale_type,
        notes:form.notes||null
      };

      const assignmentChanged=!editingTripLocked&&(
        form.vehicle_id!==editingOriginalAssignment.vehicle_id ||
        form.driver_id!==editingOriginalAssignment.driver_id);

      if(assignmentChanged){
        const reason=window.prompt(
          "Driver/vehicle replacement reason is required for the audit history:",
          ""
        );
        if(!reason?.trim()){
          setError("Driver/vehicle replacement cancelled. A reason is required.");
          return;
        }

        const {error:replaceError}=await supabase.rpc("transport_replace_trip_assignment",{
          p_trip_id:editingTripId,
          p_vehicle_id:form.vehicle_id||null,
          p_driver_id:form.driver_id||null,
          p_reason:reason.trim()
        });
        if(replaceError)throw replaceError;
      }

      // Trip Date is permanent on the edit screen; avoid a second round-trip just
      // to rediscover the date we opened with.
      const originalTripDate=form.trip_date;
      let correctionReason:string|null=null;
      if(originalTripDate&&form.trip_date!==originalTripDate){
        correctionReason=window.prompt("Trip Date correction reason is required for audit history:","")?.trim()||null;
        if(!correctionReason){setError("Trip Date correction cancelled. A reason is required.");return;}
      }
      const safePayload={...payload,...(correctionReason?{correction_reason:correctionReason}:{})};
      delete (safePayload as any).vehicle_id;
      delete (safePayload as any).driver_id;
      delete (safePayload as any).owner_name_snapshot;
      if(editingRateLocks.supplier)delete (safePayload as any).owner_rent;
      if(editingRateLocks.customer){
        delete (safePayload as any).customer_rate;
        delete (safePayload as any).customer_id;
        delete (safePayload as any).sale_type;
      }

      const {error}=await supabase.rpc('transport_update_operational_trip',{p_trip_id:editingTripId,p_changes:safePayload});
      if(error)throw error;

      setEditingTripId(null);
      setEditingTripNo("");
      setEditingOriginalAssignment({vehicle_id:"",driver_id:""});
      const returnTo=entryReturnTab.current;
      setTab(returnTo);
      if(returnTo==="mobile")await loadMobileTrips(mobileSearch);else await load();
    }catch(e:any){
      setError(e?.message||"Unable to update Trip.");
    }finally{
      setLoading(false);
    }
  }
  const normalizedVoice=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const voiceMasterMatch=(items:any[],label:(item:any)=>string,text:string)=>{
    const hay=normalizedVoice(text);
    return [...items].sort((a,b)=>label(b).length-label(a).length).find(item=>{const needle=normalizedVoice(label(item));return needle.length>=2&&hay.includes(needle)})||null;
  };
  const voiceLocationMatch=(segment:string)=>{
    const value=normalizedVoice(segment);
    return [...tripMasters.locations].sort((a:any,b:any)=>String(b.name).length-String(a.name).length).find((item:any)=>{const name=normalizedVoice(String(item.name||""));return name&&((value.includes(name))||(name.includes(value)&&value.length>=3))})||null;
  };
  const voiceMoney=(text:string,labels:string[])=>{
    for(const label of labels){const match=normalizedVoice(text).match(new RegExp(`(?:^| )${label.replace(/ /g,"\\s+")}\\s+(\\d+(?:\\.\\d+)?)`));if(match)return match[1];}
    return "";
  };
  const parseVoiceTrip=(transcript:string)=>{
    const lower=normalizedVoice(transcript);
    const customer=voiceMasterMatch(tripMasters.customers,(x:any)=>String(x.name||""),transcript);
    const driver=voiceMasterMatch(tripMasters.drivers,(x:any)=>String(x.driver_name||""),transcript);
    const vehicle=voiceMasterMatch(tripMasters.vehicles,(x:any)=>String(x.vehicle_no||""),transcript);
    const truck=voiceMasterMatch(tripMasters.truckTypes,(x:any)=>String(x.name||""),transcript);
    const route=lower.match(/(?:^| )from (.+?) to (.+?)(?= (?:po|do|job|customer rate|company rate|supplier rent|rent|driver pay|cash|credit)(?: |$)|$)/);
    const from=route?voiceLocationMatch(route[1]):null;
    const to=route?voiceLocationMatch(route[2]):null;
    const po=lower.match(/(?:^| )(?:po|do|job)(?: no| number)? ([a-z0-9-]+)/)?.[1]||"";
    const patch:Record<string,string>={
      trip_date:new Date().toISOString().slice(0,10),
      customer_id:customer?.id||"",
      customer_name_snapshot:customer?.name||"",
      driver_id:driver?.id||"",
      vehicle_id:vehicle?.id||"",
      truck_type_id:vehicle?.truck_type_id||truck?.id||"",
      from_location:from?.name||"",
      to_location:to?.name||"",
      po_do_job_no:po.toUpperCase(),
      customer_rate:voiceMoney(transcript,["customer rate","company rate"]),
      supplier_rent:voiceMoney(transcript,["supplier rent","rent"]),
      driver_pay:voiceMoney(transcript,["driver pay"]),
      sale_type:/\bcash\b/.test(lower)?"cash":/\bcredit\b/.test(lower)?"credit":"",
      ppr_status:"pending",
    };
    return patch;
  };
  const openVoiceDraft=(draft:MobileVoiceDraft)=>{
    setCurrentVoiceDraftId(draft.id);setVoiceStatus(`Voice draft · ${draft.transcript}`);
    setEditingTripId(null);setEditingTripNo("");setEditingOriginalAssignment({vehicle_id:"",driver_id:""});setNewTripMode("single");
    setForm(previous=>({...previous,...draft.patch,notes:previous.notes}));entryReturnTab.current="mobile";setTab("new");
  };
  const captureVoiceTrip=()=>{
    if(!mobileCanCreate){setError("Mobile Trip creation is disabled in Owner Control.");return;}
    const Recognition=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
    if(!Recognition){setError("Voice entry is not supported by this browser. Use Chrome on Android or a browser with speech recognition.");return;}
    try{
      voiceRecognitionRef.current?.stop?.();
      const recognition=new Recognition();voiceRecognitionRef.current=recognition;
      recognition.lang="en-US";recognition.interimResults=false;recognition.maxAlternatives=1;
      recognition.onstart=()=>{setVoiceListening(true);setVoiceStatus("Listening… Say customer, vehicle, driver, From, To, PO/DO, and Cash/Credit.")};
      recognition.onerror=(event:any)=>{setVoiceListening(false);setError(event?.error==="not-allowed"?"Microphone permission is required for Voice Trip.":"Voice recognition failed. Try again.")};
      recognition.onend=()=>setVoiceListening(false);
      recognition.onresult=(event:any)=>{
        const transcript=String(event?.results?.[0]?.[0]?.transcript||"").trim();
        if(!transcript){setVoiceStatus("No speech detected.");return;}
        const draft:MobileVoiceDraft={id:crypto.randomUUID(),created_at:new Date().toISOString(),transcript,patch:parseVoiceTrip(transcript)};
        const next=[draft,...voiceDrafts.filter(item=>item.transcript!==transcript)].slice(0,30);persistVoiceDrafts(next);openVoiceDraft(draft);
      };
      recognition.start();
    }catch(e:any){setVoiceListening(false);setError(e?.message||"Could not start microphone.");}
  };

  async function createTrip(){
    if(entryReturnTab.current==="mobile"&&!mobileCanCreate){setError("Mobile Trip creation is disabled in Owner Control.");return;}
    if(submissionRef.current)return;
    if(!form.customer_id||!form.trip_date||!['cash','credit'].includes(form.sale_type)){setError('Customer, Trip Date and Sale Type Cash or Credit are required.');return}
    const from=tripMasters.locations.find(l=>l.name===form.from_location),to=tripMasters.locations.find(l=>l.name===form.to_location);
    if(!from||!to){setError('Select active From and To Locations.');return}
    if(form.vehicle_id&&!selectedOwnership){setError('Vehicle Ownership History must cover Trip Date.');return}
    if(form.ppr_status==='received'&&(!form.ppr_received_by_employee_id||!form.ppr_received_date)){setError('PPR Received requires Employee and Date.');return}
    if(![form.customer_rate,form.supplier_rent,form.driver_pay].every(validMoney)){setError('Amounts must be nonnegative with at most two decimal places.');return}
    submissionRef.current=true;setLoading(true);setError('');
    try{
      await submitTripRows([{trip_date:form.trip_date,customer_id:form.customer_id,truck_type_id:form.truck_type_id||null,
        vehicle_id:form.vehicle_id||null,driver_id:form.driver_id||null,from_location_id:from.id,to_location_id:to.id,
        po_do_job_no:form.po_do_job_no||null,ppr_status:form.ppr_status,
        ppr_received_date:form.ppr_status==='received'?form.ppr_received_date:null,
        ppr_received_by_employee_id:form.ppr_status==='received'?form.ppr_received_by_employee_id:null,
        customer_rate:entryPermissions.rate&&form.customer_rate!==''?Number(form.customer_rate):null,
        supplier_rent:supplierOwned&&form.supplier_rent!==''?Number(form.supplier_rent):null,
        driver_pay:form.driver_pay!==''?Number(form.driver_pay):null,sale_type:form.sale_type,notes:form.notes||null}]);
      setForm(previous=>({...previous,customer_id:'',vehicle_id:'',driver_id:'',truck_type_id:'',from_location:'',to_location:'',
        customer_rate:'',supplier_rent:'',driver_pay:'',po_do_job_no:'',ppr_status:'pending',ppr_received_date:'',ppr_received_by_employee_id:'',ppr_attachment_path:'',sale_type:'',notes:''}));
      setRateTouched(false);setEditingTripId(null);
      if(currentVoiceDraftId){removeVoiceDraft(currentVoiceDraftId);setVoiceStatus("Voice Trip created successfully.");}
      const returnTo=entryReturnTab.current;
      setTab(returnTo);
      if(returnTo==="mobile")await loadMobileTrips(mobileSearch);else await load();
    }catch(e:any){setError(e.message||'Unable to create Trip.')}
    finally{submissionRef.current=false;setLoading(false)}
  }


  const tripCellValue=(r:Trip,key:string):string=>{
    switch(key){
      case "trip_no": return String(r.trip_no??"");
      case "trip_date": return formatNaviloDate(r.trip_date);
      case "truck_type": return String(r.truck_type??"");
      case "job_no": return String(r.po_do_job_no??"");
      case "invoiced": return r.invoiced?"Yes":"No";
      case "company": return String(r.customer_name??"");
      case "driver": return String(r.driver_name??"");
      case "owner": return String(r.owner_name??"");
      case "plate": return String(r.vehicle_no??"");
      case "from": return String(r.from_location??"");
      case "to": return String(r.to_location??"");
      case "charge": return financialNumber(Number((r as any).customer_charges??(r as any).cells?.charge??0));
      case "paper_received_by": return r.ppr_status==="received"?[String(r.ppr_received_by_name??"—"),r.ppr_received_date?formatNaviloDate(r.ppr_received_date):""].filter(Boolean).join(" · "):"Pending";
      case "supplier_paid": return financialNumber(r.supplier_paid_net??r.supplier_paid_gross??0);
      case "supplier_balance": return financialNumber(Math.max(0,Number(r.supplier_outstanding_gross??r.remaining_with_us??0)));
      case "supplier_credit": return financialNumber(Math.max(0,Number(r.supplier_credit_gross??0)));
      case "customer_credit": return financialNumber(Math.max(0,Number(r.customer_credit_gross??0)));
      case "driver_pay": return financialNumber(r.driver_accrued??r.driver_pay);
      case "driver_paid": return financialNumber(r.driver_paid??0);
      case "driver_balance": return financialNumber(r.driver_outstanding??0);
      case "rent_driver": return financialNumber(r.billed_supplier_net??r.supplier_rent??r.owner_rent);
      case "supplier_charges": return financialNumber(r.supplier_charges??0);
      case "remaining_us": return financialNumber(r.remaining_with_us??0);
      case "payment_date": return r.payment_date?formatNaviloDate(r.payment_date):"";
      case "amount": return financialNumber(r.payment_amount??0);
      case "company_rate": return financialNumber(r.billed_customer_net??r.customer_rate);
      case "received_company": return financialNumber(r.received_from_company??0);
      case "remaining_company": return financialNumber(Math.max(0,Number(r.customer_outstanding_gross??r.remaining_with_company??0)));
      case "profit": return financialNumber(r.trip_profit);
      case "commission": return financialNumber(r.commission_paid_net??0);
      case "invoice_no": return String(r.invoice_no??"");
      case "supplier_invoice_no": return String(r.supplier_invoice_no??"");
      case "sale_type": return String(r.sale_type??"");
      default:return "";
    }
  };

  const tripDataGridKeys=["trip_no","trip_date","truck_type","job_no","from","to","charge"] as const;
  const vehicleDriverGridKeys=["driver","plate","owner","driver_pay","driver_paid","driver_balance"] as const;
  const supplierGridKeys=["supplier_invoice_no","rent_driver","supplier_charges","supplier_paid","supplier_balance","payment_date","amount","supplier_credit"] as const;
  const customerGridKeys=["invoice_no","company","company_rate","received_company","remaining_company","sale_type","customer_credit"] as const;
  const pprGridKeys=["paper_received_by"] as const;
  const profitCommissionGridKeys=["commission","profit"] as const;
  const isSupplierGridKey=(key:string)=>(supplierGridKeys as readonly string[]).includes(key);
  const isCustomerGridKey=(key:string)=>(customerGridKeys as readonly string[]).includes(key);
  const isPprGridKey=(key:string)=>(pprGridKeys as readonly string[]).includes(key);
  const visualGridGroup=(key:string)=>isCustomerGridKey(key)?"customer":isSupplierGridKey(key)?"supplier":isPprGridKey(key)?"ppr":"trip";

  const gridColumns:ReadonlyArray<readonly [string,string]>=[
    ["trip_no","Trip No"],
    ["trip_date","Date"],
    ["truck_type","Truck Type"],
    ["job_no","PO/DO/Job No."],
    ["invoice_no","Customer Invoice"],
    ["company","Customer"],
    ["driver","Driver"],
    ["plate","Vehicle No."],
    ["owner","Vehicle Owner"],
    ["from","From"],
    ["to","To"],
    ["sale_type","Sale Type"],
    ["driver_pay","Driver Pay"],
    ["driver_paid","Driver Paid"],
    ["driver_balance","Driver Balance"],
    ["charge","Customer Charges"],
    ["company_rate","Customer Rate (Net)"],
    ["received_company","Collection (Incl. VAT)"],
    ["remaining_company","Customer Balance (Incl. VAT)"],
    ["customer_credit","Customer Credit / Advance"],
    ["supplier_invoice_no","Supplier Invoice"],
    ["supplier_charges","Supplier Charges"],
    ["rent_driver","Supplier Rent (Net)"],
    ["supplier_paid","Supplier Rent Paid (Net)"],
    ["supplier_balance","Supplier Balance (Incl. VAT)"],
    ["payment_date","Supplier Payment Date"],
    ["amount","Supplier Payment Amount"],
    ["supplier_credit","Supplier Credit / Advance"],
    ["commission","Trip Commission Paid"],
    ["profit","Trip Profit"],
    ["paper_received_by","PPR Received By"]
  ] as const;
  const defaultTripColumnOrder=gridColumns.map(column=>column[0]);
  const legacyTripGridStorageKey=`navilo:transport:trip-grid:${user?.id??"user"}:${activeCompany?.company_id??"company"}:${activeBusinessUnit?.business_unit_id??"unit"}`;
  const tripGridStorageKey=`navilo:transport:trip-grid:v2:${user?.id??"user"}:${activeCompany?.company_id??"company"}:${activeBusinessUnit?.business_unit_id??"unit"}`;
  const tripThemeStorageKey=`navilo:transport:trip-theme:${user?.id??"user"}:${activeCompany?.company_id??"company"}:${activeBusinessUnit?.business_unit_id??"unit"}`;
  const [tripTheme,setTripTheme]=useState<'theme1'|'theme2'|'theme3'>(()=>{try{const saved=localStorage.getItem(tripThemeStorageKey);return saved==='theme2'||saved==='theme3'?saved:'theme1'}catch{return 'theme1'}});
  useEffect(()=>{try{const saved=localStorage.getItem(tripThemeStorageKey);setTripTheme(saved==='theme2'||saved==='theme3'?saved:'theme1')}catch{setTripTheme('theme1')}},[tripThemeStorageKey]);
  const chooseTripTheme=(next:'theme1'|'theme2'|'theme3')=>{setTripTheme(next);try{localStorage.setItem(tripThemeStorageKey,next)}catch{/* browser storage may be unavailable */}};
  const allOrderedGridColumns=useMemo(()=>{
    const byKey=new Map(gridColumns.map(column=>[column[0],column] as const));
    const order=tripColumnOrder.length?tripColumnOrder:gridColumns.map(column=>column[0]);
    const arranged=order.map(key=>byKey.get(key)).filter((column):column is readonly [string,string]=>Boolean(column));
    for(const column of gridColumns){
      if(arranged.some(item=>item[0]===column[0]))continue;
      if(column[0]==='supplier_invoice_no'){
        const before=arranged.findIndex(item=>item[0]==='supplier_charges'||item[0]==='rent_driver');
        if(before>=0){arranged.splice(before,0,column);continue;}
      }
      arranged.push(column);
    }
    return arranged;
  },[tripColumnOrder]);
  const readCustomer=registerMeta.permissions?.customer===true;
  const readSupplier=registerMeta.permissions?.supplier===true;
  const columnAuthorized=(key:string)=>key==='profit'?readCustomer&&readSupplier:
    ['charge','company_rate','received_company','remaining_company','customer_credit','invoice_no','sale_type','invoiced'].includes(key)?readCustomer:
    ['owner','supplier_invoice_no','rent_driver','supplier_paid','supplier_balance','supplier_credit','payment_date','amount','driver_pay','driver_paid','driver_balance','commission'].includes(key)?readSupplier:true;
  const orderedGridColumns=allOrderedGridColumns.filter(column=>columnAuthorized(column[0])&&!hiddenTripColumns.includes(column[0]));
  const gridGroupSegments=orderedGridColumns.reduce<Array<{group:string;count:number}>>((segments,[key])=>{
    const group=visualGridGroup(key);
    const last=segments[segments.length-1];
    if(last?.group===group)last.count+=1;else segments.push({group,count:1});
    return segments;
  },[]);
  const [exportProgress,setExportProgress]=useState('');
  const exportRequest=useRef<AbortController|null>(null);
  useEffect(()=>{
    const handle=(event:Event)=>{const format=(event as CustomEvent<{format:string}>).detail?.format;if(!['excel','csv','word','pdf'].includes(format)||tab!=='trips'||showPartyReports||exportRequest.current)return;
      const controller=new AbortController();exportRequest.current=controller;const savedScope=scopeKey;const columns=[...orderedGridColumns];const filters=JSON.parse(JSON.stringify({...registerFilters,snapshot:'true'}));const sort=sortColumn,direction=sortDirection;
      setExportProgress('Preparing all filtered Trips…');
      void (async()=>{try{
        const {rows,totals}=await collectRegisterExport(async offset=>{if(scopeRef.current!==savedScope)throw new Error('Workspace changed. Export cancelled.');const r=await supabase.rpc('transport_register_query',{p_limit:500,p_offset:offset,p_filters:filters,p_sort:sort,p_direction:direction}).abortSignal(controller.signal);if(r.error)throw r.error;return r.data},controller.signal,(loaded,count)=>setExportProgress(`Export ${loaded.toLocaleString()} / ${count.toLocaleString()} Trips`));
        if(scopeRef.current!==savedScope)throw new Error('Workspace changed. Export cancelled.');
        const matrix:ExportMatrix=[columns.map(c=>c[1]),...rows.map(r=>columns.map(([key])=>tripCellValue({...r,truck_type:r.truck_type_name??r.truck_type} as Trip,key))),columns.map(([key],i)=>i===0?'TOTAL · full filter':key in totals?financialNumber(totals[key]):'')];
        const name='navilo-transport-trips';if(format==='excel')exportMatrixToExcel(name,matrix);else if(format==='csv')exportMatrixToCSV(name,matrix);else if(format==='word')exportMatrixToWord(name,matrix,'Transport Trips');else exportPackageToPDF(name,{title:'Transport Trips',sheets:[{name:'All filtered Trips',rows:matrix}]});
      }catch(e:any){if(e?.name!=='AbortError')setError(e?.message||'Export failed.');}finally{if(exportRequest.current===controller){exportRequest.current=null;setExportProgress('');}}})();
    };
    window.addEventListener('navilo:transport-export',handle);return()=>{window.removeEventListener('navilo:transport-export',handle)};
  },[registerKey,tab,showPartyReports,JSON.stringify(orderedGridColumns)]);
  useEffect(()=>()=>{exportRequest.current?.abort()},[scopeKey]);

  useEffect(()=>{
    try{
      const saved=localStorage.getItem(tripGridStorageKey)??localStorage.getItem(legacyTripGridStorageKey);
      if(!saved){setTripColumnOrder([...defaultTripColumnOrder]);setHiddenTripColumns([]);setTripColumnWidths({});return;}
      const parsed=JSON.parse(saved);
      setTripColumnOrder(Array.isArray(parsed.order)?parsed.order:[]);
      setHiddenTripColumns(Array.isArray(parsed.hidden)?parsed.hidden:[]);
      setTripColumnWidths(parsed.widths&&typeof parsed.widths==="object"?parsed.widths:{});
    }catch{
      setTripColumnOrder([...defaultTripColumnOrder]);
      setHiddenTripColumns([]);
      setTripColumnWidths({});
    }
  },[tripGridStorageKey]);

  const tripDataVisible=tripDataGridKeys.some(key=>!hiddenTripColumns.includes(key));
  const vehicleDriverDataVisible=vehicleDriverGridKeys.some(key=>!hiddenTripColumns.includes(key));
  const supplierDataVisible=supplierGridKeys.some(key=>!hiddenTripColumns.includes(key));
  const customerDataVisible=customerGridKeys.some(key=>!hiddenTripColumns.includes(key));
  const pprDataVisible=pprGridKeys.some(key=>!hiddenTripColumns.includes(key));
  const profitCommissionDataVisible=profitCommissionGridKeys.some(key=>!hiddenTripColumns.includes(key));
  const setGridGroupVisible=(keys:readonly string[],show:boolean)=>{
    setHiddenTripColumns(current=>show
      ?current.filter(key=>!keys.includes(key))
      :Array.from(new Set([...current,...keys])));
  };

  const saveTripGridLayout=()=>{
    localStorage.setItem(tripGridStorageKey,JSON.stringify({
      order:tripColumnOrder.length?tripColumnOrder:defaultTripColumnOrder,
      hidden:hiddenTripColumns,
      widths:tripColumnWidths
    }));
    setShowTripColumnSetup(false);
  };

  const resetTripGridLayout=()=>{
    localStorage.removeItem(tripGridStorageKey);
    setTripColumnOrder([...defaultTripColumnOrder]);
    setHiddenTripColumns([]);
    setTripColumnWidths({});
  };

  const moveTripColumn=(dragKey:string,targetKey:string)=>{
    if(dragKey===targetKey)return;
    setTripColumnOrder(current=>{
      const base=current.length?current:[...gridColumns.map(column=>column[0])];
      const next=base.filter(key=>key!==dragKey);
      const targetIndex=next.indexOf(targetKey);
      next.splice(targetIndex<0?next.length:targetIndex,0,dragKey);
      return next;
    });
  };

  const [columnValues,setColumnValues]=useState<string[]>([]);
  const [columnSearch,setColumnSearch]=useState('');
  const [columnValuesLoading,setColumnValuesLoading]=useState(false);
  useEffect(()=>{setColumnSearch('');},[openColumnFilter]);
  useEffect(()=>{
    let live=true;
    columnOptionsRequest.current?.abort();
    columnOptionsRequest.current=null;
    setColumnValues([]);
    if(!openColumnFilter){setColumnValuesLoading(false);return;}
    setColumnValuesLoading(true);
    const timer=window.setTimeout(()=>{
      const controller=new AbortController();
      columnOptionsRequest.current=controller;
      void (async()=>{
        try{
          const r=await supabase.rpc('transport_register_query',{p_filters:registerFilters,p_option_key:openColumnFilter,p_option_search:columnSearch}).abortSignal(controller.signal);
          if(!live||controller.signal.aborted)return;
          if(r.error){setError(r.error.message);return;}
          setColumnValues(r.data.options??[]);
        }catch(e:any){
          if(live&&!controller.signal.aborted)setError(e?.message||'Unable to load filter values.');
        }finally{
          if(columnOptionsRequest.current===controller)columnOptionsRequest.current=null;
          if(live&&!controller.signal.aborted)setColumnValuesLoading(false);
        }
      })();
    },300);
    return()=>{
      live=false;
      window.clearTimeout(timer);
      columnOptionsRequest.current?.abort();
      columnOptionsRequest.current=null;
    };
  },[openColumnFilter,columnSearch,registerKey]);
  const columnOptions=(_key:string)=>columnValues;
  const gridRows=rows;
  const amountGridKeys=new Set(['charge','rent_driver','supplier_charges','supplier_paid','supplier_balance','supplier_credit','driver_pay','driver_paid','driver_balance','amount','company_rate','received_company','remaining_company','customer_credit','profit','commission']);
  const gridTotal=(key:string)=>Number(registerMeta.totals?.[key]??0);

  const toggleColumnValue=(key:string,value:string)=>{
    setColumnFilters(current=>{
      const selected=current[key]??[];
      const next=selected.includes(value)
        ? selected.filter(v=>v!==value)
        : [...selected,value];

      return {...current,[key]:next};
    });
  };

  const clearColumnFilter=(key:string)=>{
    setColumnFilters(current=>({...current,[key]:[]}));
  };

  const resetGrid=()=>{
    resetFilters();
    setColumnFilters({});
    setSortColumn("");
    setSortDirection("asc");
    setOpenColumnFilter(null);
    if(tripsGridRef.current)tripsGridRef.current.scrollLeft=0;
  };

  return <div className={standaloneMobile?"relative min-h-dvh w-full max-w-none bg-slate-100":"relative w-full max-w-none space-y-1"} style={{width:"100%",maxWidth:"none",marginInline:0}}>


    {chargeTrip&&<TransportTripCharges tripId={chargeTrip.id} onClose={()=>setChargeTrip(null)} onChanged={load}/>}
    {supplierChargeTarget&&<TransportSupplierCharges rentId={supplierChargeTarget.rentId} tripNo={supplierChargeTarget.tripNo} onClose={()=>setSupplierChargeTarget(null)} onChanged={load}/>} 

    {showPartyReports&&<TransportPartyReports key={`${scopeKey}:${reportPanel}`} initialSide={reportPanel==='supplier-reports'?'supplier':'customer'} allocationEntry={reportPanel==='bulk-allocation'} onClose={()=>setTab('trips')} onChanged={load}/>}

    {error&&<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

    {!showPartyReports&&tab==="trips"&&<section ref={tripsSectionRef} data-navilo-transport-register="true" className={`relative isolate flex h-[calc(100dvh-100px)] min-h-[360px] flex-col overflow-hidden bg-white ${tripTheme==='theme3'?'rounded-xl border border-slate-200 shadow-[0_10px_30px_rgba(15,23,42,0.10)] [&_tbody_tr:nth-child(even)>td]:bg-slate-50/70 [&_tbody_tr:hover>td]:bg-emerald-50/70':tripTheme==='theme2'?'rounded-md border border-slate-300 shadow-[0_1px_4px_rgba(15,23,42,0.08)]':'rounded-lg border border-slate-700 shadow-sm shadow-slate-300'}`} data-navilo-theme={tripTheme} data-navilo-customizable="true">
      <div className={`relative z-[90] flex shrink-0 items-center justify-between px-3 text-white ${tripTheme==='theme3'?'h-10 bg-gradient-to-r from-[#111827] via-[#16302b] to-[#0f3d34]':tripTheme==='theme2'?'h-9 bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950':'h-10 bg-gradient-to-r from-slate-950 via-[#071b3a] to-[#0a2855]'}`}>
        <div className="flex items-center gap-2"><span className="text-[13px] font-extrabold tracking-tight">Transport</span><span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Trips Register</span></div>
        <div className="flex items-center gap-1">
          <div className="mr-1 inline-flex h-7 items-center rounded-md border border-white/20 bg-black/20 p-0.5" aria-label="Trips Register theme">
            <button type="button" aria-pressed={tripTheme==='theme1'} onClick={()=>chooseTripTheme('theme1')} className={`h-6 rounded px-2 text-[9px] font-bold ${tripTheme==='theme1'?'bg-white text-slate-950 shadow-sm':'text-slate-300 hover:bg-white/10 hover:text-white'}`}>Theme 1</button>
            <button type="button" aria-pressed={tripTheme==='theme2'} onClick={()=>chooseTripTheme('theme2')} className={`h-6 rounded px-2 text-[9px] font-bold ${tripTheme==='theme2'?'bg-blue-500 text-white shadow-sm':'text-slate-300 hover:bg-white/10 hover:text-white'}`}>Theme 2</button>
            <button type="button" aria-pressed={tripTheme==='theme3'} onClick={()=>chooseTripTheme('theme3')} className={`h-6 rounded px-2 text-[9px] font-bold ${tripTheme==='theme3'?'bg-emerald-500 text-white shadow-sm':'text-slate-300 hover:bg-white/10 hover:text-white'}`}>Theme 3</button>
          </div>
          <button type="button" onClick={resetGrid} className={`flex h-7 items-center rounded-md px-2.5 text-[10px] font-semibold text-white ${tripTheme==='theme3'?'border border-emerald-600 bg-emerald-900/80 hover:bg-emerald-800':'border border-slate-500 bg-slate-900/70 hover:bg-slate-800'}`}>Reset</button>
          <button type="button" onClick={()=>void load()} disabled={registerLoading} className={`flex h-7 items-center gap-1 rounded-md px-2.5 text-[10px] font-semibold text-white ${tripTheme==='theme3'?'border border-emerald-400 bg-emerald-600 hover:bg-emerald-500':'border border-blue-500 bg-blue-600 hover:bg-blue-700'}`}><RefreshCw className="h-3 w-3"/>Refresh</button>
          <button type="button" onClick={()=>setShowTripColumnSetup(v=>!v)} className={`flex h-7 items-center rounded-md px-2.5 text-[10px] font-semibold text-white ${tripTheme==='theme3'?'border border-emerald-600 bg-emerald-900/80 hover:bg-emerald-800':'border border-slate-500 bg-slate-900/70 hover:bg-slate-800'}`}>Columns</button>
          <span data-navilo-standard-tools-host="true" className="contents" />
        </div>
      </div>
      <div className={`relative z-[80] shrink-0 border-b border-slate-200 bg-white ${tripTheme==='theme3'?'px-2.5 py-1.5':tripTheme==='theme2'?'px-1.5 py-1':'px-2 py-2'}`}>
        <div className={`navilo-transport-register-toolbar flex flex-wrap items-center ${tripTheme==='theme3'?'gap-2':tripTheme==='theme2'?'gap-1.5':'gap-2'}`}>

          <div className={`flex items-center justify-between border border-blue-200 bg-blue-50 ${tripTheme==='theme3'?'h-8 min-w-[96px] rounded-lg border-emerald-200 bg-emerald-50 px-2.5 shadow-sm':tripTheme==='theme2'?'h-7 min-w-[86px] rounded-md px-2':'h-9 min-w-[104px] rounded-lg px-3 shadow-sm'}`}>
            <span className="text-[10px] font-extrabold uppercase text-blue-700">🚚 Trips</span>
            <span className="text-sm font-bold text-slate-950">{Number(registerMeta.count??0).toLocaleString()}</span>
          </div>

          <div className={`flex items-center gap-2 border border-slate-200 bg-slate-50 ${tripTheme==='theme3'?'h-8 min-w-[200px] rounded-lg border-slate-200 bg-white px-2.5 shadow-sm':tripTheme==='theme2'?'h-7 min-w-[180px] rounded-md px-2':'h-9 min-w-[215px] rounded-lg px-3 shadow-sm'}`}>
            <span className="text-[10px] font-extrabold uppercase text-slate-700">▣ Paper</span>
            <span className="text-[9px] font-semibold text-emerald-700">Received <b>{Number(dashboardSummary.paper?.received??0).toLocaleString()}</b></span>
            <span className="text-[9px] font-semibold text-amber-700">Not Received <b>{Number(dashboardSummary.paper?.not_received??0).toLocaleString()}</b></span>
          </div>

          <div className="relative">
            <button type="button" onClick={()=>setStatusOpen(v=>!v)} className={`flex items-center justify-between gap-2 border border-slate-200 bg-white text-[10px] font-semibold text-slate-700 ${tripTheme==='theme3'?'h-8 min-w-[195px] rounded-lg border-emerald-200 bg-emerald-50/40 px-2.5 shadow-sm':tripTheme==='theme2'?'h-7 min-w-[190px] rounded-md px-2':'h-9 min-w-[200px] rounded-lg px-3 shadow-sm'}`}>
              <span>Status</span><span className="max-w-[135px] truncate text-slate-900">{statusFilters.length===0?"All Statuses":statusFilters.length===1?<> <span className={statusMark(statusFilters[0].replace(/^status:/,'')).className}>{statusMark(statusFilters[0].replace(/^status:/,'')).mark}</span> {statusOptions.find(option=>option.key===statusFilters[0])?.label??"1 selected"}</>:`${statusFilters.length} selected`}</span>
              <span aria-hidden>⌄</span>
            </button>
            {statusOpen&&<div className="absolute left-0 top-8 z-[100] w-[240px] overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xl">
              <div className="border-b border-slate-100 p-1.5">
                <input autoFocus className="input h-7 w-full px-2 text-[11px]" placeholder="Search status..." value={statusSearch} onChange={e=>setStatusSearch(e.target.value)}/>
              </div>
              <div className="max-h-44 overflow-y-auto p-1">
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[10px] font-semibold hover:bg-slate-50">
                  <input type="checkbox" checked={statusFilters.length===0} onChange={()=>setStatusFilters([])}/>
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-2"><span>All Statuses</span><span className="tabular-nums text-slate-500">{Number(registerMeta.count??0).toLocaleString()}</span></span>
                </label>
                {visibleStatusOptions.map(option=><label key={option.key} className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[10px] hover:bg-slate-50 ${statusFilters.includes(option.key)?"bg-blue-50 font-bold text-blue-800":""}`}>
                  <input type="checkbox" checked={statusFilters.includes(option.key)} onChange={()=>setStatusFilters(current=>current.includes(option.key)?current.filter(key=>key!==option.key):[...current,option.key])}/>
                  <span className="flex min-w-0 flex-1 items-start justify-between gap-2"><span className="flex min-w-0 items-start gap-1.5"><span title={statusMark(String(option.key).replace(/^status:/,'')).title} className={`mt-px inline-flex w-3 shrink-0 justify-center text-[11px] font-bold ${statusMark(String(option.key).replace(/^status:/,'')).className}`}>{statusMark(String(option.key).replace(/^status:/,'')).mark}</span><span className="min-w-0"><span className="block">{option.label}</span><span className="block text-[8px] font-normal leading-tight text-slate-500">{statusNarration(option)}</span></span></span><span className="shrink-0 tabular-nums text-[10px] font-bold text-slate-600">{Number(option.count??0).toLocaleString()}</span></span>
                </label>)}
                {visibleStatusOptions.length===0&&<div className="px-2 py-2 text-[10px] text-slate-500">No matching status</div>}
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-2 py-1">
                <button type="button" className="text-[9px] font-semibold text-slate-600 hover:text-slate-900" onClick={()=>setStatusFilters([])}>Clear</button>
                <button type="button" className="rounded bg-slate-900 px-2 py-1 text-[9px] font-semibold text-white" onClick={()=>{setStatusSearch("");setStatusOpen(false)}}>Done</button>
              </div>
            </div>}
          </div>

          <form className={`flex w-80 items-stretch ${tripTheme==='theme3'?'h-8':tripTheme==='theme2'?'h-7':'h-9'}`} onSubmit={e=>{e.preventDefault();setPage(0);setRegisterSearch(registerSearchDraft.trim())}}>
            <input aria-label="Search all Trip data" placeholder="Search all Trip data…" className={`input min-w-0 flex-1 rounded-r-none text-[11px] ${tripTheme==='theme3'?'h-8 rounded-l-lg border-emerald-200 bg-emerald-50/20 shadow-sm':tripTheme==='theme2'?'h-7 rounded-l-md':'h-9 rounded-l-lg border-slate-200 shadow-sm'}`} value={registerSearchDraft} onChange={e=>setRegisterSearchDraft(e.target.value)}/>
            <button type="submit" aria-label="Search Trips" className={`flex items-center justify-center border border-l-0 border-blue-300 bg-white text-blue-700 hover:bg-blue-50 ${tripTheme==='theme3'?'h-8 w-9 rounded-r-lg border-emerald-300 bg-emerald-50 text-emerald-800 shadow-sm':tripTheme==='theme2'?'h-7 w-8 rounded-r-md':'h-9 w-9 rounded-r-lg shadow-sm'}`}><Search className="h-3.5 w-3.5"/></button>
          </form>
          <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={()=>{entryReturnTab.current="trips";setEditingTripId(null);setTab("new")}} className="flex h-9 items-center gap-1 rounded-lg border border-blue-500 bg-blue-600 px-3 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-700"><Plus className="h-3.5 w-3.5"/>Add Trip</button>
          </div>
          <button type="button" onClick={()=>navigate("/accounting/cash-counter?mode=supplier&allocation=transport")} className="h-9 rounded-lg border border-amber-300 bg-amber-50 px-3 text-[11px] font-semibold text-amber-900 shadow-sm hover:bg-amber-100">Pay Rent to Suppliers</button>
          <button type="button" onClick={()=>navigate("/accounting/cash-counter?mode=customer&allocation=transport")} className="h-9 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-[11px] font-semibold text-emerald-800 shadow-sm hover:bg-emerald-100">Receive Customer Payment</button>

        </div>

        {showTripColumnSetup&&<div className="mb-1 rounded-md border border-slate-200 bg-slate-50 p-1.5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-slate-700">Trip columns — drag to reorder, tick to show</span>
            <div className="flex gap-1">
              <button type="button" onClick={resetTripGridLayout} className="h-5 rounded border bg-white px-2 text-[9px] font-semibold">Reset Default</button>
              <button type="button" onClick={saveTripGridLayout} className="h-5 rounded border border-blue-200 bg-blue-50 px-2 text-[9px] font-semibold text-blue-700">Save as Default</button>
            </div>
          </div>
          <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-slate-300 bg-white px-2 py-1">
            <label className="inline-flex cursor-pointer items-center gap-1 text-[9px] font-bold text-slate-800">
              <input type="checkbox" checked={tripDataVisible} onChange={e=>setGridGroupVisible(tripDataGridKeys,e.target.checked)}/>
              Show Trip Data
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1 text-[9px] font-bold text-violet-800">
              <input type="checkbox" checked={vehicleDriverDataVisible} onChange={e=>setGridGroupVisible(vehicleDriverGridKeys,e.target.checked)}/>
              Show Vehicle & Driver
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1 text-[9px] font-bold text-amber-800">
              <input type="checkbox" checked={supplierDataVisible} onChange={e=>setGridGroupVisible(supplierGridKeys,e.target.checked)}/>
              Show Supplier Data
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1 text-[9px] font-bold text-blue-800">
              <input type="checkbox" checked={customerDataVisible} onChange={e=>setGridGroupVisible(customerGridKeys,e.target.checked)}/>
              Show Customer Data
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1 text-[9px] font-bold text-teal-800">
              <input type="checkbox" checked={pprDataVisible} onChange={e=>setGridGroupVisible(pprGridKeys,e.target.checked)}/>
              Show PPR Data
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1 text-[9px] font-bold text-emerald-800">
              <input type="checkbox" checked={profitCommissionDataVisible} onChange={e=>setGridGroupVisible(profitCommissionGridKeys,e.target.checked)}/>
              Show Profit & Commission
            </label>
            <span className="text-[9px] text-slate-500">Toggle a group or tick individual columns below.</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {allOrderedGridColumns.map(([key])=>{
              const column=gridColumns.find(item=>item[0]===key);
              if(!column)return null;
              return <div key={key} draggable
                onDragStart={()=>{tripColumnDragKey.current=key}}
                onDragOver={e=>e.preventDefault()}
                onDrop={()=>{if(tripColumnDragKey.current)moveTripColumn(tripColumnDragKey.current,key);tripColumnDragKey.current=null}}
                className="flex cursor-grab items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-[9px] text-slate-700">
                <span className="text-slate-400">⋮⋮</span>
                <input type="checkbox" checked={!hiddenTripColumns.includes(key)}
                  onChange={()=>setHiddenTripColumns(current=>current.includes(key)?current.filter(item=>item!==key):[...current,key])}/>
                <span>{column[1]}</span>
              </div>;
            })}
          </div>
        </div>}

        <div className="flex h-4 items-center justify-end text-[9px] font-bold text-slate-700">
          {gridRows.length.toLocaleString()} shown / {Number(registerMeta.count??0).toLocaleString()} filtered trips
        </div>
      </div>
      {exportProgress&&<div role="status" className="flex items-center gap-2 text-xs"><span>{exportProgress}</span><button className="btn" onClick={()=>exportRequest.current?.abort()}>Cancel export</button></div>}{registerLoading&&<p role="status" className="shrink-0 px-2 text-[11px] text-blue-700">Loading filtered totals and page…</p>}
      <div
        ref={tripsGridRef}
        className={`navilo-transport-trips-scrollport min-h-0 flex-1 overscroll-contain overflow-auto border-t ${tripTheme==='theme3'?'border-emerald-800 bg-[#f7faf9]':tripTheme==='theme2'?'border-blue-300 bg-slate-50':'border-slate-400 bg-white'}`}
      >
        <table className={`w-max min-w-full table-auto whitespace-nowrap leading-none ${tripTheme==='theme3'?'text-[10.5px]':tripTheme==='theme2'?'text-[10px]':'text-[10.5px]'}`}>
          <caption className="sr-only">Trips register. Summary filters and column headers remain fixed while trip rows scroll.</caption>
          <thead className={`sticky top-0 z-40 text-left uppercase tracking-normal shadow-[0_1px_2px_rgba(15,23,42,0.12)] ${tripTheme==='theme3'?'bg-[#102a25] text-[10.5px] text-white':tripTheme==='theme2'?'bg-slate-950 text-[10px] text-white':'bg-slate-900 text-[10.5px] text-white'}`}>
            <tr className={tripTheme==='theme3'?'h-10':tripTheme==='theme2'?'h-9':'h-11'}>
              {gridGroupSegments.map((segment,index)=><th key={segment.group+index} colSpan={segment.count}
                className={`border-b border-r px-3 py-0 text-center font-black tracking-[0.025em] ${tripTheme==='theme3'?'text-[12px]':tripTheme==='theme2'?'text-[11px]':'text-[13px]'} ${segment.group==="supplier"?(tripTheme==='theme3'?"border-orange-200 bg-orange-50 text-orange-900":tripTheme==='theme2'?"border-amber-300 bg-amber-50 text-amber-900":"border-rose-300 bg-rose-100 text-rose-800"):segment.group==="customer"?(tripTheme==='theme3'?"border-emerald-200 bg-emerald-50 text-emerald-900":tripTheme==='theme2'?"border-sky-300 bg-sky-50 text-sky-900":"border-blue-300 bg-blue-100 text-blue-800"):segment.group==="ppr"?"border-emerald-300 bg-emerald-100 text-emerald-800":(tripTheme==='theme3'?"border-slate-200 bg-slate-100 text-slate-900":tripTheme==='theme2'?"border-slate-300 bg-slate-50 text-slate-900":"border-slate-300 bg-slate-100 text-slate-800")}`}>
                <span className="inline-flex items-center justify-center gap-2 whitespace-nowrap">
                  <span aria-hidden="true" className="text-[17px] leading-none">{segment.group==="supplier"?"🚚":segment.group==="customer"?"👤":segment.group==="ppr"?"📄":"🚚"}</span>
                  <span>{segment.group==="supplier"?"SUPPLIER · OUR COST":segment.group==="customer"?"CUSTOMER · OUR REVENUE":segment.group==="ppr"?"PPR":"TRIP DETAILS"}</span>
                </span>
              </th>)}
            </tr>
            <tr>
              {orderedGridColumns.map(([key,label],i)=>{
                const active=(columnFilters[key]?.length??0)>0;
                const sorted=sortColumn===key;
                const requestedWidth=tripColumnWidths[key]??compactTripColumnWidths[key]??60;
                const totalText=amountGridKeys.has(key)?financialNumber(gridTotal(key)):null;
                const columnWidth=Math.max(requestedWidth,totalText?totalText.length*7+18:0,amountGridKeys.has(key)?96:52);

                return <th key={key} aria-sort={sorted?(sortDirection==="asc"?"ascending":"descending"):undefined}
                  style={columnWidth?{width:columnWidth,minWidth:columnWidth,maxWidth:columnWidth}:undefined}
                  className={`sticky top-0 border-b border-r px-0.5 !py-0 font-bold leading-none ${tripTheme==='theme3'?(isSupplierGridKey(key)?"border-orange-700 bg-[#7c2d12] text-white":isCustomerGridKey(key)?"border-emerald-800 bg-[#065f46] text-white":isPprGridKey(key)?"border-teal-800 bg-[#115e59] text-white":"border-slate-700 bg-[#1f2937] text-white"):tripTheme==='theme2'?(isSupplierGridKey(key)?"border-amber-200 bg-amber-100 text-amber-950":isCustomerGridKey(key)?"border-sky-200 bg-sky-100 text-sky-950":isPprGridKey(key)?"border-emerald-200 bg-emerald-100 text-emerald-950":"border-slate-200 bg-slate-100 text-slate-800"):(isSupplierGridKey(key)?"border-rose-200 bg-rose-50 text-slate-800":isCustomerGridKey(key)?"border-blue-200 bg-blue-50 text-slate-800":isPprGridKey(key)?"border-emerald-200 bg-emerald-50 text-slate-800":"border-slate-300 bg-white text-slate-700")} ${i===0?"!sticky left-0 top-0 z-[60] shadow-[2px_0_3px_rgba(15,23,42,0.10)]":"z-40"}`}>
                  <div className="flex min-h-[28px] w-full min-w-0 items-center gap-0.5">
                    <button type="button"
                      title={`Sort ${label} ${sorted&&sortDirection==="asc"?"descending":"ascending"}`}
                      onClick={()=>{
                        if(sorted){setSortDirection(d=>d==="asc"?"desc":"asc");}
                        else{setSortColumn(key);setSortDirection("asc");}
                        setOpenColumnFilter(null);
                      }}
                      className={`flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden rounded px-0.5 py-0 text-left leading-none hover:bg-slate-200 ${sorted?"text-blue-700":""}`}>
                      <span className="min-w-0 py-0.5" style={{lineHeight:1.2}}>
                        <span className="block whitespace-normal">{label}</span>
                      </span>
                      {sorted&&<span className="shrink-0 text-[7px]" aria-label={sortDirection==="asc"?"Sorted ascending":"Sorted descending"}>{sortDirection==="asc"?"▲":"▼"}</span>}
                    </button>
                    <button type="button"
                      title={active?"Filter active":"Filter"}
                      aria-label={active?`Filter active for ${label}`:`Filter ${label}`}
                      onClick={e=>{
                        e.stopPropagation();
                        if(openColumnFilter===key){setOpenColumnFilter(null);return;}
                        const rect=e.currentTarget.getBoundingClientRect();
                        const width=240,gap=8;
                        let left=Math.max(gap,rect.right-width);
                        if(left+width>window.innerWidth-gap)left=Math.max(gap,window.innerWidth-width-gap);
                        let top=rect.bottom+4;
                        if(top+270>window.innerHeight-gap)top=Math.max(gap,rect.top-270);
                        setColumnMenuPosition({top,left});
                        setOpenColumnFilter(key);
                      }}
                      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-slate-200 ${active?"text-blue-700":"text-slate-400"}`}>
                      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" aria-hidden="true">
                        <path d="M1.5 2h9L7 6v3L5 10V6L1.5 2Z" fill="currentColor"/>
                      </svg>
                    </button>
                  </div>

                  {totalText!==null&&<div className="pb-1 pr-0.5 text-right text-[11px] font-black leading-none tabular-nums text-slate-950" style={{whiteSpace:"nowrap"}}>{totalText}</div>}

                  <div
                    role="separator"
                    aria-orientation="vertical"
                    title={`Resize ${label}`}
                    onMouseDown={e=>startTripColumnResize(e,key)}
                    className="absolute -right-[2px] top-0 z-40 h-full w-[5px] cursor-col-resize select-none border-r border-slate-400 hover:border-blue-500 hover:bg-blue-100"
                  />

                  {openColumnFilter===key&&
                    <ColumnFilterMenu
                      label={label}
                      top={columnMenuPosition.top}
                      left={columnMenuPosition.left}
                      options={columnOptions(key)}
                      search={columnSearch} onSearch={setColumnSearch} loading={columnValuesLoading}
                      selected={columnFilters[key]??[]}
                      onToggle={value=>toggleColumnValue(key,value)}
                      onSelectAll={()=>
                        setColumnFilters(current=>({
                          ...current,
                          [key]:columnOptions(key)
                        }))
                      }
                      onClear={()=>clearColumnFilter(key)}
                      onClose={()=>setOpenColumnFilter(null)}
                    />
                  }
                </th>
              })}
            </tr>
          </thead>

          <tbody>
            {gridRows.map(r=><tr key={r.id} className={`align-middle transition-colors ${tripTheme==='theme3'?'h-[30px] odd:bg-white even:bg-emerald-50/35 hover:bg-emerald-100/70':tripTheme==='theme2'?'h-[22px] odd:bg-white even:bg-sky-50/55 hover:bg-sky-100/70':'h-[26px] odd:bg-white even:bg-slate-50/45 hover:bg-blue-50/45'}`}>
              <td
                style={tripColumnWidths[orderedGridColumns[0]?.[0]??""]?{width:tripColumnWidths[orderedGridColumns[0]?.[0]??""],minWidth:tripColumnWidths[orderedGridColumns[0]?.[0]??""],maxWidth:tripColumnWidths[orderedGridColumns[0]?.[0]??""]}:undefined}
                className={`!sticky left-0 z-30 overflow-hidden whitespace-nowrap border-b border-r px-1.5 !py-0 font-bold leading-tight shadow-[2px_0_3px_rgba(15,23,42,0.06)] ${tripTheme==='theme3'?'h-[30px] max-h-[30px] border-emerald-200 bg-[#ecfdf5] text-emerald-950':tripTheme==='theme2'?'h-[22px] max-h-[22px] border-sky-200 bg-[#eff6ff] text-slate-900':'h-[26px] max-h-[26px] border-slate-200 bg-white text-slate-900'}`}>
  <button type="button" title="Edit Trip" onClick={()=>void startEditTrip(r)}
    className="font-bold leading-none text-blue-700 underline-offset-2 hover:underline">
    {r.trip_no}
  </button>
  <span title={`Trip status: ${statusMark(r.status).title}`} aria-label={`Trip status ${statusMark(r.status).title}`} className={`ml-0.5 inline-flex h-3 w-3 items-center justify-center align-middle text-[9px] font-bold leading-none ${statusMark(r.status).className}`}>{statusMark(r.status).mark}</span>
</td>

              {/* Transport operational register order - one canonical mapping for display/filter/sort */}
              {orderedGridColumns.slice(1).map(([key])=>{
                const value=tripCellValue(r,key);
                const numeric=["charge","rent_driver","supplier_charges","supplier_paid","supplier_balance","supplier_credit","customer_credit","driver_pay","driver_paid","driver_balance","amount","company_rate","received_company","remaining_company","profit","commission"].includes(key);
                const columnWidth=tripColumnWidths[key];
                return <td key={key}
                  style={columnWidth?{width:columnWidth,minWidth:columnWidth,maxWidth:columnWidth}:undefined}
                  className={`overflow-hidden text-ellipsis whitespace-nowrap border-b border-r px-1.5 !py-0 leading-tight ${tripTheme==='theme3'?(isSupplierGridKey(key)?"h-[30px] max-h-[30px] border-orange-100 bg-orange-50/80":isCustomerGridKey(key)?"h-[30px] max-h-[30px] border-emerald-100 bg-emerald-50/80":isPprGridKey(key)?"h-[30px] max-h-[30px] border-teal-100 bg-teal-50/80":"h-[30px] max-h-[30px] border-slate-200 bg-white/80"):tripTheme==='theme2'?(isSupplierGridKey(key)?"h-[22px] max-h-[22px] border-amber-100 bg-amber-50":isCustomerGridKey(key)?"h-[22px] max-h-[22px] border-sky-100 bg-sky-50":isPprGridKey(key)?"h-[22px] max-h-[22px] border-emerald-100 bg-emerald-50":"h-[22px] max-h-[22px] border-slate-200 bg-white"):(isSupplierGridKey(key)?"h-[26px] max-h-[26px] border-slate-200 bg-rose-50/55":isCustomerGridKey(key)?"h-[26px] max-h-[26px] border-slate-200 bg-blue-50/45":isPprGridKey(key)?"h-[26px] max-h-[26px] border-slate-200 bg-emerald-50/50":"h-[26px] max-h-[26px] border-slate-200")} ${numeric?"text-right font-medium":""}`}>
                  {key==='charge'
                    ?<button type="button" className="h-[22px] w-full cursor-pointer rounded px-1 py-0 text-left text-[10px] font-semibold leading-tight text-blue-700 hover:bg-blue-100" aria-label={`Open Customer Charges ${r.trip_no}`} onClick={()=>setChargeTrip(r)}>{value||''}</button>
                    :key==='supplier_charges'
                    ?<button type="button" className="h-[22px] w-full cursor-pointer rounded px-1 py-0 text-right text-[10px] font-semibold leading-tight text-rose-700 hover:bg-rose-100 focus-visible:outline focus-visible:outline-rose-500" aria-label={`Open Supplier Charges ${r.trip_no}`} onClick={()=>void openSupplierCharges(r)}>{value||''}</button>
                    :key==='company_rate'
                    ?<button type="button"
                      className="h-[22px] w-full cursor-pointer rounded px-1 py-0 text-right text-[10px] font-semibold leading-tight text-blue-700 hover:bg-blue-100 focus-visible:outline focus-visible:outline-blue-500"
                      aria-label={`${r.customer_rate_state==='pending'?'Add':'Open'} Company Rate ${r.trip_no}`}
                      onClick={()=>setInitialRateTrip(r)}>
                      {r.customer_rate_state==='pending'&&!r.customer_rate_locked?'':value||'0.00'}
                    </button>
                    :key==='invoice_no'
                      ?<button type="button"
                        className="h-[22px] w-full cursor-pointer rounded px-1 py-0 text-left text-[10px] font-semibold leading-tight text-blue-700 hover:bg-blue-100 focus-visible:outline focus-visible:outline-blue-500"
                        aria-label={`${r.invoice_no?'Open':'Add'} Invoice Number ${r.trip_no}`}
                        onClick={()=>setInvoiceTrip(r)}>
                        {r.invoice_no||''}
                      </button>
                    :key==='rent_driver'&&r.customer_rate_state!==undefined
                      ?<button type="button" className="h-[22px] w-full cursor-pointer rounded px-1 py-0 text-right text-[10px] font-medium leading-tight text-amber-800 hover:bg-amber-100 focus-visible:outline focus-visible:outline-amber-500" aria-label={`${Number(r.billed_supplier_net??r.supplier_rent??r.owner_rent??0)>0?'Open':'Add'} Rent ${r.trip_no}`} onClick={()=>{setBulkSupplierRentTrip(r);setShowBulkSupplierRent(true)}}>{Number(r.billed_supplier_net??r.supplier_rent??r.owner_rent??0)>0?value:''}</button>
                    :key==='paper_received_by'
                      ?r.ppr_status==='received'
                        ?<span className="inline-flex flex-col items-start leading-tight"><span>{r.ppr_received_by_name||"—"}</span>{r.ppr_received_date&&<span className="text-[8px] text-slate-500">{formatNaviloDate(r.ppr_received_date)}</span>}</span>
                        :<button type="button" onClick={()=>void openQuickPpr(r)} className="h-[22px] rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0 text-[9px] font-semibold leading-tight text-amber-800 hover:bg-amber-100">Receive PPR</button>
                      :value||""}
                </td>;
              })}            </tr>)}
          </tbody>
        </table>
      </div>

      
      <TransportHorizontalScroll gridRef={tripsGridRef} revision={registerKey+String(page)+hiddenTripColumns.join()+JSON.stringify(tripColumnWidths)}/>
      <TransportPagination page={page} pageSize={500} count={Number(registerMeta.count??0)} busy={registerLoading} onPage={setPage}/>
      <p className="shrink-0 border-t border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-600">Header totals cover all filtered Trips, across every page.</p>
      {!registerLoading&&!visible.length&&<div className="p-10 text-center text-sm text-slate-500">No trips found.</div>}
    </section>}

    {!showPartyReports&&tab==="new"&&
<section className={standaloneMobile?"min-h-dvh border-0 bg-white shadow-none":"rounded-xl border border-slate-200 bg-white shadow-sm"}>

  <div className="border-b border-slate-200">
    <div className="px-4 pb-2 pt-3">
      {standaloneMobile&&<button type="button" onClick={()=>{setError("");setEditingTripId(null);setEditingTripNo("");setEditingOriginalAssignment({vehicle_id:"",driver_id:""});setTab("mobile")}} className="mb-2 inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700">← Recent Trips</button>}
      <h2 className="font-bold text-slate-950">
        {editingTripId?<span className="inline-flex items-center gap-1.5">Edit Trip - {editingTripNo}{editingTripLocked&&<span title="Locked: customer and supplier financial sides are posted. Normal Trip editing is disabled; use controlled correction." className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"><LockKeyhole className="h-3 w-3"/>Locked</span>}</span>:"New Trip"}
      </h2>

      {standaloneMobile&&currentVoiceDraftId&&<div className="mb-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900"><strong>Voice draft ready.</strong> Check the matched Customer, Vehicle, Driver, route and amounts, then tap Create Trip. If anything was not recognized, select it manually.</div>}
      <p className="text-xs text-slate-500">
        {editingTripLocked?"Locked Trip is read-only. Use the controlled correction / reversal workflow for later changes.":editingTripId?"Trip No and Trip Date are permanent. Posted financial fields stay protected.":"Trip number is generated automatically by NAVILO."}
      </p>
    </div>

    {!editingTripId&&!standaloneMobile&&<div className="flex items-center gap-1 px-4 pb-3">
      <button
        type="button"
        onClick={()=>setNewTripMode("single")}
        className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${newTripMode==="single"?"border-slate-300 bg-slate-900 text-white shadow-sm":"border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}
      >
        Single Trip
      </button>

      <button
        type="button"
        data-navilo-keep-local-action="true"
        onClick={()=>setNewTripMode("bulk")}
        className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${newTripMode==="bulk"?"border-slate-300 bg-slate-900 text-white shadow-sm":"border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}
      >
        Bulk Upload
      </button>
      <button type="button" className={`btn ${newTripMode==='historical'?'bg-slate-900 text-white':''}`} onClick={()=>setNewTripMode('historical')}>One-time Historical Import</button>
    </div>}
  </div>


  {!standaloneMobile&&newTripMode==='historical'&&<TransportHistoricalImport key={importScope} validateMasters={rows=>validateBulkMasters(rows,true)} onChanged={load}/>}

  {newTripMode==="single"&&
  <div className={standaloneMobile?"transport-mobile-trip-form px-3 pb-8 pt-3":"p-3"}>
    <div className={standaloneMobile?"overflow-visible bg-transparent":"overflow-visible rounded-lg border border-blue-300 bg-white"}>
      <div className="grid grid-cols-1 border-b border-slate-300 md:grid-cols-2 xl:grid-cols-7">
        <TripField label="Date">
          <NaviloDateInput aria-label="Trip Date" type="date" disabled={Boolean(editingTripId)||editingTripLocked} value={form.trip_date}
            onChange={e=>{setError("");setForm({...form,trip_date:e.target.value})}}
            className="h-8 w-full border-0 bg-white px-2 text-xs outline-none"/>
        </TripField>

        <TripField label="Truck Type" onAdd={!editingTripLocked&&entryPermissions.master?()=>openQuickAdd("truckType"):undefined}>
          <SearchMasterInput value={tripMasters.truckTypes.find((r:any)=>r.id===form.truck_type_id)?.name||""}
            options={tripMasters.truckTypes.map((r:any)=>({value:r.id,label:r.name}))}
            placeholder="Search Truck Type"
            disabled={editingTripLocked}
            onSelect={truckTypeId=>{
              const vehicle=tripMasters.vehicles.find((v:any)=>v.id===form.vehicle_id);
              setError("");
              setForm({...form,truck_type_id:truckTypeId,vehicle_id:vehicle&&truckTypeId&&vehicle.truck_type_id!==truckTypeId?"":form.vehicle_id});
            }}/>
        </TripField>

        <TripField label="PO/DO/Job No.">
          <input value={form.po_do_job_no} disabled={editingTripLocked}
            onChange={e=>{setError("");setForm({...form,po_do_job_no:e.target.value})}}
            className="h-8 w-full border-0 bg-white px-2 text-xs outline-none"/>
        </TripField>

        <TripField label="Customer" onAdd={!editingTripLocked&&entryPermissions.master?()=>openQuickAdd("customer"):undefined}>
          <SearchMasterInput value={tripMasters.customers.find((r:any)=>r.id===form.customer_id)?.name||""}
            options={tripMasters.customers.map((r:any)=>({value:r.id,label:r.name}))}
            placeholder="Search Customer"
            disabled={editingTripLocked||Boolean(editingTripId&&editingRateLocks.customer)}
            onSelect={customerId=>{
              const customer=tripMasters.customers.find((r:any)=>r.id===customerId);
              setError("");
              setForm({...form,customer_id:customerId,customer_name_snapshot:customer?.name||""});
            }}/>
        </TripField>

        <TripField label="Driver Name" onAdd={!editingTripLocked&&entryPermissions.master?()=>openQuickAdd("driver"):undefined}>
          <SearchMasterInput value={selectedDriver?.driver_name||""}
            options={tripMasters.drivers.map((r:any)=>({value:r.id,label:r.driver_name}))}
            placeholder="Search Driver"
            disabled={editingTripLocked}
            onSelect={driverId=>{setError("");setForm({...form,driver_id:driverId})}}/>
        </TripField>

        <TripField label="Owner / Supplier" onAdd={!editingTripLocked&&entryPermissions.master?()=>openQuickAdd('supplier'):undefined}>
          <input aria-label="Trip Owner / Supplier" readOnly value={ownerDisplay} placeholder={form.vehicle_id?'No ownership for Trip Date':'Select Plate first'} className="h-8 w-full border-0 px-2 text-xs"/>
          {!editingTripLocked&&<a className="px-2 text-[10px] text-blue-700 underline" href="/master-data/vehicle-ownership">Vehicle Ownership History</a>}
          {quickSupplierId&&<small className="block px-2">Supplier selected: {tripMasters.suppliers.find(s=>s.id===quickSupplierId)?.name}. Available for new Vehicle / dated ownership.</small>}
        </TripField>

        <TripField label="Plate #" onAdd={!editingTripLocked&&entryPermissions.master&&entryPermissions.owner?()=>openQuickAdd("vehicle"):undefined}>
          <SearchMasterInput value={selectedVehicle
              ? `${selectedVehicle.vehicle_no}${ownerDisplay?` - ${ownerDisplay}`:""}`
              : ""}
            options={vehicleChoices.map((r:any)=>{
              const owner=ownershipOnDate(tripMasters.ownership,r.id,form.trip_date)?.owner_name_snapshot||"";
              return {value:r.id,label:owner?`${r.vehicle_no} - ${owner}`:r.vehicle_no};
            })}
            placeholder="Search Plate"
            disabled={editingTripLocked}
            onSelect={vehicleId=>{
              const vehicle=tripMasters.vehicles.find((r:any)=>r.id===vehicleId);
              setError("");
              setForm({...form,vehicle_id:vehicleId,truck_type_id:vehicle?.truck_type_id||form.truck_type_id});
            }}/>
        </TripField>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-8">
        <TripField label="Driver Mob #">
          <input aria-label="Driver Mobile" value={selectedDriver?.mobile||""} readOnly
            className="h-8 w-full border-0 bg-white px-2 text-xs text-slate-900 outline-none"/>
        </TripField>

        <TripField label="From" onAdd={!editingTripLocked&&entryPermissions.master?()=>openQuickAdd("locationFrom"):undefined}>
          <SearchMasterInput value={form.from_location}
            options={tripMasters.locations.map((r:any)=>({value:r.id,label:r.name}))}
            placeholder="Search From"
            disabled={editingTripLocked}
            onSelect={locationId=>{
              const location=tripMasters.locations.find((r:any)=>r.id===locationId);
              setError("");
              setForm({...form,from_location:location?.name||""});
            }}/>
        </TripField>

        <TripField label="To" onAdd={!editingTripLocked&&entryPermissions.master?()=>openQuickAdd("locationTo"):undefined}>
          <SearchMasterInput value={form.to_location}
            options={tripMasters.locations.map((r:any)=>({value:r.id,label:r.name}))}
            placeholder="Search To"
            disabled={editingTripLocked}
            onSelect={locationId=>{
              const location=tripMasters.locations.find((r:any)=>r.id===locationId);
              setError("");
              setForm({...form,to_location:location?.name||""});
            }}/>
        </TripField>

        <TripField label="Paper Received">
          <select aria-label="PPR Status" value={form.ppr_status}
            onChange={e=>{setError("");setForm({...form,ppr_status:e.target.value,ppr_received_by_employee_id:e.target.value==="received"?form.ppr_received_by_employee_id:"",ppr_attachment_path:e.target.value==="received"?form.ppr_attachment_path:"",ppr_received_date:e.target.value==="received"?(form.ppr_received_date||new Date().toISOString().slice(0,10)):""})}}
            className="h-8 w-full border-0 bg-white px-2 text-xs outline-none">
            <option value="pending">Pending</option>
            <option value="received">Received</option>
            <option value="not_required">Not Required</option>
          </select>
        </TripField>

        <TripField label="PPR Receiving Employee">
          <select aria-label="PPR Receiving Employee" value={form.ppr_received_by_employee_id} disabled={form.ppr_status!=="received"} onChange={e=>setForm({...form,ppr_received_by_employee_id:e.target.value})} className="input w-full">
            <option value="">Select employee</option>
            {form.ppr_received_by_employee_id&&!tripMasters.employees.some(e=>e.id===form.ppr_received_by_employee_id)&&<option value={form.ppr_received_by_employee_id}>Recorded employee</option>}
            {tripMasters.employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </TripField>
        <TripField label="PPR Attachment (optional)">
          <input aria-label="PPR Attachment" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={loading||!editingTripId||form.ppr_status!=="received"} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void attachPpr(file)}}/>
          <small>Save the Trip receipt first, then edit to attach a PDF or image (up to 10 MB).</small>
          {form.ppr_attachment_path&&<button type="button" className="text-blue-700 underline" onClick={()=>void openPpr()}>View saved PPR</button>}
        </TripField>
        <TripField label="PPR Date">
          <NaviloDateInput aria-label="PPR Date" type="date" value={form.ppr_received_date}
            disabled={form.ppr_status!=="received"}
            onChange={e=>{setError("");setForm({...form,ppr_received_date:e.target.value})}}
            className="h-8 w-full border-0 bg-white px-2 text-xs outline-none disabled:bg-slate-50"/>
        </TripField>

        <TripField label="Supplier / Owner Rent">
          <input type="number" min="0" step="0.01" aria-label="Supplier / Owner Rent" readOnly={editingTripLocked||Boolean(editingTripId)||!entryPermissions.rent||!supplierOwned} value={form.supplier_rent}
            onChange={e=>{setError("");setForm({...form,supplier_rent:e.target.value})}}
            className="h-8 w-full border-0 bg-white px-2 text-right text-xs outline-none"/>
        </TripField>

        <TripField label="Customer Rate">
          <input type="number" min="0" step="0.01" aria-label="Customer Rate" readOnly={editingTripLocked||Boolean(editingTripId)||!entryPermissions.rate} title={editingTripId?"Customer Rate is a financial field. Use Finance for controlled changes.":""} value={form.customer_rate}
            onChange={e=>{setRateTouched(true);setError("");setForm({...form,customer_rate:e.target.value})}}
            className="h-8 w-full border-0 bg-white px-2 text-right text-xs outline-none"/>
        </TripField>

        <TripField label="Driver Pay">
          <input aria-label="Driver Pay" type="number" min="0" step="0.01" readOnly={editingTripLocked||Boolean(editingTripId)||!entryPermissions.driver} value={form.driver_pay} onChange={e=>setForm({...form,driver_pay:e.target.value})} className="h-8 w-full border-0 px-2 text-right text-xs"/>
        </TripField>
        <TripField label="Estimated Operational Margin">
          <input aria-label="Estimated Operational Margin" value={estimatedMargin(form.customer_rate,form.supplier_rent,form.driver_pay,supplierOwned)} readOnly className="h-8 w-full border-0 bg-slate-50 px-2 text-right text-xs font-semibold"/>
        </TripField>
      </div>
    </div>

    <p className="mt-1 text-[10px] text-slate-600">{agreedRate?`Suggested Customer Rate: ${agreedRate.amount} (effective agreement). `:''}Entered Customer Rate and Supplier Rent finalize on creation with permission; blank means pending. Driver Pay is separate. Estimated margin excludes later expenses, fuel and charges. {editingTripId?'Use Finance for rate, rent or driver-pay corrections.':''}</p>
    <div className="mt-3 grid gap-3 xl:grid-cols-[180px_1fr_auto]">
      <label className="text-[11px] font-semibold text-slate-700">
        Sale Type
        <select aria-label="Sale Type" disabled={editingTripLocked||Boolean(editingTripId&&editingRateLocks.customer)} value={form.sale_type}
          onChange={e=>{setError("");setForm({...form,sale_type:e.target.value})}}
          className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs outline-none focus:border-blue-400">
          <option value="">Select</option>
          <option value="cash">Cash</option>
          <option value="credit">Credit</option>
        </select>
      </label>

      <label className="text-[11px] font-semibold text-slate-700">
        Remarks
        <input value={form.notes}
          onChange={e=>{setError("");setForm({...form,notes:e.target.value})}}
          className="mt-1 h-9 w-full rounded-md border border-slate-300 px-3 text-xs outline-none focus:border-blue-400"/>
      </label>

      <div className="flex items-end justify-end gap-2">
        <button className="btn" onClick={()=>{setError("");setEditingTripId(null);setEditingTripNo("");setEditingOriginalAssignment({vehicle_id:"",driver_id:""});setTab(entryReturnTab.current)}}>Cancel</button>
        <button className="btn-primary" onClick={()=>void (editingTripId?updateTrip():createTrip())} disabled={loading||(entryReturnTab.current==="mobile"&&(editingTripId?!mobileCanEdit:!mobileCanCreate))}>
          {loading?(editingTripId?"Saving...":"Creating..."):(editingTripId?"Save Changes":"Create Trip")}
        </button>
      </div>
    </div>

    {quickAdd&&<TransportQuickAdd key={`${scopeKey}/${quickAdd}`} kind={quickAdd} truckTypeId={form.truck_type_id} supplierId={quickSupplierId}
      truckTypes={tripMasters.truckTypes} suppliers={tripMasters.suppliers} onCreated={quickMasterCreated} onClose={()=>setQuickAdd(null)}/>}

  </div>
  }

  {!standaloneMobile&&newTripMode==="bulk"&&
  <div className="space-y-3 p-4">

    {quickAdd&&bulkFixRowNo!==null&&<TransportQuickAdd key={`${scopeKey}/bulk/${bulkFixRowNo}/${quickAdd}`} kind={quickAdd} truckTypeId="" supplierId=""
      initialName={(()=>{const row=bulkRows.find(r=>r.rowNo===bulkFixRowNo);if(!row)return "";if(quickAdd==="customer")return row.customer;if(quickAdd==="driver")return row.driver;if(quickAdd==="locationFrom")return row.from_location;if(quickAdd==="locationTo")return row.to_location;if(quickAdd==="truckType")return row.truck_type;if(quickAdd==="vehicle")return row.vehicle;if(quickAdd==="supplier")return row.owner_supplier;return "";})()}
      truckTypes={tripMasters.truckTypes} suppliers={tripMasters.suppliers} onCreated={quickMasterCreated} onClose={()=>{setQuickAdd(null);setBulkFixRowNo(null)}}/>}
    <p className="text-xs">Daily operational upload: creates Trips and agreed charges only. Historical receipts and paid rent require the separate One-time Historical Import.</p>

    <div className="flex flex-wrap items-center gap-2">

      <button
        type="button"
        data-navilo-keep-local-action="true"
        className="btn"
        onClick={downloadBulkTemplate}
      >
        Download Template
      </button>

      <label className="btn cursor-pointer">

        <Upload className="h-4 w-4"/>

        Select Transport Excel / CSV

        <input
          type="file"
          accept=".xlsm,.xlsx,.xls,.csv"
          disabled={bulkImporting||bulkParsing||bulkValidating||Boolean(importJob&&importJob.completed<importJob.batches.length)}
          className="hidden"
          onChange={e=>{
            const file=e.target.files?.[0];

            if(file){
              void parseBulkFile(file);
            }

            e.currentTarget.value="";
          }}
        />

      </label>

      {bulkRows.length>0&&
        <button
          type="button"
          className="btn"
          disabled={bulkImporting||bulkParsing||bulkValidating}
          onClick={clearBulkUpload}
        >
          Clear
        </button>
      }

      {bulkFileName&&
        <span className="text-xs font-medium text-slate-500">
          {bulkFileName}
        </span>
      }

    </div>


    {importJob&&<div className="rounded border bg-blue-50 p-2 text-xs" role="status">
      <strong>{importJob.fileName}</strong> · {Math.min(importJob.completed*100,importJob.total).toLocaleString()} / {importJob.total.toLocaleString()} Trips confirmed
      {bulkImporting?<button className="btn ml-2" onClick={()=>{importStop.current=true}}>Pause after batch</button>:importJob.completed<importJob.batches.length?<button className="btn-primary ml-2" onClick={()=>void executeImport(importJob)}>Resume Import</button>:<span className="ml-2 text-emerald-700">Complete</span>}
      <p>Keep this browser's saved import data until complete. Retry reconciles an uncertain batch through its original server request ID.</p>
    </div>}
    {bulkRows.some(r=>r.errors.length)&&<button className="btn" disabled={bulkImporting} onClick={downloadRejected}>Download Rejected Rows</button>}
    {bulkRows.length>0&&<div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
      <button
        type="button"
        data-navilo-keep-local-action="true"
        onClick={()=>void importValidBulkRows()}
        disabled={bulkImporting||bulkParsing||bulkValidating||!bulkRows.some(row=>row.errors.length===0)}
        className="btn-primary min-w-[190px] justify-center disabled:cursor-not-allowed disabled:opacity-50"
      >
        {bulkImporting?"Importing...":`Import Valid Rows (${bulkRows.filter(row=>row.errors.length===0).length})`}
      </button>
      <span className="text-xs font-medium text-slate-600">Only rows that pass all validations will be imported.</span>
    </div>}

    {(bulkParsing||bulkValidating)&&
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
        {bulkValidating?"Matching NAVILO master data...":"Reading and validating file..."}
      </div>
    }


    {!bulkRows.length&&!bulkParsing&&!bulkValidating&&
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">

        <Upload className="mx-auto h-7 w-7 text-slate-400"/>

        <div className="mt-2 text-sm font-bold text-slate-800">
          Upload Transport Trips
        </div>

        <div className="mt-1 text-xs text-slate-500">
          Download the Transport-format template, complete the Trips rows, then upload XLSM, XLSX, XLS or CSV for validation.
        </div>

        <div className="mt-2 text-[11px] font-medium text-slate-500">
          Trip No is not imported. NAVILO generates it automatically.
        </div>

      </div>
    }


    {bulkRows.length>0&&<>

      <div className="grid gap-2 sm:grid-cols-3">

        <div className="rounded-lg border border-slate-200 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase text-slate-400">
            Rows
          </div>
          <div className="text-lg font-bold">
            {bulkRows.length}
          </div>
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase text-emerald-600">
            Valid
          </div>
          <div className="text-lg font-bold text-emerald-800">
            {bulkRows.filter(r=>!r.errors.length).length}
          </div>
        </div>

        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase text-red-600">
            Rejected
          </div>
          <div className="text-lg font-bold text-red-800">
            {bulkRows.filter(r=>r.errors.length).length}
          </div>
        </div>

      </div>


      <div className="max-h-[430px] overflow-auto rounded-lg border border-slate-200">

        <table className="min-w-[1500px] w-full text-xs">

          <thead className="sticky top-0 bg-slate-100 text-left text-[10px] uppercase text-slate-500">

            <tr>
              <th className="px-2 py-2">Row</th>
              <th className="px-2 py-2">Status</th>

              {BULK_TRIP_HEADERS.map(header=>
                <th
                  key={header}
                  className="whitespace-nowrap px-2 py-2"
                >
                  {header}
                </th>
              )}

            </tr>

          </thead>

          <tbody>

            {bulkRows.slice(bulkPreviewPage*100,(bulkPreviewPage+1)*100).map(row=>
              <Fragment key={row.rowNo}>
              <tr
                className="border-t border-slate-100"
              >

                <td className="px-2 py-2 font-semibold">
                  {row.rowNo}
                </td>

                <td className="px-2 py-2">

                  {row.errors.length
                    ? <button
                        type="button"
                        className="font-semibold text-red-700 underline decoration-dotted underline-offset-2"
                        title={row.errors.join("; ")}
                        onClick={()=>setBulkFixRowNo(current=>current===row.rowNo?null:row.rowNo)}
                      >
                        Rejected
                      </button>

                    : <span className="font-semibold text-emerald-700">
                        Valid
                      </span>
                  }

                </td>

                <td className="whitespace-nowrap px-2 py-2">{formatNaviloDate(row.trip_date)}</td>
                <td className="whitespace-nowrap px-2 py-2">{row.customer}</td>
                <td className="whitespace-nowrap px-2 py-2">{row.truck_type}</td>
                <td className="whitespace-nowrap px-2 py-2">{row.vehicle}</td>
                <td className="whitespace-nowrap px-2 py-2">{row.driver}</td>
                <td className="whitespace-nowrap px-2 py-2">{row.owner_supplier}</td>
                <td className="whitespace-nowrap px-2 py-2">{row.po_do_job_no}</td>
                <td className="whitespace-nowrap px-2 py-2">{row.from_location}</td>
                <td className="whitespace-nowrap px-2 py-2">{row.to_location}</td>
                <td className="whitespace-nowrap px-2 py-2">{row.ppr_status}</td>
                <td className="whitespace-nowrap px-2 py-2">{row.customer_rate}</td>
                <td className="whitespace-nowrap px-2 py-2">{row.supplier_rent}</td>
                <td className="whitespace-nowrap px-2 py-2">{row.source_invoice_no}</td>
                <td className="max-w-[220px] truncate px-2 py-2">{row.notes}</td>
                <td className="px-2 py-2">{row.sale_type}</td><td className="px-2 py-2">{row.driver_pay}</td>
                <td className="px-2 py-2">{row.ppr_employee}</td><td className="px-2 py-2">{row.ppr_date}</td>

              </tr>
              {bulkFixRowNo===row.rowNo&&row.errors.length>0&&
                <tr className="border-t border-red-100 bg-red-50/60">
                  <td colSpan={BULK_TRIP_HEADERS.length+2} className="px-3 py-2">
                    <div className="space-y-2 text-[11px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-red-800">Fix rejected row:</span>
                        {row.errors.map((message,index)=><span key={index} className="rounded border border-red-200 bg-white px-2 py-1 text-red-700">{message}</span>)}
                      </div>
                      <div className="sticky left-0 flex w-max max-w-full flex-wrap items-center gap-2 rounded border border-slate-200 bg-white p-2 shadow-sm">
                        <span className="font-semibold text-slate-700">Create Missing Masters:</span>
                        {entryPermissions.master&&row.errors.some(e=>e.startsWith('Customer is missing'))&&<button className="btn" onClick={()=>{setBulkFixRowNo(row.rowNo);openQuickAdd('customer')}}>+ Customer</button>}
                        {entryPermissions.master&&row.errors.some(e=>e.startsWith('Driver is missing'))&&<button className="btn" onClick={()=>{setBulkFixRowNo(row.rowNo);openQuickAdd('driver')}}>+ Driver</button>}
                        {entryPermissions.master&&row.errors.some(e=>e.startsWith('From is missing'))&&<button className="btn" onClick={()=>{setBulkFixRowNo(row.rowNo);openQuickAdd('locationFrom')}}>+ From</button>}
                        {entryPermissions.master&&row.errors.some(e=>e.startsWith('To is missing'))&&<button className="btn" onClick={()=>{setBulkFixRowNo(row.rowNo);openQuickAdd('locationTo')}}>+ To</button>}
                        {entryPermissions.master&&row.errors.some(e=>e.startsWith('Truck Type is missing'))&&<button className="btn" onClick={()=>{setBulkFixRowNo(row.rowNo);openQuickAdd('truckType')}}>+ Truck Type</button>}
                        {entryPermissions.master&&entryPermissions.owner&&row.errors.some(e=>e.startsWith('Vehicle is missing'))&&<button className="btn" onClick={()=>{setBulkFixRowNo(row.rowNo);openQuickAdd('vehicle')}}>+ Vehicle</button>}
                        {entryPermissions.owner&&row.errors.some(e=>e==='Vehicle Ownership History must cover Trip Date')&&row.owner_supplier&&<button className="btn" disabled={bulkValidating} onClick={async()=>{setError('');try{await fixBulkOwnership(row)}catch(e:any){setError(e?.message||'Unable to fix dated ownership.')}}}>Fix Ownership</button>}
                        {entryPermissions.master&&row.errors.some(e=>e==='Vehicle does not match Truck Type')&&<button className="btn" disabled={bulkValidating} onClick={async()=>{setError('');try{await fixBulkTruckType(row)}catch(e:any){setError(e?.message||'Unable to fix Vehicle Truck Type.')}}}>Fix Truck Type</button>}
                        <button className="btn" disabled={bulkValidating} onClick={async()=>{const validated=await validateBulkMasters([row],true);setBulkRows(rows=>rows.map(item=>item.rowNo===row.rowNo?validated[0]:item));}}>Re-validate</button>
                      </div>
                    </div>
                  </td>
                </tr>}
              </Fragment>
            )}

          </tbody>

        </table>

      </div>


      <TransportPagination page={bulkPreviewPage} pageSize={100} count={bulkRows.length} busy={bulkParsing||bulkValidating} onPage={setBulkPreviewPage}/>
      <div className="text-xs text-slate-500">
        Preview shows 100 rows per page. Payments, balances and profit from Excel are not posted.
      </div>

    </>}

  </div>
  }

</section>}

    {!showPartyReports&&tab==="mobile"&&<section className={standaloneMobile?"min-h-dvh w-full bg-slate-100 pb-6":"mx-auto w-full max-w-xl px-3 pb-6 pt-2 sm:px-4"}>
      <div className={standaloneMobile?"min-h-dvh w-full bg-white":"rounded-2xl border border-slate-200 bg-white shadow-sm"}>
        {standaloneMobile&&<div className="sticky top-0 z-20 flex min-h-14 items-center justify-between border-b border-slate-800 bg-slate-950 px-4 text-white shadow-sm">
          <div className="min-w-0"><div className="text-sm font-black">NAVILO · Transport Mobile</div><div className="truncate text-[11px] text-slate-300">{activeCompany?.company_name??"Transport workspace"}</div></div>
          <button type="button" onClick={()=>void loadMobileTrips(mobileSearch)} disabled={mobileLoading} className="h-9 rounded-lg border border-white/20 bg-white/10 px-3 text-xs font-bold disabled:opacity-60">Refresh</button>
        </div>}
        <div className="border-b border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-slate-950">Transport Mobile</h2>
              <p className="mt-0.5 text-xs text-slate-500">Fast entry and recent Trip search · last 30 days only.</p>
            </div>
            {mobileCanCreate&&<div className="flex shrink-0 gap-2"><button type="button" onClick={captureVoiceTrip} disabled={voiceListening} className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-violet-300 bg-violet-50 px-3 text-sm font-bold text-violet-800 shadow-sm disabled:opacity-60"><Mic className="h-4 w-4"/>{voiceListening?"Listening…":"Voice Trip"}</button><button type="button" onClick={()=>{setCurrentVoiceDraftId(null);entryReturnTab.current="mobile";setEditingTripId(null);setEditingTripNo("");setEditingOriginalAssignment({vehicle_id:"",driver_id:""});setNewTripMode("single");setTab("new")}} className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-blue-700">
              <Plus className="h-4 w-4"/>New Trip
            </button></div>}
          </div>
          <form className="mt-4 flex gap-2" onSubmit={e=>{e.preventDefault();void loadMobileTrips(mobileSearch)}}>
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400"/>
              <input value={mobileSearch} onChange={e=>setMobileSearch(e.target.value)} placeholder="Trip No, vehicle, driver, customer, PO/DO…" className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-400"/>
            </div>
            <button type="submit" disabled={mobileLoading} className="h-10 rounded-xl border border-blue-600 bg-blue-600 px-4 text-xs font-bold text-white disabled:opacity-60">{mobileLoading?"Searching…":"Search"}</button>
          </form>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
            <span>{formatNaviloDate(mobileFromDate)} — {formatNaviloDate(mobileToday)}</span>
            <button type="button" onClick={()=>{setMobileSearch("");void loadMobileTrips("")}} className="font-semibold text-blue-700">Recent Trips</button>
          </div>
          {(!mobileCanCreate||!mobileCanEdit)&&<div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">Owner Control access: {mobileCanCreate?"New Trip allowed":"New Trip disabled"} · {mobileCanEdit?"Edit allowed":"Edit disabled"}.</div>}
        </div>
        {voiceStatus&&<div className="border-b border-violet-100 bg-violet-50 px-4 py-2 text-[11px] font-semibold text-violet-800">{voiceStatus}</div>}
        {voiceDrafts.length>0&&<div className="border-b border-amber-200 bg-amber-50 p-3"><div className="mb-2 flex items-center justify-between"><div className="text-xs font-black text-amber-900">Voice Inbox · {voiceDrafts.length} saved draft{voiceDrafts.length===1?"":"s"}</div><div className="text-[10px] text-amber-700">Saved on this phone until created or deleted</div></div><div className="space-y-2">{voiceDrafts.slice(0,5).map(draft=><div key={draft.id} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white p-2"><button type="button" onClick={()=>openVoiceDraft(draft)} className="min-w-0 flex-1 text-left"><div className="truncate text-xs font-semibold text-slate-900">{draft.transcript}</div><div className="text-[10px] text-slate-500">{new Date(draft.created_at).toLocaleString()}</div></button><button type="button" aria-label="Delete voice draft" onClick={()=>removeVoiceDraft(draft.id)} className="rounded-lg border border-slate-200 p-2 text-slate-500"><Trash2 className="h-4 w-4"/></button></div>)}</div></div>}
        <div className="divide-y divide-slate-100">
          {!mobileLoading&&mobileRows.length===0&&<div className="p-6 text-center text-sm text-slate-500">No Trips found in the last 30 days.</div>}
          {mobileRows.map(row=><article key={row.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-black text-slate-950">{row.trip_no}</span>
                  <Badge value={row.status}/>
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-700">{formatNaviloDate(row.trip_date)} · {row.customer_name||"No customer"}</div>
                <div className="mt-1 text-xs text-slate-500">{row.vehicle_no||"No vehicle"}{row.driver_name?` · ${row.driver_name}`:""}</div>
                <div className="mt-1 text-xs text-slate-600">{row.from_location||"—"} → {row.to_location||"—"}</div>
                {row.po_do_job_no&&<div className="mt-1 text-[11px] text-slate-500">PO/DO/Job: {row.po_do_job_no}</div>}
              </div>
              {mobileCanEdit&&<button type="button" disabled={loading} onClick={()=>void startEditTrip(row,"mobile")} className="h-10 shrink-0 rounded-lg border border-slate-300 bg-white px-4 text-xs font-bold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-60">Edit</button>}
            </div>
          </article>)}
        </div>
      </div>
    </section>}

    {!showPartyReports&&tab==="audit"&&<TransportAudit trips={rows}/>}
    {!showPartyReports&&tab==="driver-expenses"&&<TransportCostUpload trips={rows} onChanged={load}/> }
    {!showPartyReports&&tab==="driver-account"&&<TransportAccountRows title="Driver Account / Hisaab" kind="driver"/> }
    {!showPartyReports&&tab==="vehicle-account"&&<TransportAccountRows title="Vehicle Account / Gari Hisaab" kind="vehicle"/> }
    {quickPprTrip&&<div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/30 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div><div className="text-sm font-bold">Receive PPR</div><div className="text-xs text-slate-500">{quickPprTrip.trip_no}</div></div>
          <button type="button" onClick={()=>setQuickPprTrip(null)} className="rounded border px-2 py-1 text-xs">Close</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-semibold">Received By
            <select value={quickPprEmployee} onChange={e=>setQuickPprEmployee(e.target.value)} className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs">
              <option value="">Select employee</option>
              {tripMasters.employees.map((employee:any)=><option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold">PPR Date
            <NaviloDateInput aria-label="PPR Received Date" type="date" value={quickPprDate} onChange={e=>setQuickPprDate(e.target.value)} className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 text-xs"/>
          </label>
        </div>
        <label className="mt-3 block text-xs font-semibold">PPR Photo / Attachment (optional)
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={loading} onChange={e=>setQuickPprFile(e.target.files?.[0]??null)} className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"/>
          <span className="mt-1 block text-[10px] font-normal text-slate-500">Choose photo or PDF · max 10 MB</span>
        </label>
        {error&&<div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] font-semibold text-red-700">{error}</div>}
        {!quickPprEmployee&&<div className="mt-2 text-[10px] font-medium text-amber-700">Select Received By employee, then click Mark Received.</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={()=>setQuickPprTrip(null)} className="rounded border px-3 py-2 text-xs font-semibold">Cancel</button>
          <button type="button" disabled={loading} onClick={()=>void saveQuickPpr()} className="rounded bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">Mark Received</button>
        </div>
      </div>
    </div>}
    {initialRateTrip&&<TransportInitialRate trip={initialRateTrip} onClose={()=>setInitialRateTrip(null)} onChanged={load}/>}
    {invoiceTrip&&<TransportInvoiceNumber trip={invoiceTrip} onClose={()=>setInvoiceTrip(null)} onChanged={load}/>}
    {showBulkSupplierRent&&<TransportBulkSupplierRent compact={Boolean(bulkSupplierRentTrip)} initialTripId={bulkSupplierRentTrip?.id} initialSupplierName={bulkSupplierRentTrip?.owner_name??undefined} onClose={()=>{setShowBulkSupplierRent(false);setBulkSupplierRentTrip(null)}} onChanged={async()=>{await load(true)}}/>}
      {showBulkCustomerRate&&<TransportBulkCustomerRate onClose={()=>setShowBulkCustomerRate(false)} onChanged={async()=>{await load(true)}}/>}

  </div>
}
function ColumnFilterMenu({
  label,top,left,options,selected,onToggle,onSelectAll,onClear,onClose,search,onSearch,loading
}:{
  search:string;onSearch:(value:string)=>void;loading:boolean;
  label:string;
  top:number;
  left:number;
  options:string[];
  selected:string[];
  onToggle:(value:string)=>void;
  onSelectAll:()=>void;
  onClear:()=>void;
  onClose:()=>void;
}){
  const shown=options;

  return <div
    className="fixed z-[9999] flex flex-col rounded-md border border-slate-200 bg-white p-1 text-[9px] normal-case shadow-lg"
    aria-label={`${label} filter popup`}
    style={{top,left,width:190,height:190,minWidth:150,minHeight:140,maxWidth:`calc(100vw - ${left+8}px)`,maxHeight:`calc(100vh - ${top+8}px)`,resize:'both',overflow:'hidden'}}
    onClick={e=>e.stopPropagation()}
  >
    <div className="mb-0.5 flex items-center justify-between leading-none">
      <span className="font-bold text-slate-800">{label}</span>
      <button type="button" onClick={onClose} className="h-4 px-1 text-[9px] leading-none text-slate-400 hover:text-slate-800">×</button>
    </div>

    <div className="relative mt-0.5">
      <Search className="absolute left-1 top-1 h-2.5 w-2.5 text-slate-400"/>
      <input
        autoFocus
        value={search}
        onChange={e=>onSearch(e.target.value)}
        placeholder="Search all values..."
        className="h-5 w-full rounded border border-slate-200 pl-5 pr-1.5 text-[9px]"
      />
    </div>

    <div className="mt-0.5 flex gap-px">
      <button type="button" onClick={onSelectAll}
        className="h-[18px] flex-1 rounded border border-slate-200 px-1 py-0 text-[8px] font-semibold leading-none hover:bg-slate-50">
        Select Shown
      </button>

      <button type="button" onClick={onClear}
        className="h-[18px] flex-1 rounded border border-slate-200 px-1 py-0 text-[8px] font-semibold leading-none hover:bg-slate-50">
        Clear
      </button>
    </div>

    <div className="mt-1 min-h-0 flex-1 overflow-y-auto border-t border-slate-100 pt-0.5">
      {loading&&<p>Loading values…</p>}
      <p className="text-slate-500">Up to 200 matches. Search for more.</p>
      {shown.map(value=>
        <label key={value} className="flex h-[18px] cursor-pointer items-center gap-1 rounded px-0.5 py-0 hover:bg-slate-50">
          <input
            type="checkbox"
            checked={selected.includes(value)}
            onChange={()=>onToggle(value)}
          />
          <span title={value} className="min-w-0 flex-1 truncate text-[9px]">{value}</span>
        </label>
      )}

      {!shown.length&&
        <div className="px-1 py-3 text-center text-slate-400">No values</div>
      }
    </div>
    <div className="shrink-0 pt-0.5 pr-3 text-right text-[8px] leading-3 text-slate-400">Drag corner to resize ↘</div>
  </div>
}

function SearchMasterInput({value,options,onSelect,placeholder,disabled=false}:{
  value:string;
  options:{value:string;label:string}[];
  onSelect:(value:string)=>void|Promise<void>;
  placeholder?:string;
  disabled?:boolean;
}){
  const [query,setQuery]=useState(value);
  const [open,setOpen]=useState(false);
  const [activeIndex,setActiveIndex]=useState(-1);

  useEffect(()=>{setQuery(value)},[value]);

  const normalized=(open&&query===value?"":query).trim().toLocaleLowerCase();
  const filtered=options
    .filter(o=>!normalized||o.label.toLocaleLowerCase().includes(normalized))
    .slice(0,50);

  const commit=(option:{value:string;label:string}|undefined)=>{
    if(!option)return;
    setQuery(option.label);
    setOpen(false);
    setActiveIndex(-1);
    void onSelect(option.value);
  };

  return <div className="relative min-w-0">
    <input
      value={query}
      disabled={disabled}
      autoComplete="off"
      placeholder={placeholder}
      onFocus={e=>{
        setOpen(true);
        setActiveIndex(-1);
        e.currentTarget.select();
      }}
      onClick={()=>{if(!disabled)setOpen(true)}}
      onChange={e=>{
        setQuery(e.target.value);
        setOpen(true);
        setActiveIndex(-1);
      }}
      onKeyDown={e=>{
        if(e.key==="ArrowDown"){
          e.preventDefault();
          setOpen(true);
          setActiveIndex(i=>Math.min(i+1,Math.max(filtered.length-1,0)));
          return;
        }
        if(e.key==="ArrowUp"){
          e.preventDefault();
          setOpen(true);
          setActiveIndex(i=>Math.max(i-1,0));
          return;
        }
        if(e.key==="Enter"){
          if(open&&filtered.length){
            e.preventDefault();
            e.stopPropagation();
            commit(activeIndex>=0?filtered[activeIndex]:filtered[0]);
          }
          return;
        }
        if(e.key==="Escape"){
          e.preventDefault();
          setOpen(false);
          setQuery(value);
          return;
        }
        if(e.key==="Tab"&&open&&filtered.length===1){
          commit(filtered[0]);
        }
      }}
      onBlur={()=>{
        window.setTimeout(()=>{
          setOpen(false);
          const exact=options.find(o=>o.label.toLocaleLowerCase()===query.trim().toLocaleLowerCase());
          if(exact){
            setQuery(exact.label);
            void onSelect(exact.value);
          }else{
            setQuery(value);
          }
        },150);
      }}
      className="h-8 w-full border-0 bg-white px-2 pr-6 text-xs text-slate-900 outline-none disabled:cursor-not-allowed disabled:bg-white disabled:text-slate-500"
    />
    {!disabled&&<span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-400">▼</span>}
    {open&&!disabled&&
      <div className="absolute left-0 right-0 top-full z-[80] max-h-52 overflow-y-auto rounded-b border border-slate-300 bg-white shadow-xl">
        {filtered.length?filtered.map((o,index)=>
          <button
            key={o.value}
            type="button"
            tabIndex={-1}
            onMouseEnter={()=>setActiveIndex(index)}
            onMouseDown={e=>{
              e.preventDefault();
              e.stopPropagation();
              commit(o);
            }}
            className={`block w-full px-2 py-2 text-left text-xs text-slate-800 ${index===activeIndex?"bg-blue-100":"bg-white hover:bg-blue-50"}`}
          >
            {o.label}
          </button>
        ):<div className="px-2 py-2 text-xs text-slate-500">No match</div>}
      </div>
    }
  </div>
}
function TripField({label,children,onAdd}:{label:string;children:React.ReactNode;onAdd?:()=>void}){
  return <div className="transport-trip-field min-w-0 border-b border-r border-slate-300 last:border-r-0">
    <div className="transport-trip-field-label relative flex h-7 items-center justify-center bg-slate-200 px-1 text-center text-[9px] font-bold uppercase text-slate-800">
      {label}
      {onAdd&&
        <button type="button" aria-label={`Add ${label}`} title={`Add ${label}`}
          onClick={e=>{e.preventDefault();e.stopPropagation();onAdd()}}
          className="absolute right-1 top-1/2 -translate-y-1/2 px-1 text-lg font-bold leading-none text-red-600 hover:text-red-700">
          +
        </button>
      }
    </div>
    <div className="transport-trip-field-control block min-h-8">{children}</div>
  </div>
}

function FilterDate({label,value,setValue}:{label:string;value:string;setValue:(value:string)=>void}){
  return <label className="text-[9px] font-bold uppercase tracking-normal text-slate-500">
    {label}
    <NaviloDateInput type="date" value={value} onChange={e=>setValue(e.target.value)}
      className="mt-0.5 h-6 w-full rounded border border-slate-200 bg-white px-1.5 text-[10px]"/>
  </label>
}

function FilterSelect({label,value,setValue,all,options}:{label:string;value:string;setValue:(value:string)=>void;all:string;options:string[]}){
  return <label className="text-[9px] font-bold uppercase tracking-normal text-slate-500">
    {label}
    <select value={value} onChange={e=>setValue(e.target.value)}
      className="mt-0.5 h-6 w-full rounded border border-slate-200 bg-white px-1.5 text-[10px]">
      <option value="">{all}</option>
      {options.map(v=><option key={v} value={v}>{v}</option>)}
    </select>
  </label>
}

function SimplePanel({title,text}:{title:string;text:string}){return <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-base font-bold text-slate-950">{title}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{text}</p></section>}

function TransportAccountRows({title,kind}:{title:string;kind:'driver'|'vehicle'}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const [search,setSearch]=useState(''),[page,setPage]=useState(0),[filtered,setRows]=useState<Trip[]>([]),[count,setCount]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [revision,setRevision]=useState(0);
 const scope=`${activeCompany?.company_id}/${activeBusinessUnit?.business_unit_id}`;
 useEffect(()=>{setPage(0);setSearch('');},[scope]);
 useEffect(()=>{setPage(0);},[search]);
 useEffect(()=>{let live=true;setBusy(true);setRows([]);const timer=window.setTimeout(()=>void (async()=>{
  try{const r=await supabase.rpc('transport_register_query',{p_limit:500,p_offset:page*500,p_filters:{search}});if(!live)return;if(r.error)throw r.error;setRows(r.data.rows);setCount(r.data.count);setError('');}catch(e:any){if(live)setError(e.message);}finally{if(live)setBusy(false);}
 })(),200);return()=>{live=false;window.clearTimeout(timer)};},[scope,search,page,revision]);
 return <section className="rounded-lg border bg-white p-3"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">{title}</h2><input aria-label={`Search ${title}`} className="input" placeholder="Trip / driver / vehicle" value={search} onChange={e=>setSearch(e.target.value)}/></div>
 <TransportAccountStatement kind={kind} onChanged={()=>setRevision(r=>r+1)}/>{error&&<p role="alert">{error}</p>}<div className="overflow-auto"><table className="w-full text-xs"><thead><tr><th className="text-left">Trip</th><th className="text-left">{kind==='driver'?'Driver':'Current vehicle / owner'}</th><th>Status</th><th>Accrued / Billed</th><th>Paid</th><th>Outstanding</th><th>Posted Trip profit</th></tr></thead><tbody>{filtered.map(r=><tr className="border-t" key={r.id}><td><span className="font-semibold text-blue-700">{r.trip_no}</span></td><td>{kind==='driver'?r.driver_name:`${r.vehicle_no??''} / ${r.owner_name??''}`}</td><td>{r.financial_status}</td><td className="text-right">{financialNumber(kind==='driver'?r.driver_accrued:r.billed_supplier_net)}</td><td className="text-right">{financialNumber(kind==='driver'?r.driver_paid:r.supplier_paid_net)}</td><td className="text-right">{financialNumber(kind==='driver'?r.driver_outstanding:Number(r.supplier_outstanding_gross??0)-Number(r.supplier_credit_gross??0))}</td><td className="text-right">{financialNumber(r.trip_profit)}</td></tr>)}</tbody></table></div><TransportPagination page={page} pageSize={500} count={count} busy={busy} onPage={setPage}/></section>;
}
