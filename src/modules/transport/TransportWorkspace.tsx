import NaviloDateInput from '@/components/NaviloDateInput';
import { formatNaviloDate } from "@/lib/naviloDate";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, Upload, Route, History, ReceiptText, UserRound, Truck, RefreshCw, LockKeyhole } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import TransportBulkSupplierRent from './TransportBulkSupplierRent';
import TransportBulkCustomerRate from './TransportBulkCustomerRate';
import TransportInitialRate from './TransportInitialRate';
import TransportCostUpload from './TransportCostUpload';
import TransportHistoricalImport from './TransportHistoricalImport';
import TransportAudit from './TransportAudit';
import TransportPartyReports from './TransportPartyReports';
import TransportAccountStatement from './TransportAccountStatement';
import {fetchAllPages} from '@/lib/fetchAllPages';
import {financialNumber, type FinancialTrip} from './transportFinancialTypes';
import * as XLSX from "xlsx";
import {parseTripFile,fileDigest,makeImportJob,runImportJob,storedImport,saveImport,tripImportIdentity,type ImportRow,type ImportJob} from './transportTripImport';
import TransportPagination from './TransportPagination';
import TransportQuickAdd from './TransportQuickAdd';
import {compatibleVehicles,ownershipOnDate,matchingCustomerRate,estimatedMargin,masterKey,validMoney,type QuickAddKind,type OwnershipPeriod} from './transportTripEntry';

type Tab="trips"|"new"|"audit"|"driver-expenses"|"driver-account"|"vehicle-account";
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
  invoice_no:string|null;
};

const tabs:{key:Tab;label:string;icon:any}[]=[
  {key:"trips",label:"Trips",icon:Route},{key:"new",label:"New Trip",icon:Plus},{key:"audit",label:"Trip Audit",icon:History},
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

const BUKU_TRIP_HEADERS=[
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
  const {user,activeCompany,activeBusinessUnit}=useAuth();
  const scopeKey=`${activeCompany?.company_id}/${activeBusinessUnit?.business_unit_id}`;
  const scopeRef=useRef(scopeKey);scopeRef.current=scopeKey;
  const submissionRef=useRef(false);
  const entryRequest=useRef<{key:string;id:string}|null>(null);
  const [entryPermissions,setEntryPermissions]=useState({master:false,owner:false,rate:false,rent:false,driver:false});

  const [tab,setTab]=useState<Tab>("trips");
  const [rows,setRows]=useState<Trip[]>([]);
  const [loading,setLoading]=useState(false);
  const [registerLoading,setRegisterLoading]=useState(false);
  const tripsGridRef=useRef<HTMLDivElement|null>(null);
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
      const width=Math.max(44,Math.round(startWidth+event.clientX-startX));
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
  const [showPartyReports,setShowPartyReports]=useState(false);

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
  const [registerMeta,setRegisterMeta]=useState<any>({count:0,totals:{},completed:0,paper_pending:0,statuses:[]});
  const readGeneration=useRef(0);
  const registerRequest=useRef<AbortController|null>(null);


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
  const [showBulkSupplierRent,setShowBulkSupplierRent]=useState(false);
  const [showBulkCustomerRate,setShowBulkCustomerRate]=useState(false);
  const [bulkSupplierRentTrip,setBulkSupplierRentTrip]=useState<Trip|null>(null);
  const [quickPprTrip,setQuickPprTrip]=useState<Trip|null>(null);
  const [quickPprEmployee,setQuickPprEmployee]=useState("");
  const [quickPprDate,setQuickPprDate]=useState(new Date().toISOString().slice(0,10));
  const [initialRateTrip,setInitialRateTrip]=useState<Trip|null>(null);
  const [editingRateLocks,setEditingRateLocks]=useState({customer:false,supplier:false});
  const [editingTripId,setEditingTripId]=useState<string|null>(null);
  const [editingTripNo,setEditingTripNo]=useState("");
  const [editingOriginalAssignment,setEditingOriginalAssignment]=useState({vehicle_id:"",driver_id:""});

  const [quickAdd,setQuickAdd]=useState<QuickAddKind|null>(null);
  const [bulkFixRowNo,setBulkFixRowNo]=useState<number|null>(null);
  const [quickSupplierId,setQuickSupplierId]=useState('');
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
      const current=bulkRows.find(row=>row.rowNo===bulkFixRowNo);
      if(current){const validated=await validateBulkMasters([current],true);setBulkRows(rows=>rows.map(row=>row.rowNo===bulkFixRowNo?validated[0]:row));}
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
    if(silent&&registerRequest.current)return;
    registerRequest.current?.abort();const controller=new AbortController();registerRequest.current=controller;
    const generation=++readGeneration.current;
    if(!silent)setRegisterLoading(true);setError('');
    try {
      const result=await supabase.rpc('transport_register_query',{p_limit:500,p_offset:page*500,p_filters:registerFilters,p_sort:sortColumn,p_direction:sortDirection}).abortSignal(controller.signal);
      if(result.error)throw result.error;
      if(scopeRef.current!==scopeKey||generation!==readGeneration.current)return;
      const data=result.data;
      setRows((data.rows??[]).map((r:any)=>({...r,truck_type:r.truck_type_name??r.truck_type})));
      setRegisterMeta(data);
      if(page>Math.max(0,Math.ceil(data.count/500)-1))setPage(Math.max(0,Math.ceil(data.count/500)-1));
    }catch(e:any){if(generation===readGeneration.current){setRows([]);setRegisterMeta({count:0,totals:{},completed:0,paper_pending:0,statuses:[]});setError(e?.message||'Unable to load trips.');}}
    finally{if(registerRequest.current===controller)registerRequest.current=null;if(generation===readGeneration.current)setRegisterLoading(false);}
  }
  const previousRegisterKey=useRef(registerKey);
  useEffect(()=>{
    const changed=previousRegisterKey.current!==registerKey;previousRegisterKey.current=registerKey;
    readGeneration.current++;setRows([]);setRegisterLoading(true);
    if(changed&&page!==0){setPage(0);return;}
    if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){setRegisterLoading(false);return;}
    const timer=window.setTimeout(()=>void load(),200);
    return()=>{window.clearTimeout(timer);registerRequest.current?.abort();registerRequest.current=null;readGeneration.current++;};
  },[registerKey,page]);

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
  const visibleStatusOptions=statusOptions.filter((option:any)=>!statusSearch||option.label.toLowerCase().includes(statusSearch.toLowerCase()));
  const completedTrips=registerMeta.completed??0;
  const paperPending=registerMeta.paper_pending??0;

  const resetFilters=()=>{
    setRegisterSearch("");
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
      // The grid owns its scrolling. Vertical wheel moves rows only;
      // horizontal/Shift+wheel moves columns only, never the page.
      const horizontal=event.shiftKey||Math.abs(event.deltaX)>Math.abs(event.deltaY);
      const delta=horizontal?(event.deltaX||event.deltaY):event.deltaY;
      if(!delta)return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if(horizontal)el.scrollLeft+=delta;
      else el.scrollTop+=delta;
    };

    el.addEventListener("wheel",onWheel,{passive:false,capture:true});
    return ()=>el.removeEventListener("wheel",onWheel,{capture:true});
  },[tab]);


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
      [...BUKU_TRIP_HEADERS],
      example
    ]);

    ws["!cols"]=BUKU_TRIP_HEADERS.map((header)=>({
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

    XLSX.writeFile(wb,"BuKu_Trip_Excel_Upload_template-NAVILO.xlsx");
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
      [...BUKU_TRIP_HEADERS,'Source Row','Validation Errors'],
      ...rejected.map(r=>[r.trip_date,r.truck_type,r.po_do_job_no,'',r.customer,r.driver,r.owner_supplier,r.vehicle,r.from_location,r.to_location,
        r.ppr_status==='received'?r.ppr_employee:r.ppr_status==='not_required'?'N/A':'PPR PENDING',r.ppr_date,'',r.supplier_rent,'','','',r.customer_rate,'','','','',r.source_invoice_no,r.sale_type,r.driver_pay,r.rowNo,r.errors.join('; ')])
    ]);
    XLSX.utils.book_append_sheet(workbook,sheet,'Rejected rows');XLSX.writeFile(workbook,'NAVILO-Trip-Import-Rejected.csv',{bookType:'csv'});
  };

  async function openQuickPpr(row:Trip){
    setError("");setLoading(true);
    try{await loadTripMasters();setQuickPprEmployee("");setQuickPprDate(new Date().toISOString().slice(0,10));setQuickPprTrip(row);}
    catch(e:any){setError(e?.message||"Unable to load PPR employees.");}finally{setLoading(false);}
  }
  async function saveQuickPpr(){
    if(!quickPprTrip||!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id)return;
    if(!quickPprEmployee||!quickPprDate){setError("Select Received By employee and PPR date.");return;}
    setLoading(true);setError("");
    try{
      const {data,error}=await supabase.from("transport_trips")
        .update({ppr_status:"received",ppr_received_by_employee_id:quickPprEmployee,ppr_received_date:quickPprDate})
        .eq("id",quickPprTrip.id).eq("company_id",activeCompany.company_id).eq("business_unit_id",activeBusinessUnit.business_unit_id)
        .eq("ppr_status","pending").select("id").single();
      if(error)throw error;if(!data)throw new Error("PPR is no longer pending.");
      setQuickPprTrip(null);setQuickPprEmployee("");await load();
    }catch(e:any){setError(e?.message||"Unable to receive PPR.");}finally{setLoading(false);}
  }

  async function startEditTrip(row:Trip){
    setLoading(true);
    setError("");
    try{
      await loadTripMasters();
      const {data,error}=await supabase
        .from("transport_trips")
        .select("id,trip_no,trip_date,customer_id,customer_name_snapshot,truck_type_id,vehicle_id,driver_id,from_location,to_location,po_do_job_no,ppr_status,ppr_received_date,ppr_received_by_employee_id,ppr_attachment_path,customer_rate,owner_rent,driver_pay,notes,sale_type")
        .eq("id",row.id)
        .eq("company_id",activeCompany?.company_id)
        .eq("business_unit_id",activeBusinessUnit?.business_unit_id)
        .single();
      if(error)throw error;

      const savedRents=await fetchAllPages<any>((start,end)=>supabase.from('transport_trip_supplier_rents').select('id,amount,finalized_amount_snapshot').eq('company_id',activeCompany?.company_id).eq('business_unit_id',activeBusinessUnit?.business_unit_id).eq('trip_id',data.id).order('id').range(start,end));
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
      const {data,error}=await supabase.from('transport_trips').update({ppr_attachment_path:path}).eq('id',editingTripId).eq('company_id',activeCompany.company_id).eq('business_unit_id',activeBusinessUnit.business_unit_id).eq('ppr_status','received').select('id').single();
      if(error||!data){await supabase.storage.from('transport-ppr').remove([path]);throw error||new Error('Save the Received employee and date before attaching PPR.');}
      setForm(previous=>({...previous,ppr_attachment_path:path}));await load();
    }catch(e:any){setError(e?.message||'Unable to attach PPR.')}finally{setLoading(false)}
  }
  async function openPpr(){
    try{const {data,error}=await supabase.storage.from('transport-ppr').createSignedUrl(form.ppr_attachment_path,60);if(error)throw error;window.open(data.signedUrl,'_blank','noopener,noreferrer')}catch(e:any){setError(e?.message||'Unable to open PPR.')}
  }
  async function updateTrip(){
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
      const payload={
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

      const assignmentChanged=
        form.vehicle_id!==editingOriginalAssignment.vehicle_id ||
        form.driver_id!==editingOriginalAssignment.driver_id;

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

      const safePayload={...payload};
      delete (safePayload as any).vehicle_id;
      delete (safePayload as any).driver_id;
      delete (safePayload as any).owner_name_snapshot;
      if(editingRateLocks.supplier)delete (safePayload as any).owner_rent;
      if(editingRateLocks.customer){
        delete (safePayload as any).customer_rate;
        delete (safePayload as any).customer_id;
        delete (safePayload as any).sale_type;
      }

      const {error}=await supabase.from("transport_trips")
        .update(safePayload)
        .eq("id",editingTripId)
        .eq("company_id",activeCompany.company_id)
        .eq("business_unit_id",activeBusinessUnit.business_unit_id);
      if(error)throw error;

      setEditingTripId(null);
      setEditingTripNo("");
      setEditingOriginalAssignment({vehicle_id:"",driver_id:""});
      setTab("trips");
      await load();
    }catch(e:any){
      setError(e?.message||"Unable to update Trip.");
    }finally{
      setLoading(false);
    }
  }
  async function createTrip(){
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
      setRateTouched(false);setEditingTripId(null);setTab('trips');await load();
    }catch(e:any){setError(e.message||'Unable to create Trip.')}
    finally{submissionRef.current=false;setLoading(false)}
  }

  const tripHasPostedAccounting=(r:Trip)=>Boolean(r.customer_rate_locked||r.supplier_rate_locked||r.invoiced||Number(r.billed_customer_net??0)>0||Number(r.billed_supplier_net??0)>0);

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
      case "paper_received_by": return r.ppr_status==="received"?[String(r.ppr_received_by_name??"—"),r.ppr_received_date?formatNaviloDate(r.ppr_received_date):""].filter(Boolean).join(" · "):"Pending";
      case "supplier_paid": return financialNumber(r.supplier_paid_net??r.supplier_paid_gross??0);
      case "supplier_balance": return financialNumber(Math.max(0,Number(r.supplier_outstanding_gross??r.remaining_with_us??0)));
      case "supplier_credit": return financialNumber(Math.max(0,Number(r.supplier_credit_gross??0)));
      case "customer_credit": return financialNumber(Math.max(0,Number(r.customer_credit_gross??0)));
      case "driver_pay": return financialNumber(r.driver_accrued??r.driver_pay);
      case "driver_paid": return financialNumber(r.driver_paid??0);
      case "driver_balance": return financialNumber(r.driver_outstanding??0);
      case "rent_driver": return financialNumber(r.billed_supplier_net??r.supplier_rent??r.owner_rent);
      case "remaining_us": return financialNumber(r.remaining_with_us??0);
      case "payment_date": return r.payment_date?formatNaviloDate(r.payment_date):"";
      case "amount": return financialNumber(r.payment_amount??0);
      case "company_rate": return financialNumber(r.billed_customer_net??r.customer_rate);
      case "received_company": return financialNumber(r.received_from_company??0);
      case "remaining_company": return financialNumber(Math.max(0,Number(r.customer_outstanding_gross??r.remaining_with_company??0)));
      case "profit": return financialNumber(r.trip_profit??0);
      case "commission": return financialNumber(r.commission_paid_net??0);
      case "invoice_no": return String(r.invoice_no??"");
      case "sale_type": return String(r.sale_type??"");
      default:return "";
    }
  };

  const supplierGridKeys=["owner","rent_driver","supplier_paid","supplier_balance","supplier_credit","payment_date","amount"] as const;
  const customerGridKeys=["company","company_rate","received_company","remaining_company","customer_credit","invoice_no","sale_type"] as const;
  const isSupplierGridKey=(key:string)=>(supplierGridKeys as readonly string[]).includes(key);
  const isCustomerGridKey=(key:string)=>(customerGridKeys as readonly string[]).includes(key);

  const gridColumns:ReadonlyArray<readonly [string,string]>=[
    ["trip_no","Trip No"],
    ["trip_date","Date"],
    ["truck_type","Truck Type"],
    ["job_no","PO/DO/Job No."],
    ["company","Company Name"],
    ["driver","Driver Name"],
    ["owner","Owner"],
    ["plate","Plate #"],
    ["from","From"],
    ["to","To"],
    ["paper_received_by","PPR Received By"],
    ["rent_driver","Supplier Rent"],
    ["supplier_paid","Supplier Paid"],
    ["supplier_balance","Supplier Balance"],
    ["supplier_credit","Supplier Credit / Advance"],
    ["driver_pay","Driver Pay"],
    ["driver_paid","Driver Paid"],
    ["driver_balance","Driver Balance"],
    ["payment_date","Payment Date"],
    ["amount","Amount"],
    ["company_rate","Rate With Company"],
    ["received_company","Received From Company"],
    ["remaining_company","Remaining With Company"],
    ["customer_credit","Customer Credit / Advance"],
    ["profit","Profit"],
    ["commission","Paid Commission For Trip"],
    ["invoice_no","Invoice Number"],
    ["sale_type","Sale Type"]
  ] as const;

  const tripGridStorageKey=`navilo:transport:trip-grid:${user?.id??"user"}:${activeCompany?.company_id??"company"}:${activeBusinessUnit?.business_unit_id??"unit"}`;
  const orderedGridColumns=useMemo(()=>{
    const byKey=new Map(gridColumns.map(column=>[column[0],column] as const));
    const order=tripColumnOrder.length?tripColumnOrder:gridColumns.map(column=>column[0]);
    const arranged=order.map(key=>byKey.get(key)).filter((column):column is readonly [string,string]=>Boolean(column));
    for(const column of gridColumns)if(!arranged.some(item=>item[0]===column[0]))arranged.push(column);
    return arranged.filter(column=>!hiddenTripColumns.includes(column[0]));
  },[tripColumnOrder,hiddenTripColumns]);

  useEffect(()=>{
    try{
      const saved=localStorage.getItem(tripGridStorageKey);
      if(!saved){setTripColumnOrder([]);setHiddenTripColumns([]);setTripColumnWidths({});return;}
      const parsed=JSON.parse(saved);
      setTripColumnOrder(Array.isArray(parsed.order)?parsed.order:[]);
      setHiddenTripColumns(Array.isArray(parsed.hidden)?parsed.hidden:[]);
      setTripColumnWidths(parsed.widths&&typeof parsed.widths==="object"?parsed.widths:{});
    }catch{
      setTripColumnOrder([]);
      setHiddenTripColumns([]);
      setTripColumnWidths({});
    }
  },[tripGridStorageKey]);

  const supplierDataVisible=supplierGridKeys.some(key=>!hiddenTripColumns.includes(key));
  const customerDataVisible=customerGridKeys.some(key=>!hiddenTripColumns.includes(key));
  const setGridGroupVisible=(keys:readonly string[],show:boolean)=>{
    setHiddenTripColumns(current=>show
      ?current.filter(key=>!keys.includes(key))
      :Array.from(new Set([...current,...keys])));
  };

  const saveTripGridLayout=()=>{
    localStorage.setItem(tripGridStorageKey,JSON.stringify({
      order:tripColumnOrder.length?tripColumnOrder:gridColumns.map(column=>column[0]),
      hidden:hiddenTripColumns,
      widths:tripColumnWidths
    }));
    setShowTripColumnSetup(false);
  };

  const resetTripGridLayout=()=>{
    localStorage.removeItem(tripGridStorageKey);
    setTripColumnOrder([]);
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
    let live=true;setColumnValues([]);if(!openColumnFilter)return;
    setColumnValuesLoading(true);
    const timer=window.setTimeout(()=>{
      void (async()=>{try{const r=await supabase.rpc('transport_register_query',{p_filters:registerFilters,p_option_key:openColumnFilter,p_option_search:columnSearch});if(!live)return;if(r.error){setError(r.error.message);return;}setColumnValues(r.data.options??[]);}finally{if(live)setColumnValuesLoading(false)}})();
    },200);
    return()=>{live=false;window.clearTimeout(timer)};
  },[openColumnFilter,columnSearch,registerKey]);
  const columnOptions=(_key:string)=>columnValues;
  const gridRows=rows;
  const amountGridKeys=new Set(['rent_driver','supplier_paid','supplier_balance','supplier_credit','driver_pay','driver_paid','driver_balance','amount','company_rate','received_company','remaining_company','customer_credit','profit','commission']);
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

  return <div className="mx-auto w-full max-w-[1800px] space-y-1 p-1.5">


    <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
      <nav className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto" aria-label="Transport workspace">
        {tabs.map(t=>{const I=t.icon;return <button key={t.key} onClick={()=>{setError("");setTab(t.key)}} className={`flex min-w-max items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${tab===t.key?"bg-slate-900 text-white":"text-slate-600 hover:bg-slate-100"}`}><I className="h-3.5 w-3.5"/>{t.label}</button>})}
      </nav>


    </div>

    {!showPartyReports&&<button className="btn" onClick={()=>setShowPartyReports(true)}>Customer / Supplier Reports and Bulk Allocation</button>}
    {showPartyReports&&<TransportPartyReports key={`${activeCompany?.company_id}:${activeBusinessUnit?.business_unit_id}`} onClose={()=>setShowPartyReports(false)} onChanged={load}/>}

    {error&&<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

    {tab==="trips"&&<section className="relative flex h-[calc(100vh-205px)] min-h-[360px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm" data-navilo-customizable="true">
      <div className="relative z-[80] shrink-0 border-b border-slate-200 bg-white px-1.5 py-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex h-7 min-w-[92px] items-center justify-between rounded-md border border-cyan-200 bg-cyan-50 px-2">
            <span className="text-[9px] font-bold uppercase text-cyan-700">Total Trips</span>
            <span className="text-sm font-bold text-slate-950">{Number(registerMeta.count??0).toLocaleString()}</span>
          </div>

          <div className="flex h-7 min-w-[100px] items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-2">
            <span className="text-[9px] font-bold uppercase text-emerald-700">Completed</span>
            <span className="text-sm font-bold text-slate-950">{completedTrips.toLocaleString()}</span>
          </div>

          <div className="flex h-7 min-w-[108px] items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-2">
            <span className="text-[9px] font-bold uppercase text-amber-700">Paper Pending</span>
            <span className="text-sm font-bold text-slate-950">{paperPending.toLocaleString()}</span>
          </div>

          <div className="relative">
            <button type="button" onClick={()=>setStatusOpen(v=>!v)} className="flex h-7 min-w-[190px] items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700">
              <span>Status</span><span className="max-w-[135px] truncate text-slate-900">{statusFilters.length===0?"All Statuses":statusFilters.length===1?(statusOptions.find(option=>option.key===statusFilters[0])?.label??"1 selected"):`${statusFilters.length} selected`}</span>
              <span aria-hidden>⌄</span>
            </button>
            {statusOpen&&<div className="absolute left-0 top-8 z-[100] w-[240px] overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xl">
              <div className="border-b border-slate-100 p-1.5">
                <input autoFocus className="input h-7 w-full px-2 text-[11px]" placeholder="Search status..." value={statusSearch} onChange={e=>setStatusSearch(e.target.value)}/>
              </div>
              <div className="max-h-44 overflow-y-auto p-1">
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[10px] font-semibold hover:bg-slate-50">
                  <input type="checkbox" checked={statusFilters.length===0} onChange={()=>setStatusFilters([])}/>
                  <span>All Statuses</span>
                </label>
                {visibleStatusOptions.map(option=><label key={option.key} className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[10px] hover:bg-slate-50 ${statusFilters.includes(option.key)?"bg-blue-50 font-bold text-blue-800":""}`}>
                  <input type="checkbox" checked={statusFilters.includes(option.key)} onChange={()=>setStatusFilters(current=>current.includes(option.key)?current.filter(key=>key!==option.key):[...current,option.key])}/>
                  <span>{option.label}</span>
                </label>)}
                {visibleStatusOptions.length===0&&<div className="px-2 py-2 text-[10px] text-slate-500">No matching status</div>}
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-2 py-1">
                <button type="button" className="text-[9px] font-semibold text-slate-600 hover:text-slate-900" onClick={()=>setStatusFilters([])}>Clear</button>
                <button type="button" className="rounded bg-slate-900 px-2 py-1 text-[9px] font-semibold text-white" onClick={()=>{setStatusSearch("");setStatusOpen(false)}}>Done</button>
              </div>
            </div>}
          </div>

          <input aria-label="Search all Trips" placeholder="Trip / job / invoice / customer" className="input h-7 w-52 text-[11px]" value={registerSearch} onChange={e=>setRegisterSearch(e.target.value)}/>
          <button type="button" onClick={resetGrid}
            className="h-7 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
            Reset
          </button>

          <button type="button" onClick={()=>void load()} disabled={registerLoading}
            className="flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-3.5 w-3.5"/>
            Refresh
          </button>
          <button type="button" onClick={()=>setShowBulkSupplierRent(true)}
            className="h-7 rounded-md border border-amber-200 bg-amber-50 px-2.5 text-[10px] font-bold text-amber-800 hover:bg-amber-100">
            Bulk Supplier Rent
          </button><button type="button" onClick={()=>setShowBulkCustomerRate(true)} className="rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold text-blue-800 hover:bg-blue-100">Bulk Customer Rate</button>
          <button type="button" onClick={()=>setShowTripColumnSetup(v=>!v)}
            className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50">
            Columns
          </button>

        </div>

        {showTripColumnSetup&&<div className="mb-1 rounded-md border border-slate-200 bg-slate-50 p-1.5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-slate-700">Trip columns — drag to reorder, tick to show</span>
            <div className="flex gap-1">
              <button type="button" onClick={resetTripGridLayout} className="h-5 rounded border bg-white px-2 text-[9px] font-semibold">Reset Default</button>
              <button type="button" onClick={saveTripGridLayout} className="h-5 rounded border border-blue-200 bg-blue-50 px-2 text-[9px] font-semibold text-blue-700">Save as Default</button>
            </div>
          </div>
          <div className="mb-1 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1">
            <label className="inline-flex cursor-pointer items-center gap-1 text-[9px] font-bold text-amber-800">
              <input type="checkbox" checked={supplierDataVisible}
                onChange={e=>setGridGroupVisible(supplierGridKeys,e.target.checked)}/>
              Show Supplier Data
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1 text-[9px] font-bold text-blue-800">
              <input type="checkbox" checked={customerDataVisible}
                onChange={e=>setGridGroupVisible(customerGridKeys,e.target.checked)}/>
              Show Customer Data
            </label>
            <span className="text-[9px] text-slate-500">Hide either group to keep the Trips dashboard compact.</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {(tripColumnOrder.length?tripColumnOrder:gridColumns.map(column=>column[0])).map(key=>{
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

        <div className="flex h-3.5 items-center justify-end text-[9px] font-semibold text-slate-600">
          {gridRows.length.toLocaleString()} shown / {Number(registerMeta.count??0).toLocaleString()} filtered trips
        </div>
      </div>
      {registerLoading&&<p role="status" className="shrink-0 px-2 text-[11px] text-blue-700">Loading filtered totals and page…</p>}
      <div
        ref={tripsGridRef}
        className="min-h-0 flex-1 overscroll-contain overflow-auto border-t border-slate-200 bg-white"
      >
        <table className="w-max min-w-full table-auto whitespace-nowrap text-[8px] leading-none">
          <caption className="sr-only">Trips register. Summary filters and column headers remain fixed while trip rows scroll.</caption>
          <thead className="sticky top-0 z-40 bg-slate-50 text-left text-[8px] uppercase tracking-normal text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.12)]">
            <tr>
              {orderedGridColumns.map(([key,label],i)=>{
                const active=(columnFilters[key]?.length??0)>0;
                const sorted=sortColumn===key;
                const columnWidth=tripColumnWidths[key];

                return <th key={key}
                  style={columnWidth?{width:columnWidth,minWidth:columnWidth,maxWidth:columnWidth}:undefined}
                  className={`sticky top-0 h-[17px] border-b border-r border-slate-200 px-0.5 !py-0 font-bold leading-none ${isSupplierGridKey(key)?"bg-amber-50 text-amber-900":isCustomerGridKey(key)?"bg-blue-50 text-blue-900":"bg-slate-50"} ${i===0?"!sticky left-0 top-0 z-[60] shadow-[2px_0_3px_rgba(15,23,42,0.10)]":"z-40"}`}>
                  <div className="flex h-[17px] w-full min-w-0 items-center gap-0.5">
                    <button type="button"
                      title={sorted?"Clear sort":`Sort by ${label}`}
                      onClick={()=>{
                        if(sorted){setSortColumn("");setSortDirection("asc");}
                        else{setSortColumn(key);setSortDirection("asc");}
                        setOpenColumnFilter(null);
                      }}
                      className={`flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden rounded px-0.5 py-0 text-left leading-none hover:bg-slate-200 ${sorted?"text-blue-700":""}`}>
                      <span className="overflow-hidden text-ellipsis">{label}{amountGridKeys.has(key)&&<span className="ml-1 font-extrabold text-slate-950">· {financialNumber(gridTotal(key))}</span>}</span>
                      {sorted&&<span className="shrink-0 text-[7px]" aria-label="Sorted ascending">▲</span>}
                    </button>
                    <button type="button"
                      title={active?"Filter active":"Filter"}
                      aria-label={active?`Filter active for ${label}`:`Filter ${label}`}
                      onClick={e=>{
                        e.stopPropagation();
                        if(openColumnFilter===key){setOpenColumnFilter(null);return;}
                        const rect=e.currentTarget.getBoundingClientRect();
                        const width=160,gap=8;
                        let left=Math.max(gap,rect.right-width);
                        if(left+width>window.innerWidth-gap)left=Math.max(gap,window.innerWidth-width-gap);
                        let top=rect.bottom+4;
                        if(top+260>window.innerHeight-gap)top=Math.max(gap,rect.top-260);
                        setColumnMenuPosition({top,left});
                        setOpenColumnFilter(key);
                      }}
                      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-slate-200 ${active?"text-blue-700":"text-slate-400"}`}>
                      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" aria-hidden="true">
                        <path d="M1.5 2h9L7 6v3L5 10V6L1.5 2Z" fill="currentColor"/>
                      </svg>
                    </button>
                  </div>

                  <div
                    role="separator"
                    aria-orientation="vertical"
                    title={`Resize ${label}`}
                    onMouseDown={e=>startTripColumnResize(e,key)}
                    className="absolute -right-[2px] top-0 z-40 h-full w-[5px] cursor-col-resize select-none border-r border-slate-300 hover:border-blue-500 hover:bg-blue-100"
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
            {gridRows.map(r=><tr key={r.id} className="h-[17px] align-middle hover:bg-slate-50">
              <td
                style={tripColumnWidths[orderedGridColumns[0]?.[0]??""]?{width:tripColumnWidths[orderedGridColumns[0]?.[0]??""],minWidth:tripColumnWidths[orderedGridColumns[0]?.[0]??""],maxWidth:tripColumnWidths[orderedGridColumns[0]?.[0]??""]}:undefined}
                className="!sticky left-0 z-30 h-[17px] max-h-[17px] overflow-hidden whitespace-nowrap border-b border-r border-slate-200 bg-white px-0.5 !py-0 font-bold leading-none text-slate-900 shadow-[2px_0_3px_rgba(15,23,42,0.08)]">
  <button type="button" title="Edit Trip" onClick={()=>void startEditTrip(r)}
    className="font-bold leading-none text-blue-700 underline-offset-2 hover:underline">
    {r.trip_no}
  </button>
  {tripHasPostedAccounting(r)&&<span title="Locked: posted accounting exists. Financial party/rate changes require controlled correction." aria-label={`Locked ${r.trip_no}`} className="ml-0.5 inline-flex align-middle text-amber-700"><LockKeyhole className="h-2.5 w-2.5"/></span>}
  <span title={`Trip status: ${r.status??"Unknown"}`} aria-label={`Trip status ${r.status??"Unknown"}`} className="ml-0.5 inline-flex h-3 w-3 items-center justify-center align-middle text-[9px] font-bold leading-none text-slate-500">{["complete","completed","closed"].includes(String(r.status??"").toLowerCase())?"✓":["cancelled","canceled"].includes(String(r.status??"").toLowerCase())?"×":["draft"].includes(String(r.status??"").toLowerCase())?"○":"◐"}</span>
</td>

              {/* BuKu operational register order - one canonical mapping for display/filter/sort */}
              {orderedGridColumns.slice(1).map(([key])=>{
                const value=tripCellValue(r,key);
                const numeric=["rent_driver","supplier_paid","supplier_balance","driver_pay","driver_paid","driver_balance","amount","company_rate","received_company","remaining_company","profit","commission"].includes(key);
                const columnWidth=tripColumnWidths[key];
                return <td key={key}
                  style={columnWidth?{width:columnWidth,minWidth:columnWidth,maxWidth:columnWidth}:undefined}
                  className={`h-[17px] max-h-[17px] overflow-hidden text-ellipsis whitespace-nowrap border-b border-slate-100 px-0.5 !py-0 leading-none ${isSupplierGridKey(key)?"bg-amber-50/40":isCustomerGridKey(key)?"bg-blue-50/40":""} ${numeric?"text-right":""}`}>
                  {key==='company_rate'&&r.customer_rate_state==='pending'&&!r.customer_rate_locked
                    ?<button className="h-[14px] rounded border border-blue-200 px-0.5 py-0 text-[8px] leading-none text-blue-700" aria-label={`Add Rate ${r.trip_no}`} onClick={()=>setInitialRateTrip(r)}>Add Rate</button>
                    :key==='rent_driver'&&r.customer_rate_state!==undefined&&Number(r.billed_supplier_net??r.supplier_rent??r.owner_rent??0)<=0
                      ?<button className="h-[14px] rounded border border-amber-300 bg-amber-50 px-1 py-0 text-[8px] font-semibold leading-none text-amber-800" aria-label={`Add Rent ${r.trip_no}`} onClick={()=>{setBulkSupplierRentTrip(r);setShowBulkSupplierRent(true)}}>Add Rent</button>
                    :key==='paper_received_by'
                      ?r.ppr_status==='received'
                        ?<span className="inline-flex items-baseline gap-1"><span>{r.ppr_received_by_name||"—"}</span>{r.ppr_received_date&&<span className="text-[7px] text-slate-500">{formatNaviloDate(r.ppr_received_date)}</span>}</span>
                        :<button type="button" onClick={()=>void openQuickPpr(r)} className="h-[14px] rounded border border-amber-300 bg-amber-50 px-1 py-0 text-[8px] font-semibold leading-none text-amber-800">Receive PPR</button>
                      :value||""}
                </td>;
              })}            </tr>)}
          </tbody>
        </table>
      </div>

      
      <TransportPagination page={page} pageSize={500} count={Number(registerMeta.count??0)} busy={registerLoading} onPage={setPage}/>
      <p className="shrink-0 px-2 text-[10px] text-slate-500">Header totals cover all filtered Trips, across every page.</p>
      {!registerLoading&&!visible.length&&<div className="p-10 text-center text-sm text-slate-500">No trips found.</div>}
    </section>}

    {tab==="new"&&
<section className="rounded-xl border border-slate-200 bg-white shadow-sm">

  <div className="border-b border-slate-200">
    <div className="px-4 pb-2 pt-3">
      <h2 className="font-bold text-slate-950">
        {editingTripId?<span className="inline-flex items-center gap-1.5">Edit Trip - {editingTripNo}{(editingRateLocks.customer||editingRateLocks.supplier)&&<span title="Locked: posted accounting exists. Operational fields remain editable; posted financial identity/rates require controlled correction." className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"><LockKeyhole className="h-3 w-3"/>Locked</span>}</span>:"New Trip"}
      </h2>

      <p className="text-xs text-slate-500">
        {editingTripId?"Trip No and Trip Date are permanent. Operational fields below remain editable; posted financial fields stay protected.":"Trip number is generated automatically by NAVILO."}
      </p>
    </div>

    {!editingTripId&&<div className="flex items-center gap-1 px-4 pb-3">
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


  {newTripMode==='historical'&&<TransportHistoricalImport key={importScope} validateMasters={rows=>validateBulkMasters(rows,true)} onChanged={load}/>}

  {newTripMode==="single"&&
  <div className="p-3">
    <div className="overflow-visible rounded-lg border border-blue-300 bg-white">
      <div className="grid grid-cols-1 border-b border-slate-300 md:grid-cols-2 xl:grid-cols-7">
        <TripField label="Date">
          <NaviloDateInput aria-label="Trip Date" type="date" disabled={Boolean(editingTripId)} value={form.trip_date}
            onChange={e=>{setError("");setForm({...form,trip_date:e.target.value})}}
            className="h-8 w-full border-0 bg-white px-2 text-xs outline-none"/>
        </TripField>

        <TripField label="Truck Type" onAdd={entryPermissions.master?()=>openQuickAdd("truckType"):undefined}>
          <SearchMasterInput value={tripMasters.truckTypes.find((r:any)=>r.id===form.truck_type_id)?.name||""}
            options={tripMasters.truckTypes.map((r:any)=>({value:r.id,label:r.name}))}
            placeholder="Search Truck Type"
            onSelect={truckTypeId=>{
              const vehicle=tripMasters.vehicles.find((v:any)=>v.id===form.vehicle_id);
              setError("");
              setForm({...form,truck_type_id:truckTypeId,vehicle_id:vehicle&&truckTypeId&&vehicle.truck_type_id!==truckTypeId?"":form.vehicle_id});
            }}/>
        </TripField>

        <TripField label="PO/DO/Job No.">
          <input value={form.po_do_job_no}
            onChange={e=>{setError("");setForm({...form,po_do_job_no:e.target.value})}}
            className="h-8 w-full border-0 bg-white px-2 text-xs outline-none"/>
        </TripField>

        <TripField label="Customer" onAdd={entryPermissions.master?()=>openQuickAdd("customer"):undefined}>
          <SearchMasterInput value={tripMasters.customers.find((r:any)=>r.id===form.customer_id)?.name||""}
            options={tripMasters.customers.map((r:any)=>({value:r.id,label:r.name}))}
            placeholder="Search Customer"
            disabled={Boolean(editingTripId&&editingRateLocks.customer)}
            onSelect={customerId=>{
              const customer=tripMasters.customers.find((r:any)=>r.id===customerId);
              setError("");
              setForm({...form,customer_id:customerId,customer_name_snapshot:customer?.name||""});
            }}/>
        </TripField>

        <TripField label="Driver Name" onAdd={entryPermissions.master?()=>openQuickAdd("driver"):undefined}>
          <SearchMasterInput value={selectedDriver?.driver_name||""}
            options={tripMasters.drivers.map((r:any)=>({value:r.id,label:r.driver_name}))}
            placeholder="Search Driver"
            onSelect={driverId=>{setError("");setForm({...form,driver_id:driverId})}}/>
        </TripField>

        <TripField label="Owner / Supplier" onAdd={entryPermissions.master?()=>openQuickAdd('supplier'):undefined}>
          <input aria-label="Trip Owner / Supplier" readOnly value={ownerDisplay} placeholder={form.vehicle_id?'No ownership for Trip Date':'Select Plate first'} className="h-8 w-full border-0 px-2 text-xs"/>
          <a className="px-2 text-[10px] text-blue-700 underline" href="/master-data/vehicle-ownership">Vehicle Ownership History</a>
          {quickSupplierId&&<small className="block px-2">Supplier selected: {tripMasters.suppliers.find(s=>s.id===quickSupplierId)?.name}. Available for new Vehicle / dated ownership.</small>}
        </TripField>

        <TripField label="Plate #" onAdd={entryPermissions.master&&entryPermissions.owner?()=>openQuickAdd("vehicle"):undefined}>
          <SearchMasterInput value={selectedVehicle
              ? `${selectedVehicle.vehicle_no}${ownerDisplay?` - ${ownerDisplay}`:""}`
              : ""}
            options={vehicleChoices.map((r:any)=>{
              const owner=ownershipOnDate(tripMasters.ownership,r.id,form.trip_date)?.owner_name_snapshot||"";
              return {value:r.id,label:owner?`${r.vehicle_no} - ${owner}`:r.vehicle_no};
            })}
            placeholder="Search Plate"
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

        <TripField label="From" onAdd={entryPermissions.master?()=>openQuickAdd("locationFrom"):undefined}>
          <SearchMasterInput value={form.from_location}
            options={tripMasters.locations.map((r:any)=>({value:r.id,label:r.name}))}
            placeholder="Search From"
            onSelect={locationId=>{
              const location=tripMasters.locations.find((r:any)=>r.id===locationId);
              setError("");
              setForm({...form,from_location:location?.name||""});
            }}/>
        </TripField>

        <TripField label="To" onAdd={entryPermissions.master?()=>openQuickAdd("locationTo"):undefined}>
          <SearchMasterInput value={form.to_location}
            options={tripMasters.locations.map((r:any)=>({value:r.id,label:r.name}))}
            placeholder="Search To"
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
          <input type="number" min="0" step="0.01" aria-label="Supplier / Owner Rent" readOnly={Boolean(editingTripId)||!entryPermissions.rent||!supplierOwned} title={editingTripId?"Rent is a financial field. Use Bulk Supplier Rent / Finance for unposted changes or correction after posting.":""} value={form.supplier_rent}
            onChange={e=>{setError("");setForm({...form,supplier_rent:e.target.value})}}
            className="h-8 w-full border-0 bg-white px-2 text-right text-xs outline-none"/>
        </TripField>

        <TripField label="Customer Rate">
          <input type="number" min="0" step="0.01" aria-label="Customer Rate" readOnly={Boolean(editingTripId)||!entryPermissions.rate} title={editingTripId?"Customer Rate is a financial field. Use Finance for controlled changes.":""} value={form.customer_rate}
            onChange={e=>{setRateTouched(true);setError("");setForm({...form,customer_rate:e.target.value})}}
            className="h-8 w-full border-0 bg-white px-2 text-right text-xs outline-none"/>
        </TripField>

        <TripField label="Driver Pay">
          <input aria-label="Driver Pay" type="number" min="0" step="0.01" readOnly={Boolean(editingTripId)||!entryPermissions.driver} value={form.driver_pay} onChange={e=>setForm({...form,driver_pay:e.target.value})} className="h-8 w-full border-0 px-2 text-right text-xs"/>
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
        <select aria-label="Sale Type" disabled={Boolean(editingTripId&&editingRateLocks.customer)} value={form.sale_type}
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
        <button className="btn" onClick={()=>{setError("");setEditingTripId(null);setEditingTripNo("");setEditingOriginalAssignment({vehicle_id:"",driver_id:""});setTab("trips")}}>Cancel</button>
        <button className="btn-primary" onClick={()=>void (editingTripId?updateTrip():createTrip())} disabled={loading}>
          {loading?(editingTripId?"Saving...":"Creating..."):(editingTripId?"Save Changes":"Create Trip")}
        </button>
      </div>
    </div>

    {quickAdd&&<TransportQuickAdd key={`${scopeKey}/${quickAdd}`} kind={quickAdd} truckTypeId={form.truck_type_id} supplierId={quickSupplierId}
      truckTypes={tripMasters.truckTypes} suppliers={tripMasters.suppliers} onCreated={quickMasterCreated} onClose={()=>setQuickAdd(null)}/>}

  </div>
  }

  {newTripMode==="bulk"&&
  <div className="space-y-3 p-4">

    {quickAdd&&bulkFixRowNo!==null&&<TransportQuickAdd key={`${scopeKey}/bulk/${bulkFixRowNo}/${quickAdd}`} kind={quickAdd} truckTypeId={String((bulkRows.find(r=>r.rowNo===bulkFixRowNo)?.payload as any)?.truck_type_id??"")} supplierId={quickSupplierId}
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

        Select BuKu Excel / CSV

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
          Download the BuKu-format template, complete the Trips rows, then upload XLSM, XLSX, XLS or CSV for validation.
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
              <tr
                key={row.rowNo}
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
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-semibold text-red-800">Fix rejected row:</span>
                      {row.errors.map((message,index)=><span key={index} className="rounded border border-red-200 bg-white px-2 py-1 text-red-700">{message}</span>)}
                      {entryPermissions.master&&row.errors.some(e=>e.startsWith('Customer is missing'))&&<button className="btn" onClick={()=>{setBulkFixRowNo(row.rowNo);openQuickAdd('customer')}}>+ Customer</button>}
                      {entryPermissions.master&&row.errors.some(e=>e.startsWith('Driver is missing'))&&<button className="btn" onClick={()=>{setBulkFixRowNo(row.rowNo);openQuickAdd('driver')}}>+ Driver</button>}
                      {entryPermissions.master&&row.errors.some(e=>e.startsWith('From is missing'))&&<button className="btn" onClick={()=>{setBulkFixRowNo(row.rowNo);openQuickAdd('locationFrom')}}>+ From</button>}
                      {entryPermissions.master&&row.errors.some(e=>e.startsWith('To is missing'))&&<button className="btn" onClick={()=>{setBulkFixRowNo(row.rowNo);openQuickAdd('locationTo')}}>+ To</button>}
                      {entryPermissions.master&&row.errors.some(e=>e.startsWith('Truck Type is missing'))&&<button className="btn" onClick={()=>{setBulkFixRowNo(row.rowNo);openQuickAdd('truckType')}}>+ Truck Type</button>}
                      {entryPermissions.master&&entryPermissions.owner&&row.errors.some(e=>e.startsWith('Vehicle is missing'))&&<button className="btn" onClick={()=>{setBulkFixRowNo(row.rowNo);openQuickAdd('vehicle')}}>+ Vehicle</button>}
                      <button className="btn" disabled={bulkValidating} onClick={async()=>{const validated=await validateBulkMasters([row],true);setBulkRows(rows=>rows.map(item=>item.rowNo===row.rowNo?validated[0]:item));}}>Re-validate</button>
                    </div>
                  </td>
                </tr>}
            )}

          </tbody>

        </table>

      </div>


      <TransportPagination page={bulkPreviewPage} pageSize={100} count={bulkRows.length} busy={bulkParsing||bulkValidating} onPage={setBulkPreviewPage}/>
      <div className="flex items-center justify-between gap-3">

        <span className="text-xs text-slate-500">
          Preview shows 100 rows per page. Payments, balances and profit from Excel are not posted.
        </span>

        <button
                  type="button"
                  onClick={()=>void importValidBulkRows()}
                  disabled={
                    bulkImporting||
                    bulkParsing||
                    bulkValidating||
                    !bulkRows.some(row=>row.errors.length===0)
                  }
                  className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-50"
                  title={
                    bulkRows.some(row=>row.errors.length===0)
                      ?"Import rows that passed all validations"
                      :"No valid rows available to import"
                  }
                >
                  {bulkImporting
                    ?"Importing..."
                    :"Import Valid Rows ("+
                      bulkRows.filter(row=>row.errors.length===0).length+
                      ")"}
                </button>

      </div>

    </>}

  </div>
  }

</section>}

    {tab==="audit"&&<TransportAudit trips={rows}/>}
    {tab==="driver-expenses"&&<TransportCostUpload trips={rows} onChanged={load}/> }
    {tab==="driver-account"&&<TransportAccountRows title="Driver Account / Hisaab" kind="driver"/> }
    {tab==="vehicle-account"&&<TransportAccountRows title="Vehicle Account / Gari Hisaab" kind="vehicle"/> }
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
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={()=>setQuickPprTrip(null)} className="rounded border px-3 py-2 text-xs font-semibold">Cancel</button>
          <button type="button" disabled={loading||!quickPprEmployee||!quickPprDate} onClick={()=>void saveQuickPpr()} className="rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Mark Received</button>
        </div>
      </div>
    </div>}
    {initialRateTrip&&<TransportInitialRate trip={initialRateTrip} onClose={()=>setInitialRateTrip(null)} onChanged={load}/>}
    {showBulkSupplierRent&&<TransportBulkSupplierRent initialTripId={bulkSupplierRentTrip?.id} initialSupplierName={bulkSupplierRentTrip?.owner_name??undefined} onClose={()=>{setShowBulkSupplierRent(false);setBulkSupplierRentTrip(null)}} onChanged={async()=>{await load(true)}}/>}
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
    className="fixed z-[9999] w-40 rounded-md border border-slate-200 bg-white p-1.5 text-[10px] normal-case shadow-lg"
    style={{top,left}}
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
        className="h-6 w-full rounded border border-slate-200 pl-5 pr-1.5 text-[10px]"
      />
    </div>

    <div className="mt-0.5 flex gap-px">
      <button type="button" onClick={onSelectAll}
        className="h-5 flex-1 rounded border border-slate-200 px-1 py-0 text-[8px] font-semibold leading-none hover:bg-slate-50">
        Select Shown
      </button>

      <button type="button" onClick={onClear}
        className="flex-1 rounded border border-slate-200 px-1 py-0.5 font-semibold hover:bg-slate-50">
        Clear
      </button>
    </div>

    <div className="mt-1 max-h-40 overflow-y-auto border-t border-slate-100 pt-0.5">
      {loading&&<p>Loading values…</p>}
      <p className="text-slate-500">Up to 200 matches. Search for more.</p>
      {shown.map(value=>
        <label key={value} className="flex h-5 cursor-pointer items-center gap-1 rounded px-0.5 py-0 hover:bg-slate-50">
          <input
            type="checkbox"
            checked={selected.includes(value)}
            onChange={()=>onToggle(value)}
          />
          <span className="min-w-0 flex-1 truncate text-[9px]">{value}</span>
        </label>
      )}

      {!shown.length&&
        <div className="px-1 py-3 text-center text-slate-400">No values</div>
      }
    </div>
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
  return <div className="min-w-0 border-b border-r border-slate-300 last:border-r-0">
    <div className="relative flex h-7 items-center justify-center bg-slate-200 px-1 text-center text-[9px] font-bold uppercase text-slate-800">
      {label}
      {onAdd&&
        <button type="button" aria-label={`Add ${label}`} title={`Add ${label}`}
          onClick={e=>{e.preventDefault();e.stopPropagation();onAdd()}}
          className="absolute right-1 top-1/2 -translate-y-1/2 px-1 text-lg font-bold leading-none text-red-600 hover:text-red-700">
          +
        </button>
      }
    </div>
    <div className="block min-h-8">{children}</div>
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
