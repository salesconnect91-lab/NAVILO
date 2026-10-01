import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, Upload, Route, History, ReceiptText, UserRound, Truck, RefreshCw } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import TransportFinancialPanel from './TransportFinancialPanel';
import TransportInitialRate from './TransportInitialRate';
import TransportCostUpload from './TransportCostUpload';
import TransportAudit from './TransportAudit';
import TransportPartyReports from './TransportPartyReports';
import TransportAccountStatement from './TransportAccountStatement';
import {fetchAllPages} from '@/lib/fetchAllPages';
import {financialNumber, type FinancialTrip} from './transportFinancialTypes';
import * as XLSX from "xlsx";

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


type BulkTripRow={
  rowNo:number;
  trip_date:string;
  customer:string;
  truck_type:string;
  vehicle:string;
  driver:string;
  owner_supplier:string;
  po_do_job_no:string;
  from_location:string;
  to_location:string;
  ppr_status:string;
  customer_rate:string;
  supplier_rent:string;
  source_invoice_no:string;
  notes:string;
  errors:string[];
};

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
  "Notes"
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
  "RENT WITH DRIVER",
  "REMAINING WITH US",
  "PAYMENT DATE",
  "AMOUNT",
  "rate with company",
  "received from company",
  "remaining with company",
  "PROFIT",
  "paid commissin for trip",
  "INVOICE NUMBER",
  "Sale Type `n( Cash / Credit)"
] as const;

export default function TransportWorkspace(){
  const {activeCompany,activeBusinessUnit}=useAuth();

  const [tab,setTab]=useState<Tab>("trips");
  const [rows,setRows]=useState<Trip[]>([]);
  const [loading,setLoading]=useState(false);
  const tripsGridRef=useRef<HTMLDivElement|null>(null);

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

  const [newTripMode,setNewTripMode]=useState<"single"|"bulk">("single");
  const [bulkRows,setBulkRows]=useState<BulkTripRow[]>([]);
  const [bulkFileName,setBulkFileName]=useState("");
  const [bulkParsing,setBulkParsing]=useState(false);
  const [bulkValidating,setBulkValidating]=useState(false);
  const [bulkImporting,setBulkImporting]=useState(false);

  const [tripMasters,setTripMasters]=useState<{
    customers:any[];
    truckTypes:any[];
    locations:any[];
    vehicles:any[];
    drivers:any[];
    suppliers:any[];
    employees:any[];
  }>({customers:[],truckTypes:[],locations:[],vehicles:[],drivers:[],suppliers:[],employees:[]});

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
    sale_type:"",
    notes:""
  });
  const [financialTrip,setFinancialTrip]=useState<Trip|null>(null);
  const [initialRateTrip,setInitialRateTrip]=useState<Trip|null>(null);
  const [editingRateLocks,setEditingRateLocks]=useState({customer:false,supplier:false});
  const [editingTripId,setEditingTripId]=useState<string|null>(null);
  const [editingTripNo,setEditingTripNo]=useState("");
  const [editingOriginalAssignment,setEditingOriginalAssignment]=useState({vehicle_id:"",driver_id:""});

  const [quickAdd,setQuickAdd]=useState<null|"truckType"|"customer"|"driver"|"supplier"|"vehicle"|"locationFrom"|"locationTo">(null);
  const [quickAddForm,setQuickAddForm]=useState({
    name:"",
    mobile:"",
    truck_type_id:"",
    ownership_type:"company",
    supplier_id:""
  });
  const [quickAddSaving,setQuickAddSaving]=useState(false);

  const selectedVehicle=tripMasters.vehicles.find((v:any)=>v.id===form.vehicle_id);
  const selectedDriver=tripMasters.drivers.find((d:any)=>d.id===form.driver_id);
  const selectedSupplier=selectedVehicle?.supplier_id
    ? tripMasters.suppliers.find((s:any)=>s.id===selectedVehicle.supplier_id)
    : null;

  const ownerDisplay=selectedVehicle
    ? selectedVehicle.owner_name?.trim()
      || selectedSupplier?.name
      || (selectedVehicle.ownership_type==="supplier" ? "Supplier" : "Company")
    : "";


  async function loadTripMasters(){
    if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id)return;

    const companyId=activeCompany.company_id;
    const businessUnitId=activeBusinessUnit.business_unit_id;

    const [customers,truckTypes,locations,vehicles,drivers,suppliers,employees]=await Promise.all([
      supabase.from("customers").select("id,name,is_active").eq("company_id",companyId).eq("is_active",true).order("name"),
      supabase.from("transport_truck_types").select("id,name,is_active").eq("company_id",companyId).eq("business_unit_id",businessUnitId).eq("is_active",true).order("name"),
      supabase.from("transport_locations").select("id,name,is_active").eq("company_id",companyId).eq("business_unit_id",businessUnitId).eq("is_active",true).order("name"),
      supabase.from("transport_vehicles").select("id,vehicle_no,truck_type_id,ownership_type,owner_name,supplier_id,is_active").eq("company_id",companyId).eq("business_unit_id",businessUnitId).eq("is_active",true).order("vehicle_no"),
      supabase.from("transport_drivers").select("id,driver_name,mobile,is_active").eq("company_id",companyId).eq("business_unit_id",businessUnitId).eq("is_active",true).order("driver_name"),
      supabase.from("suppliers").select("id,name,is_active").eq("company_id",companyId).eq("is_active",true).order("name"),
      fetchAllPages<any>((start,end)=>supabase.from("employees").select("id,name").eq("company_id",companyId).eq("is_active",true).order("id").range(start,end))
    ]);

    for(const result of [customers,truckTypes,locations,vehicles,drivers,suppliers]){
      if(result.error)throw result.error;
    }

    setTripMasters({
      customers:customers.data??[],
      truckTypes:truckTypes.data??[],
      locations:locations.data??[],
      vehicles:vehicles.data??[],
      drivers:drivers.data??[],
      suppliers:suppliers.data??[],
      employees
    });
  }

  const openQuickAdd=(kind:NonNullable<typeof quickAdd>)=>{
    setError("");
    setQuickAddForm({
      name:"",
      mobile:"",
      truck_type_id:kind==="vehicle"?form.truck_type_id:"",
      ownership_type:"company",
      supplier_id:""
    });
    setQuickAdd(kind);
  };

  async function saveQuickAdd(){
    if(!quickAdd||!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id)return;
    const name=quickAddForm.name.trim();
    if(!name){setError("Name / value is required.");return}

    const companyId=activeCompany.company_id;
    const businessUnitId=activeBusinessUnit.business_unit_id;
    const masterKey=(value:any)=>String(value??"")
      .trim()
      .replace(/\s+/g," ")
      .toLocaleLowerCase();
    const same=(value:any)=>masterKey(value)===masterKey(name);

    const duplicate =
      quickAdd==="customer" ? tripMasters.customers.find((r:any)=>same(r.name)) :
      quickAdd==="supplier" ? tripMasters.suppliers.find((r:any)=>same(r.name)) :
      quickAdd==="driver" ? tripMasters.drivers.find((r:any)=>same(r.driver_name)) :
      quickAdd==="truckType" ? tripMasters.truckTypes.find((r:any)=>same(r.name)) :
      quickAdd==="vehicle" ? tripMasters.vehicles.find((r:any)=>
        same(r.vehicle_no) &&
        String(r.supplier_id??"")===String(quickAddForm.supplier_id??"")
      ) :
      tripMasters.locations.find((r:any)=>same(r.name));

    if(duplicate){
      if(quickAdd==="customer")setForm({...form,customer_id:duplicate.id,customer_name_snapshot:duplicate.name});
      else if(quickAdd==="driver")setForm({...form,driver_id:duplicate.id});
      else if(quickAdd==="truckType")setForm({...form,truck_type_id:duplicate.id});
      else if(quickAdd==="vehicle")setForm({...form,vehicle_id:duplicate.id,truck_type_id:duplicate.truck_type_id||form.truck_type_id});
      else if(quickAdd==="locationFrom")setForm({...form,from_location:duplicate.name});
      else if(quickAdd==="locationTo")setForm({...form,to_location:duplicate.name});
      else if(quickAdd==="supplier"&&form.vehicle_id){
        const {error:ownerError}=await supabase.from("transport_vehicles")
          .update({ownership_type:"supplier",owner_type:"supplier",owner_name:duplicate.name,supplier_id:duplicate.id})
          .eq("id",form.vehicle_id)
          .eq("company_id",companyId)
          .eq("business_unit_id",businessUnitId);
        if(ownerError){setError(ownerError.message);return}
        await loadTripMasters();
      }
      setQuickAdd(null);
      return;
    }

    if(quickAdd==="vehicle"&&!quickAddForm.truck_type_id){
      setError("Truck Type is required for a new vehicle.");
      return;
    }
    if(quickAdd==="vehicle"&&!quickAddForm.supplier_id){
      setError("Owner is required for a new vehicle.");
      return;
    }

    setQuickAddSaving(true);
    setError("");
    try{
      let result:any;
      if(quickAdd==="customer"){
        result=await supabase.from("customers")
          .insert({company_id:companyId,name,is_active:true})
          .select("id,name,is_active").single();
      }else if(quickAdd==="supplier"){
        result=await supabase.from("suppliers")
          .insert({company_id:companyId,name,is_active:true})
          .select("id,name,is_active").single();
      }else if(quickAdd==="driver"){
        result=await supabase.from("transport_drivers")
          .insert({company_id:companyId,business_unit_id:businessUnitId,driver_name:name,mobile:quickAddForm.mobile.trim()||null,is_active:true})
          .select("id,driver_name,mobile,is_active").single();
      }else if(quickAdd==="truckType"){
        result=await supabase.from("transport_truck_types")
          .insert({company_id:companyId,business_unit_id:businessUnitId,name,is_active:true})
          .select("id,name,is_active").single();
      }else if(quickAdd==="vehicle"){
        result=await supabase.from("transport_vehicles")
          .insert({
            company_id:companyId,
            business_unit_id:businessUnitId,
            vehicle_no:name,
            truck_type_id:quickAddForm.truck_type_id,
            ownership_type:"supplier",
            owner_type:"supplier",
            owner_name:tripMasters.suppliers.find((s:any)=>s.id===quickAddForm.supplier_id)?.name||null,
            supplier_id:quickAddForm.supplier_id,
            is_active:true
          })
          .select("id,vehicle_no,truck_type_id,ownership_type,supplier_id,is_active").single();
      }else{
        result=await supabase.from("transport_locations")
          .insert({company_id:companyId,business_unit_id:businessUnitId,name,is_active:true})
          .select("id,name,is_active").single();
      }

      if(result.error)throw result.error;
      const created=result.data;
      await loadTripMasters();

      if(quickAdd==="customer")setForm({...form,customer_id:created.id,customer_name_snapshot:created.name});
      else if(quickAdd==="driver")setForm({...form,driver_id:created.id});
      else if(quickAdd==="truckType")setForm({...form,truck_type_id:created.id});
      else if(quickAdd==="vehicle")setForm({...form,vehicle_id:created.id,truck_type_id:created.truck_type_id||form.truck_type_id});
      else if(quickAdd==="locationFrom")setForm({...form,from_location:created.name});
      else if(quickAdd==="locationTo")setForm({...form,to_location:created.name});
      else if(quickAdd==="supplier"&&form.vehicle_id){
        const {error:ownerError}=await supabase.from("transport_vehicles")
          .update({ownership_type:"supplier",owner_type:"supplier",owner_name:created.name,supplier_id:created.id})
          .eq("id",form.vehicle_id)
          .eq("company_id",companyId)
          .eq("business_unit_id",businessUnitId);
        if(ownerError)throw ownerError;
        await loadTripMasters();
      }

      setQuickAdd(null);
    }catch(e:any){
      setError(e?.message||"Unable to create master.");
    }finally{
      setQuickAddSaving(false);
    }
  }

  async function load(silent=false){
    if(!silent)setLoading(true);
    setError("");

    try{
      const pageSize=1000;
      let from=0;
      const all:Trip[]=[];

      while(true){
        const {data,error}=await supabase
          .from("transport_financial_register")
          .select("*")
          .order("trip_date",{ascending:false})
          .order("trip_no",{ascending:false})
          .range(from,from+pageSize-1);

        if(error) throw error;

        const batch=(data??[]).map(r=>({...r,truck_type:r.truck_type_name??r.truck_type})) as Trip[];
        all.push(...batch);

        if(batch.length<pageSize) break;
        from+=pageSize;
      }

      const tripIds=all.map(r=>r.id);
      const operationalTrips:Array<{id:string;source_invoice_no:string|null;customer_rate:number|null;owner_rent:number|null;supplier_rent:number|null;driver_pay:number|null}>=[];
      const links:Array<{trip_id:string;document_id:string}>=[];
      for(let offset=0;offset<tripIds.length;offset+=200){
        const ids=tripIds.slice(offset,offset+200);
        if(!ids.length)continue;
        const result=await supabase
          .from("transport_trips")
          .select("id,source_invoice_no,customer_rate,owner_rent,supplier_rent,driver_pay")
          .in("id",ids);
        if(result.error)throw result.error;
        operationalTrips.push(...(result.data??[]));
      }
      for(let offset=0;offset<tripIds.length;offset+=200){
        const ids=tripIds.slice(offset,offset+200);
        if(!ids.length)continue;
        const result=await supabase
          .from("transport_customer_document_trips")
          .select("trip_id,document_id,is_adjustment")
          .in("trip_id",ids)
          .eq("is_adjustment",false);
        if(result.error)throw result.error;
        links.push(...(result.data??[]).map(r=>({trip_id:r.trip_id,document_id:r.document_id})));
      }

      const documentIds=Array.from(new Set(links.map(r=>r.document_id)));
      const documents:Array<{id:string;sales_order_id:string}>=[];
      for(let offset=0;offset<documentIds.length;offset+=200){
        const ids=documentIds.slice(offset,offset+200);
        const result=await supabase
          .from("transport_customer_documents")
          .select("id,sales_order_id")
          .in("id",ids);
        if(result.error)throw result.error;
        documents.push(...(result.data??[]));
      }

      const orderIds=Array.from(new Set(documents.map(r=>r.sales_order_id)));
      const orders:Array<{id:string;order_no:string}>=[];
      for(let offset=0;offset<orderIds.length;offset+=200){
        const ids=orderIds.slice(offset,offset+200);
        const result=await supabase
          .from("sales_orders")
          .select("id,order_no")
          .in("id",ids);
        if(result.error)throw result.error;
        orders.push(...(result.data??[]));
      }

      const documentOrder=new Map(documents.map(r=>[r.id,r.sales_order_id]));
      const orderNumber=new Map(orders.map(r=>[r.id,r.order_no]));
      const operationalByTrip=new Map(operationalTrips.map(r=>[r.id,r]));
      const sourceInvoiceByTrip=new Map(
        operationalTrips
          .filter(r=>Boolean(r.source_invoice_no?.trim()))
          .map(r=>[r.id,r.source_invoice_no!.trim()])
      );
      const invoiceByTrip=new Map<string,string>();
      for(const link of links){
        const orderId=documentOrder.get(link.document_id);
        const invoiceNo=orderId?orderNumber.get(orderId):undefined;
        if(invoiceNo&&!invoiceByTrip.has(link.trip_id))invoiceByTrip.set(link.trip_id,invoiceNo);
      }

      setRows(all.map(r=>{
        const operational=operationalByTrip.get(r.id);
        return {
          ...r,
          customer_rate:operational?.customer_rate??r.customer_rate??null,
          owner_rent:operational?.owner_rent??r.owner_rent??null,
          supplier_rent:operational?.supplier_rent??r.supplier_rent??null,
          driver_pay:operational?.driver_pay??r.driver_pay??null,
          invoice_no:invoiceByTrip.get(r.id)??sourceInvoiceByTrip.get(r.id)??null
        };
      }));
    }catch(e:any){
      setError(e?.message||"Unable to load trips.");
    }finally{
      if(!silent)setLoading(false);
    }
  }

  useEffect(()=>{
    if(activeCompany?.company_id&&activeBusinessUnit?.business_unit_id){
      void load();
      void loadTripMasters().catch((e:any)=>setError(e?.message||"Unable to load Transport masters."));
    }
  },[activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);

  useEffect(()=>{
    if(tab!=="trips"||!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id)return;
    const refresh=()=>{if(document.visibilityState==="visible")void load(true)};
    const timer=window.setInterval(refresh,15000);
    window.addEventListener("focus",refresh);
    document.addEventListener("visibilitychange",refresh);
    return ()=>{
      window.clearInterval(timer);
      window.removeEventListener("focus",refresh);
      document.removeEventListener("visibilitychange",refresh);
    };
  },[tab,activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);

  useEffect(()=>{
    if(tab!=="trips")return;
    const frame=window.requestAnimationFrame(()=>{
      if(tripsGridRef.current)tripsGridRef.current.scrollLeft=0;
    });
    return ()=>window.cancelAnimationFrame(frame);
  },[tab,activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);

  const visible=useMemo(()=>{
    return rows.filter(r=>{
      const matchesDates=
        (!fromDate||r.trip_date>=fromDate)&&
        (!toDate||r.trip_date<=toDate);

      return matchesDates&&
        (!customerFilter||r.customer_name===customerFilter)&&
        (!driverFilter||r.driver_name===driverFilter)&&
        (!vehicleFilter||r.vehicle_no===vehicleFilter)&&
        (!fromFilter||r.from_location===fromFilter)&&
        (!toFilter||r.to_location===toFilter)&&
        (!pprFilter||String(r.ppr_status??"")===pprFilter);
    });
  },[
    rows,fromDate,toDate,customerFilter,driverFilter,
    vehicleFilter,fromFilter,toFilter,pprFilter
  ]);

  const unique=(values:(string|null|undefined)[]) =>
    Array.from(new Set(values.filter((v):v is string=>Boolean(v)))).sort();

  const customerOptions=useMemo(()=>unique(rows.map(r=>r.customer_name)),[rows]);
  const driverOptions=useMemo(()=>unique(rows.map(r=>r.driver_name)),[rows]);
  const vehicleOptions=useMemo(()=>unique(rows.map(r=>r.vehicle_no)),[rows]);
  const fromOptions=useMemo(()=>unique(rows.map(r=>r.from_location)),[rows]);
  const toOptions=useMemo(()=>unique(rows.map(r=>r.to_location)),[rows]);
  const pprOptions=useMemo(()=>unique(rows.map(r=>r.ppr_status)),[rows]);

  const completedTrips=rows.filter(r=>
    ["Complete","Closed"].includes(r.financial_status??"")
  ).length;

  const paperPending=rows.filter(r=>
    String(r.ppr_status??"").toLowerCase()!=="received"
  ).length;

  const resetFilters=()=>{
    setFromDate("");
    setToDate("");
    setCustomerFilter("");
    setDriverFilter("");
    setVehicleFilter("");
    setFromFilter("");
    setToFilter("");
    setPprFilter("");
  };

  useEffect(()=>{
    const el=tripsGridRef.current;
    if(!el||tab!=="trips")return;

    const onWheel=(event:WheelEvent)=>{
      const delta=
        Math.abs(event.deltaX)>Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;

      if(!delta)return;
      event.stopPropagation();
      el.scrollLeft+=delta;
    };

    el.addEventListener("wheel",onWheel,{passive:false});
    return ()=>el.removeEventListener("wheel",onWheel);
  },[tab]);


  const [columnFilters,setColumnFilters]=useState<Record<string,string[]>>({});
  const [sortColumn,setSortColumn]=useState<string>("");
  const [sortDirection,setSortDirection]=useState<"asc"|"desc">("asc");
  const [openColumnFilter,setOpenColumnFilter]=useState<string|null>(null);
  const [columnMenuPosition,setColumnMenuPosition]=useState({top:0,left:0});

  const DEFAULT_TRIPS_GRID_HEIGHT=520;
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
      "Credit"
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

    if(!row.trip_date)errors.push("Trip Date required");
    if(!row.customer)errors.push("Customer required");
    if(!row.from_location)errors.push("From required");
    if(!row.to_location)errors.push("To required");

    if(
      row.ppr_status&&
      !["pending","received","not_required"].includes(
        row.ppr_status.toLowerCase()
      )
    ){
      errors.push("Invalid PPR Status");
    }

    for(const [label,value] of [
      ["Customer Rate",row.customer_rate],
      ["Supplier Rent",row.supplier_rent]
    ] as const){
      if(value!==""&&(!Number.isFinite(Number(value))||Number(value)<0)){
        errors.push(`${label} must be a positive number`);
      }
    }

    return errors;
  };


  const bulkKey=(value:unknown)=>
    String(value??"").trim().toLocaleLowerCase();

  const validateBulkMasters=async(rowsToValidate:BulkTripRow[])=>{
    if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){
      throw new Error("Active Company and Business Unit are required.");
    }

    setBulkValidating(true);

    try{
      const companyId=activeCompany.company_id;
      const businessUnitId=activeBusinessUnit.business_unit_id;

      const [
        customersResult,
        truckTypesResult,
        locationsResult,
        vehiclesResult,
        driversResult
      ]=await Promise.all([
        supabase
          .from("customers")
          .select("id,name,is_active")
          .eq("company_id",companyId),

        supabase
          .from("transport_truck_types")
          .select("id,name,is_active")
          .eq("company_id",companyId)
          .eq("business_unit_id",businessUnitId),

        supabase
          .from("transport_locations")
          .select("id,name,is_active")
          .eq("company_id",companyId)
          .eq("business_unit_id",businessUnitId),

        supabase
          .from("transport_vehicles")
          .select("id,vehicle_no,truck_type_id,ownership_type,supplier_id,is_active")
          .eq("company_id",companyId)
          .eq("business_unit_id",businessUnitId),

        supabase
          .from("transport_drivers")
          .select("id,driver_name,is_active")
          .eq("company_id",companyId)
          .eq("business_unit_id",businessUnitId)
      ]);

      for(const result of [
        customersResult,
        truckTypesResult,
        locationsResult,
        vehiclesResult,
        driversResult
      ]){
        if(result.error) throw result.error;
      }

      const customers=customersResult.data??[];
      const truckTypes=truckTypesResult.data??[];
      const locations=locationsResult.data??[];
      const vehicles=vehiclesResult.data??[];
      const drivers=driversResult.data??[];

      const customerMap=new Map(
        customers.map((r:any)=>[bulkKey(r.name),r])
      );

      const truckTypeMap=new Map(
        truckTypes.map((r:any)=>[bulkKey(r.name),r])
      );

      const locationMap=new Map(
        locations.map((r:any)=>[bulkKey(r.name),r])
      );

      const vehicleMap=new Map(
        vehicles.map((r:any)=>[bulkKey(r.vehicle_no),r])
      );

      const driverMap=new Map(
        drivers.map((r:any)=>[bulkKey(r.driver_name),r])
      );

      const seen=new Set<string>();

      return rowsToValidate.map(row=>{
        const errors=validateBulkRow(row);

        const customer=customerMap.get(bulkKey(row.customer)) as any;
        const truckType=row.truck_type
          ? truckTypeMap.get(bulkKey(row.truck_type)) as any
          : null;
        const vehicle=row.vehicle
          ? vehicleMap.get(bulkKey(row.vehicle)) as any
          : null;
        const driver=row.driver
          ? driverMap.get(bulkKey(row.driver)) as any
          : null;

        const fromLocation=locationMap.get(
          bulkKey(row.from_location)
        ) as any;

        const toLocation=locationMap.get(
          bulkKey(row.to_location)
        ) as any;

        if(!customer){
          errors.push("Customer not found in Customer Master");
        }else if(customer.is_active===false){
          errors.push("Customer is inactive");
        }

        if(row.truck_type){
          if(!truckType){
            errors.push("Truck Type not found in Transport Master");
          }else if(truckType.is_active===false){
            errors.push("Truck Type is inactive");
          }
        }

        if(row.vehicle){
          if(!vehicle){
            errors.push("Vehicle not found in Transport Vehicle Master");
          }else{
            if(vehicle.is_active===false){
              errors.push("Vehicle is inactive");
            }

            if(
              truckType &&
              vehicle.truck_type_id &&
              vehicle.truck_type_id!==truckType.id
            ){
              errors.push("Vehicle does not match Truck Type");
            }
          }
        }

        if(row.driver){
          if(!driver){
            errors.push("Driver not found in Transport Driver Master");
          }else if(driver.is_active===false){
            errors.push("Driver is inactive");
          }
        }

        if(!fromLocation){
          errors.push("From location not found in Location Master");
        }else if(fromLocation.is_active===false){
          errors.push("From location is inactive");
        }

        if(!toLocation){
          errors.push("To location not found in Location Master");
        }else if(toLocation.is_active===false){
          errors.push("To location is inactive");
        }

        const duplicateKey=[
          row.trip_date,
          bulkKey(row.customer),
          bulkKey(row.vehicle),
          bulkKey(row.driver),
          bulkKey(row.po_do_job_no),
          bulkKey(row.from_location),
          bulkKey(row.to_location)
        ].join("|");

        if(seen.has(duplicateKey)){
          errors.push("Duplicate row in upload file");
        }else{
          seen.add(duplicateKey);
        }

        return {
          ...row,
          errors:Array.from(new Set(errors))
        };
      });
    }finally{
      setBulkValidating(false);
    }
  };


  const importValidBulkRows=async()=>{
    if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){
      setError("Active Company and Business Unit are required.");
      return;
    }

    if(bulkImporting||bulkParsing||bulkValidating)return;

    setError("");
    setBulkImporting(true);

    try{
      /*
       * Re-run master validation immediately before import.
       * This prevents stale preview data from being inserted if a master
       * was deactivated or changed after the file was selected.
       */
      const validated=await validateBulkMasters(bulkRows);
      setBulkRows(validated);

      const validRows=validated.filter(row=>row.errors.length===0);

      if(!validRows.length){
        throw new Error("No valid rows are available for import.");
      }

      const rejectedCount=validated.length-validRows.length;

      const confirmed=window.confirm(
        "Import "+validRows.length+" valid Transport trip"+
        (validRows.length===1?"":"s")+
        (rejectedCount
          ?" and leave "+rejectedCount+" rejected row"+
            (rejectedCount===1?"":"s")+" unimported?"
          :"?")+
        "\n\nTrip Nos will be generated automatically by NAVILO."
      );

      if(!confirmed)return;

      const companyId=activeCompany.company_id;
      const businessUnitId=activeBusinessUnit.business_unit_id;

      /*
       * Resolve canonical IDs again for the actual insert payload.
       * No spreadsheet-supplied IDs are trusted.
       */
      const [
        customersResult,
        locationsResult,
        vehiclesResult,
        driversResult
      ]=await Promise.all([
        supabase
          .from("customers")
          .select("id,name,is_active")
          .eq("company_id",companyId),

        supabase
          .from("transport_locations")
          .select("id,name,is_active")
          .eq("company_id",companyId)
          .eq("business_unit_id",businessUnitId),

        supabase
          .from("transport_vehicles")
          .select("id,vehicle_no,is_active")
          .eq("company_id",companyId)
          .eq("business_unit_id",businessUnitId),

        supabase
          .from("transport_drivers")
          .select("id,driver_name,is_active")
          .eq("company_id",companyId)
          .eq("business_unit_id",businessUnitId)
      ]);

      for(const result of [
        customersResult,
        locationsResult,
        vehiclesResult,
        driversResult
      ]){
        if(result.error)throw result.error;
      }

      const customerMap=new Map(
        (customersResult.data??[]).map((r:any)=>[bulkKey(r.name),r])
      );

      const locationMap=new Map(
        (locationsResult.data??[]).map((r:any)=>[bulkKey(r.name),r])
      );

      const vehicleMap=new Map(
        (vehiclesResult.data??[]).map((r:any)=>[bulkKey(r.vehicle_no),r])
      );

      const driverMap=new Map(
        (driversResult.data??[]).map((r:any)=>[bulkKey(r.driver_name),r])
      );

      const payloads=validRows.map(row=>{
        const customer=customerMap.get(bulkKey(row.customer)) as any;
        const vehicle=row.vehicle
          ? vehicleMap.get(bulkKey(row.vehicle)) as any
          : null;
        const driver=row.driver
          ? driverMap.get(bulkKey(row.driver)) as any
          : null;
        const fromLocation=locationMap.get(
          bulkKey(row.from_location)
        ) as any;
        const toLocation=locationMap.get(
          bulkKey(row.to_location)
        ) as any;

        /*
         * Defensive guard: validation already passed, but never construct
         * a payload from a missing/inactive canonical master.
         */
        if(!customer||customer.is_active===false){
          throw new Error(
            "Customer master changed before import: "+row.customer
          );
        }

        if(row.vehicle&&(!vehicle||vehicle.is_active===false)){
          throw new Error(
            "Vehicle master changed before import: "+row.vehicle
          );
        }

        if(row.driver&&(!driver||driver.is_active===false)){
          throw new Error(
            "Driver master changed before import: "+row.driver
          );
        }

        if(!fromLocation||fromLocation.is_active===false){
          throw new Error(
            "From location changed before import: "+row.from_location
          );
        }

        if(!toLocation||toLocation.is_active===false){
          throw new Error(
            "To location changed before import: "+row.to_location
          );
        }

        return {
          company_id:companyId,
          business_unit_id:businessUnitId,

          /*
           * Deliberately blank. Existing DB trigger generates the canonical
           * company-wide Trip No. Spreadsheet never controls Trip No.
           */
          trip_no:"",

          trip_date:row.trip_date,
          customer_id:customer.id,
          customer_name_snapshot:customer.name,

          vehicle_id:vehicle?.id??null,
          driver_id:driver?.id??null,

          from_location:fromLocation.name,
          to_location:toLocation.name,

          po_do_job_no:row.po_do_job_no||null,

          ppr_status:row.ppr_status
            ? row.ppr_status.toLowerCase()
            : "pending",

          customer_rate:row.customer_rate!==""
            ? Number(row.customer_rate)
            : null,

          supplier_rent:row.supplier_rent!==""
            ? Number(row.supplier_rent)
            : null,

          source_invoice_no:row.source_invoice_no||null,

          notes:row.notes||null
        };
      });

      /*
       * One Supabase insert statement for all valid rows.
       * If PostgreSQL rejects the statement, it does not become a
       * row-by-row partial client import.
       */
      const {error:insertError}=await supabase
        .from("transport_trips")
        .insert(payloads);

      if(insertError)throw insertError;

      const importedCount=payloads.length;

      /*
       * Preserve rejected rows for correction/re-export.
       * Imported rows are removed from the preview.
       */
      const rejectedRows=validated.filter(row=>row.errors.length>0);

      setBulkRows(rejectedRows);

      if(!rejectedRows.length){
        setBulkFileName("");
      }

      await load();

      window.alert(
        importedCount+" Transport trip"+
        (importedCount===1?"":"s")+
        " imported successfully."+
        (rejectedRows.length
          ?" "+rejectedRows.length+
            " rejected row"+
            (rejectedRows.length===1?" remains":"s remain")+
            " in the preview."
          :"")
      );

      if(!rejectedRows.length){
        setTab("trips");
      }
    }catch(e:any){
      setError(e?.message||"Unable to import Transport trips.");
    }finally{
      setBulkImporting(false);
    }
  };

  const parseBulkFile=async(file:File)=>{
    setBulkParsing(true);
    setError("");

    try{
      const buffer=await file.arrayBuffer();
      const workbook=XLSX.read(buffer,{
        type:"array",
        cellDates:true
      });

      const sheetName=workbook.SheetNames.find(
        name=>name.trim().toLowerCase()==="trips"
      )??workbook.SheetNames[0];

      if(!sheetName)throw new Error("Workbook has no worksheet.");

      const sheet=workbook.Sheets[sheetName];
      const matrix=XLSX.utils.sheet_to_json<unknown[]>(sheet,{
        header:1,
        defval:"",
        raw:true
      });

      if(matrix.length<2){
        throw new Error("No data rows found in the selected file.");
      }

      const rawHeaders=(matrix[0]??[]).map(value=>cleanBulkText(value));
      const headerKey=(value:unknown)=>
        cleanBulkText(value)
          .replace(/\s+/g," ")
          .trim()
          .toLowerCase();

      const headerIndexes=new Map<string,number[]>();
      rawHeaders.forEach((header,index)=>{
        const key=headerKey(header);
        const indexes=headerIndexes.get(key)??[];
        indexes.push(index);
        headerIndexes.set(key,indexes);
      });

      const required=[
        "date","truck type","company name","driver name","owner",
        "plate #","from","to","paper received by"
      ];

      const missing=required.filter(name=>!headerIndexes.has(name));
      if(missing.length){
        throw new Error(
          "Selected file is not the BuKu Trip template. Missing column(s): "+
          missing.join(", ")
        );
      }

      const get=(source:unknown[],name:string,occurrence=0)=>{
        const indexes=headerIndexes.get(headerKey(name))??[];
        const index=indexes[occurrence];
        return index===undefined?"":source[index];
      };

      const pprStatusFromBuKu=(value:unknown)=>{
        const raw=cleanBulkText(value);
        const key=raw.toLowerCase();

        if(!raw||key.includes("pending"))return "pending";
        if(key.includes("not required")||key.includes("n/a"))return "not_required";

        // In the legacy BuKu sheet this column is "PAPER RECEIVED BY".
        // A populated receiver/name means the paper has been received.
        return "received";
      };

      const normalized=matrix.slice(1)
        .map((source,index)=>{
          const values=Array.isArray(source)?source:[];
          const hasAnyValue=values.some(value=>cleanBulkText(value)!=="");
          if(!hasAnyValue)return null;

          const explicitInvoice=cleanBulkText(get(values,"INVOICE NUMBER"));
          const invoicedCell=cleanBulkText(get(values,"INVOICED"));
          const sourceInvoiceNo=explicitInvoice||(
            invoicedCell&&!/^(yes|no|y|n|true|false|invoiced|pending)$/i.test(invoicedCell)
              ? invoicedCell
              : ""
          );

          const row:BulkTripRow={
            rowNo:index+2,
            trip_date:normalizeBulkDate(get(values,"DATE",0)),
            customer:cleanBulkText(get(values,"COMPANY NAME")),
            truck_type:cleanBulkText(get(values,"TRUCK TYPE")),
            vehicle:cleanBulkText(get(values,"PLATE #")),
            driver:cleanBulkText(get(values,"DRIVER NAME")),
            owner_supplier:cleanBulkText(get(values,"OWNER")),
            po_do_job_no:cleanBulkText(get(values,"PO/DO/JOB NO.")),
            from_location:cleanBulkText(get(values,"FROM")),
            to_location:cleanBulkText(get(values,"TO")),
            ppr_status:pprStatusFromBuKu(get(values,"PAPER RECEIVED BY")),
            customer_rate:cleanBulkText(get(values,"rate with company")),
            supplier_rent:cleanBulkText(get(values,"RENT WITH DRIVER")),
            source_invoice_no:sourceInvoiceNo,
            notes:"",
            errors:[]
          };

          row.errors=validateBulkRow(row);
          return row;
        })
        .filter((row):row is BulkTripRow=>row!==null);

      if(!normalized.length){
        throw new Error("No trip rows found in the selected BuKu file.");
      }

      const validated=await validateBulkMasters(normalized);
      setBulkRows(validated);
      setBulkFileName(file.name);
    }catch(e:any){
      setBulkRows([]);
      setBulkFileName("");
      setError(e?.message||"Unable to read upload file.");
    }finally{
      setBulkParsing(false);
    }
  };

  const clearBulkUpload=()=>{
    setBulkRows([]);
    setBulkFileName("");
  };

  async function startEditTrip(row:Trip){
    setLoading(true);
    setError("");
    try{
      await loadTripMasters();
      const {data,error}=await supabase
        .from("transport_trips")
        .select("id,trip_no,trip_date,customer_id,customer_name_snapshot,truck_type_id,vehicle_id,driver_id,from_location,to_location,po_do_job_no,ppr_status,ppr_received_date,ppr_received_by_employee_id,ppr_attachment_path,customer_rate,owner_rent,notes,sale_type")
        .eq("id",row.id)
        .eq("company_id",activeCompany?.company_id)
        .eq("business_unit_id",activeBusinessUnit?.business_unit_id)
        .single();
      if(error)throw error;

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
        supplier_rent:data.owner_rent==null?"":String(data.owner_rent),
        sale_type:data.sale_type||"",
        notes:data.notes||""
      });
      setEditingRateLocks({customer:Boolean(row.customer_rate_locked||row.customer_rate_state==='finalized'),supplier:Boolean(row.supplier_rate_locked)});
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
        customer_rate:form.customer_rate!==""?Number(form.customer_rate):0,
        owner_rent:form.supplier_rent!==""?Number(form.supplier_rent):0,
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
    if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){
      setError("Active Company and Business Unit are required.");
      return;
    }
    if(!form.customer_id){setError("Customer is required.");return}
    if(!form.sale_type){setError("Sale Type Cash or Credit is required.");return}
    if(!form.from_location.trim()||!form.to_location.trim()){
      setError("From and To locations are required.");
      return;
    }

    if(form.ppr_status==="received"&&(!form.ppr_received_by_employee_id||!form.ppr_received_date)){setError("PPR Received requires the receiving employee and date.");return}
    const customer=tripMasters.customers.find((c:any)=>c.id===form.customer_id);
    if(!customer){setError("Selected Customer is no longer available.");return}

    setLoading(true);
    setError("");

    const payload={
      company_id:activeCompany.company_id,
      business_unit_id:activeBusinessUnit.business_unit_id,
      trip_no:"",
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
      ppr_received_date:form.ppr_status==="received"?form.ppr_received_date:null,
      ppr_received_by_employee_id:form.ppr_status==="received"?form.ppr_received_by_employee_id:null,
      customer_rate:form.customer_rate!==""?Number(form.customer_rate):0,
      owner_rent:form.supplier_rent!==""?Number(form.supplier_rent):0,
      sale_type:form.sale_type,
      notes:form.notes||null
    };

    const {error}=await supabase.from("transport_trips").insert(payload);

    if(error){
      setError(error.message);
    }else{
      setForm({
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
        sale_type:"",
        notes:""
      });
      setEditingTripId(null);
      setEditingTripNo("");
      setEditingOriginalAssignment({vehicle_id:"",driver_id:""});
      setTab("trips");
      await load();
    }

    setLoading(false);
  }


  const tripCellValue=(r:Trip,key:string):string=>{
    switch(key){
      case "trip_no": return String(r.trip_no??"");
      case "trip_date": return String(r.trip_date??"");
      case "truck_type": return String(r.truck_type??"");
      case "job_no": return String(r.po_do_job_no??"");
      case "invoiced": return r.invoiced?"Yes":"No";
      case "company": return String(r.customer_name??"");
      case "driver": return String(r.driver_name??"");
      case "owner": return String(r.owner_name??"");
      case "plate": return String(r.vehicle_no??"");
      case "from": return String(r.from_location??"");
      case "to": return String(r.to_location??"");
      case "paper_received_by": return String(r.ppr_received_by_name??"");
      case "ppr_date": return String(r.ppr_received_date??"");
      case "pay_driver": return financialNumber(r.driver_accrued??r.driver_pay);
      case "rent_driver": return financialNumber(r.billed_supplier_net??r.supplier_rent??r.owner_rent);
      case "remaining_us": return financialNumber(r.remaining_with_us);
      case "payment_date": return r.payment_date??"";
      case "amount": return financialNumber(r.payment_amount);
      case "company_rate": return financialNumber(r.billed_customer_net??r.customer_rate);
      case "received_company": return financialNumber(r.received_from_company);
      case "remaining_company": return financialNumber(r.remaining_with_company);
      case "profit": return r.billed_customer_net==null||r.trip_profit==null?"":financialNumber(r.trip_profit);
      case "commission": return financialNumber(r.commission_paid_net);
      case "invoice_no": return String(r.invoice_no??"");
      case "sale_type": return String(r.sale_type??"");
      default:return "";
    }
  };

  const gridColumns=[
    ["trip_no","Trip No"],
    ["trip_date","Date"],
    ["truck_type","Truck Type"],
    ["job_no","PO/DO/Job No."],
    ["invoiced","Invoiced"],
    ["company","Company Name"],
    ["driver","Driver Name"],
    ["owner","Owner"],
    ["plate","Plate #"],
    ["from","From"],
    ["to","To"],
    ["paper_received_by","Paper Received By"],
    ["ppr_date","PPR Date"],
    ["pay_driver","Pay To Driver"],
    ["rent_driver","Rent With Driver"],
    ["remaining_us","Remaining With Us"],
    ["payment_date","Payment Date"],
    ["amount","Amount"],
    ["company_rate","Rate With Company"],
    ["received_company","Received From Company"],
    ["remaining_company","Remaining With Company"],
    ["profit","Profit"],
    ["commission","Paid Commission For Trip"],
    ["invoice_no","Invoice Number"],
    ["sale_type","Sale Type"]
  ] as const;

  const columnOptions=(key:string)=>
    Array.from(new Set(
      visible.map(r=>tripCellValue(r,key)||"?")
    )).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));

  const gridRows=visible
    .filter(r=>Object.entries(columnFilters).every(([key,selected])=>{
      if(!selected.length)return true;
      return selected.includes(tripCellValue(r,key)||"?");
    }))
    .sort((a,b)=>{
      if(!sortColumn)return 0;
      const av=tripCellValue(a,sortColumn);
      const bv=tripCellValue(b,sortColumn);
      const result=av.localeCompare(bv,undefined,{numeric:true,sensitivity:"base"});
      return sortDirection==="asc"?result:-result;
    });

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

    {tab==="trips"&&<section className="rounded-lg border border-slate-200 bg-white shadow-sm" data-navilo-customizable="true">
      <div className="border-b border-slate-200 bg-white px-1.5 py-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex h-7 min-w-[92px] items-center justify-between rounded-md border border-cyan-200 bg-cyan-50 px-2">
            <span className="text-[9px] font-bold uppercase text-cyan-700">Total Trips</span>
            <span className="text-sm font-bold text-slate-950">{rows.length.toLocaleString()}</span>
          </div>

          <div className="flex h-7 min-w-[100px] items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-2">
            <span className="text-[9px] font-bold uppercase text-emerald-700">Completed</span>
            <span className="text-sm font-bold text-slate-950">{completedTrips.toLocaleString()}</span>
          </div>

          <div className="flex h-7 min-w-[108px] items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-2">
            <span className="text-[9px] font-bold uppercase text-amber-700">Paper Pending</span>
            <span className="text-sm font-bold text-slate-950">{paperPending.toLocaleString()}</span>
          </div>

          <button type="button" onClick={resetGrid}
            className="h-7 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
            Reset
          </button>

          <button type="button" onClick={()=>void load()} disabled={loading}
            className="flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-3.5 w-3.5"/>
            Refresh
          </button>
        </div>

        <div className="flex h-3.5 items-center justify-end text-[9px] font-semibold text-slate-600">
          {gridRows.length.toLocaleString()} / {rows.length.toLocaleString()} trips
        </div>
      </div>
      <div
        ref={tripsGridRef}
        className="min-h-[220px] overscroll-contain overflow-auto border-t border-slate-200 bg-white"
        style={{height:tripsGridHeight}}
      >
        <table className="w-max min-w-full table-auto whitespace-nowrap text-[11px] leading-tight">
          <thead className="sticky top-0 z-20 bg-slate-50 text-left text-[9px] uppercase tracking-normal text-slate-600">
            <tr>
              {gridColumns.map(([key,label],i)=>{
                const active=(columnFilters[key]?.length??0)>0;
                const sorted=sortColumn===key;

                return <th key={key}
                  className={`border-b border-slate-200 bg-slate-50 px-1 py-0.5 font-bold ${i===0?"sticky left-0 z-30":""}`}>
                  <button
                    type="button"
                    onClick={e=>{
                      if(openColumnFilter===key){
                        setOpenColumnFilter(null);
                        return;
                      }

                      const rect=e.currentTarget.getBoundingClientRect();
                      const width=176;
                      const gap=8;

                      let left=rect.left;
                      if(left+width>window.innerWidth-gap){
                        left=Math.max(gap,window.innerWidth-width-gap);
                      }

                      let top=rect.bottom+4;
                      if(top+360>window.innerHeight-gap){
                        top=Math.max(gap,rect.top-360);
                      }

                      setColumnMenuPosition({top,left});
                      setOpenColumnFilter(key);
                    }}
                    className={`flex w-full items-center justify-between gap-1 rounded px-0.5 py-0.5 text-left hover:bg-slate-200 ${active?"text-blue-700":""}`}
                  >
                    <span>{label}</span>
                    <span
                      className={`ml-0.5 inline-flex h-3 w-3 items-center justify-center ${active?"text-blue-700":"text-slate-400"}`}
                      aria-label={active?"Filter active":"Open filter"}
                    >
                      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" aria-hidden="true">
                        <path
                          d="M1.5 2h9L7 6v3L5 10V6L1.5 2Z"
                          fill="currentColor"
                        />
                      </svg>
                    </span>
                  </button>

                  {openColumnFilter===key&&
                    <ColumnFilterMenu
                      label={label}
                      top={columnMenuPosition.top}
                      left={columnMenuPosition.left}
                      options={columnOptions(key)}
                      selected={columnFilters[key]??[]}
                      sortDirection={sorted?sortDirection:null}
                      onSort={direction=>{
                        setSortColumn(key);
                        setSortDirection(direction);
                        setOpenColumnFilter(null);
                      }}
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
            {gridRows.map(r=><tr key={r.id} className="hover:bg-slate-50">
              <td className="sticky left-0 z-[5] border-b border-slate-100 bg-white px-1.5 py-0.5 font-bold text-slate-900">
  <button type="button" title="Edit Trip" onClick={()=>void startEditTrip(r)}
    className="font-bold text-blue-700 underline-offset-2 hover:underline">
    {r.trip_no}
  </button>
  <button type="button" className="ml-1 rounded border px-1 text-[9px] text-slate-600" onClick={()=>setFinancialTrip(r)} aria-label={`Finance ${r.trip_no}`}>Finance</button>
  <span className="block text-[9px] font-normal text-slate-500">{r.financial_status}</span>
</td>

              {/* BuKu operational register order - one canonical mapping for display/filter/sort */}
              {gridColumns.slice(1).map(([key])=>{
                const value=tripCellValue(r,key);
                const numeric=["pay_driver","rent_driver","remaining_us","amount","company_rate","received_company","remaining_company","profit","commission"].includes(key);
                return <td key={key}
                  className={`border-b border-slate-100 px-1.5 py-0.5 ${numeric?"text-right":""}`}>
                  {key==='company_rate'&&r.customer_rate_state==='pending'&&!r.customer_rate_locked?<button className="rounded border border-blue-200 px-1 text-blue-700" aria-label={`Add Rate ${r.trip_no}`} onClick={()=>setInitialRateTrip(r)}>Add Rate</button>:value||""}
                </td>;
              })}            </tr>)}
          </tbody>
        </table>
      </div>

      <div className="border-t border-slate-200 bg-slate-50">
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize Trips grid"
          onMouseDown={startTripsGridResize}
          className="group flex h-3 cursor-row-resize select-none items-center justify-center hover:bg-slate-100"
        >
          <div className="h-[2px] w-16 rounded bg-slate-300 group-hover:bg-slate-500"/>
        </div>

        <div className="flex h-6 items-center justify-between border-t border-slate-200 px-2 text-[9px] text-slate-500">
          <span>Drag bar to resize grid - {Math.round(tripsGridHeight)}px</span>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={saveTripsGridDefault}
              className="rounded border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-600 hover:bg-slate-100"
            >
              Set Default
            </button>

            <button
              type="button"
              onClick={resetTripsGridHeight}
              className="rounded border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-600 hover:bg-slate-100"
            >
              Reset Height
            </button>
          </div>
        </div>
      </div>
      {!loading&&!visible.length&&<div className="p-10 text-center text-sm text-slate-500">No trips found.</div>}
    </section>}

    {tab==="new"&&
<section className="rounded-xl border border-slate-200 bg-white shadow-sm">

  <div className="border-b border-slate-200">
    <div className="px-4 pb-2 pt-3">
      <h2 className="font-bold text-slate-950">
        {editingTripId?`Edit Trip - ${editingTripNo}`:"New Trip"}
      </h2>

      <p className="text-xs text-slate-500">
        {editingTripId?"Trip No is permanent; edit permitted fields below.":"Trip number is generated automatically by NAVILO."}
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
    </div>}
  </div>


  {newTripMode==="single"&&
  <div className="p-3">
    <div className="overflow-visible rounded-lg border border-blue-300 bg-white">
      <div className="grid grid-cols-1 border-b border-slate-300 md:grid-cols-2 xl:grid-cols-7">
        <TripField label="Date">
          <input type="date" value={form.trip_date}
            onChange={e=>{setError("");setForm({...form,trip_date:e.target.value})}}
            className="h-8 w-full border-0 bg-white px-2 text-xs outline-none"/>
        </TripField>

        <TripField label="Truck Type" onAdd={()=>openQuickAdd("truckType")}>
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

        <TripField label="Company Name" onAdd={()=>openQuickAdd("customer")}>
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

        <TripField label="Driver Name" onAdd={()=>openQuickAdd("driver")}>
          <SearchMasterInput value={selectedDriver?.driver_name||""}
            options={tripMasters.drivers.map((r:any)=>({value:r.id,label:r.driver_name}))}
            placeholder="Search Driver"
            onSelect={driverId=>{setError("");setForm({...form,driver_id:driverId})}}/>
        </TripField>

        <TripField label="Owner" onAdd={()=>openQuickAdd("supplier")}>
          <SearchMasterInput value={ownerDisplay}
            options={tripMasters.suppliers.map((r:any)=>({value:r.id,label:r.name}))}
            placeholder={form.vehicle_id?"Search Owner":"Select Plate first"}
            disabled={!form.vehicle_id}
            onSelect={async supplierId=>{
              if(!form.vehicle_id)return;
              const supplier=tripMasters.suppliers.find((r:any)=>r.id===supplierId);
              if(!supplier)return;
              setError("");
              const {error:ownerError}=await supabase.from("transport_vehicles")
                .update({ownership_type:"supplier",owner_type:"supplier",owner_name:supplier.name,supplier_id:supplier.id})
                .eq("id",form.vehicle_id)
                .eq("company_id",activeCompany?.company_id)
                .eq("business_unit_id",activeBusinessUnit?.business_unit_id);
              if(ownerError){setError(ownerError.message);return}
              await loadTripMasters();
            }}/>
        </TripField>

        <TripField label="Plate #" onAdd={()=>openQuickAdd("vehicle")}>
          <SearchMasterInput value={selectedVehicle
              ? `${selectedVehicle.vehicle_no}${ownerDisplay?` - ${ownerDisplay}`:""}`
              : ""}
            options={tripMasters.vehicles.map((r:any)=>{
              const owner=r.owner_name?.trim()||tripMasters.suppliers.find((s:any)=>s.id===r.supplier_id)?.name||"";
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
          <input value={selectedDriver?.mobile||""} readOnly
            className="h-8 w-full border-0 bg-white px-2 text-xs text-slate-900 outline-none"/>
        </TripField>

        <TripField label="From" onAdd={()=>openQuickAdd("locationFrom")}>
          <SearchMasterInput value={form.from_location}
            options={tripMasters.locations.map((r:any)=>({value:r.id,label:r.name}))}
            placeholder="Search From"
            onSelect={locationId=>{
              const location=tripMasters.locations.find((r:any)=>r.id===locationId);
              setError("");
              setForm({...form,from_location:location?.name||""});
            }}/>
        </TripField>

        <TripField label="To" onAdd={()=>openQuickAdd("locationTo")}>
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
          <select value={form.ppr_status}
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
          <input type="date" value={form.ppr_received_date}
            disabled={form.ppr_status!=="received"}
            onChange={e=>{setError("");setForm({...form,ppr_received_date:e.target.value})}}
            className="h-8 w-full border-0 bg-white px-2 text-xs outline-none disabled:bg-slate-50"/>
        </TripField>

        <TripField label="Rent With Driver">
          <input type="number" min="0" step="0.01" readOnly={Boolean(editingTripId&&editingRateLocks.supplier)} title={editingRateLocks.supplier?"Posted rate: use Finance / Rate Adjustment":""} value={form.supplier_rent}
            onChange={e=>{setError("");setForm({...form,supplier_rent:e.target.value})}}
            className="h-8 w-full border-0 bg-white px-2 text-right text-xs outline-none"/>
        </TripField>

        <TripField label="Rate With Company">
          <input type="number" min="0" step="0.01" readOnly={Boolean(editingTripId&&editingRateLocks.customer)} title={editingRateLocks.customer?"Posted rate: use Finance / Rate Adjustment":""} value={form.customer_rate}
            onChange={e=>{setError("");setForm({...form,customer_rate:e.target.value})}}
            className="h-8 w-full border-0 bg-white px-2 text-right text-xs outline-none"/>
        </TripField>

        <TripField label="Margin">
          <input value={
              form.customer_rate!==""&&form.supplier_rent!==""
                ? (Number(form.customer_rate)-Number(form.supplier_rent)).toFixed(2)
                : ""
            }
            readOnly
            className="h-8 w-full border-0 bg-slate-50 px-2 text-right text-xs font-semibold outline-none"/>
        </TripField>
      </div>
    </div>

    <div className="mt-3 grid gap-3 xl:grid-cols-[180px_1fr_auto]">
      <label className="text-[11px] font-semibold text-slate-700">
        Sale Type
        <select disabled={Boolean(editingTripId&&editingRateLocks.customer)} value={form.sale_type}
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

    {quickAdd&&
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" onMouseDown={()=>!quickAddSaving&&setQuickAdd(null)}>
        <div className="w-full max-w-md rounded-lg border border-slate-300 bg-white shadow-2xl" onMouseDown={e=>e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <div className="text-sm font-bold text-slate-900">
                {quickAdd==="customer"?"Add Company / Customer":
                 quickAdd==="driver"?"Add Driver":
                 quickAdd==="supplier"?"Add Owner / Supplier":
                 quickAdd==="truckType"?"Add Truck Type":
                 quickAdd==="vehicle"?"Add Vehicle / Plate":"Add Location"}
              </div>
              <div className="text-[10px] text-slate-500">Saved directly to the linked NAVILO master.</div>
            </div>
            <button type="button" className="px-2 text-lg text-slate-500 hover:text-slate-900" onClick={()=>setQuickAdd(null)}>x</button>
          </div>

          <div className="space-y-3 p-4">
            <label className="block text-[11px] font-semibold text-slate-700">
              {quickAdd==="vehicle"?"Plate / Vehicle No.":quickAdd==="driver"?"Driver Name":"Name"}
              <input autoFocus value={quickAddForm.name}
                onChange={e=>{setError("");setQuickAddForm({...quickAddForm,name:e.target.value})}}
                className="mt-1 h-9 w-full rounded-md border border-slate-300 px-3 text-xs outline-none focus:border-blue-500"/>
            </label>

            {quickAdd==="driver"&&
              <label className="block text-[11px] font-semibold text-slate-700">
                Mobile
                <input value={quickAddForm.mobile}
                  onChange={e=>setQuickAddForm({...quickAddForm,mobile:e.target.value})}
                  className="mt-1 h-9 w-full rounded-md border border-slate-300 px-3 text-xs outline-none focus:border-blue-500"/>
              </label>
            }

            {quickAdd==="vehicle"&&<>
              <label className="block text-[11px] font-semibold text-slate-700">
                Truck Type
                <select value={quickAddForm.truck_type_id}
                  onChange={e=>setQuickAddForm({...quickAddForm,truck_type_id:e.target.value})}
                  className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs outline-none">
                  <option value="">Select Truck Type</option>
                  {tripMasters.truckTypes.map((r:any)=><option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
              <label className="block text-[11px] font-semibold text-slate-700">
                Owner
                <SearchMasterInput
                  value={tripMasters.suppliers.find((r:any)=>r.id===quickAddForm.supplier_id)?.name||""}
                  options={tripMasters.suppliers.map((r:any)=>({value:r.id,label:r.name}))}
                  placeholder="Search Owner"
                  onSelect={supplierId=>setQuickAddForm({...quickAddForm,ownership_type:"supplier",supplier_id:supplierId})}/>
                <div className="mt-1 text-[10px] text-slate-500">
                  Select the actual Owner name from Owner / Supplier master.
                </div>
              </label>
            </>}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
            <button type="button" className="btn" disabled={quickAddSaving} onClick={()=>setQuickAdd(null)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={quickAddSaving} onClick={()=>void saveQuickAdd()}>
              {quickAddSaving?"Saving...":"Save & Select"}
            </button>
          </div>
        </div>
      </div>
    }

    <div className="mt-2 text-[10px] text-slate-500">
      Trip No is generated automatically. PPR receiver is stamped by NAVILO when status becomes Received.
    </div>
  </div>
  }

  {newTripMode==="bulk"&&
  <div className="space-y-3 p-4">

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

            {bulkRows.map(row=>
              <tr
                key={row.rowNo}
                className="border-t border-slate-100"
              >

                <td className="px-2 py-2 font-semibold">
                  {row.rowNo}
                </td>

                <td className="px-2 py-2">

                  {row.errors.length
                    ? <span
                        className="font-semibold text-red-700"
                        title={row.errors.join("; ")}
                      >
                        Rejected
                      </span>

                    : <span className="font-semibold text-emerald-700">
                        Valid
                      </span>
                  }

                </td>

                <td className="whitespace-nowrap px-2 py-2">{row.trip_date}</td>
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

              </tr>
            )}

          </tbody>

        </table>

      </div>


      <div className="flex items-center justify-between gap-3">

        <span className="text-xs text-slate-500">
          Validation preview only. Nothing has been imported yet.
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
    {tab==="driver-account"&&<TransportAccountRows title="Driver Account / Hisaab" rows={rows} kind="driver" onFinance={setFinancialTrip}/> }
    {tab==="vehicle-account"&&<TransportAccountRows title="Vehicle Account / Gari Hisaab" rows={rows} kind="vehicle" onFinance={setFinancialTrip}/> }
    {initialRateTrip&&<TransportInitialRate trip={initialRateTrip} onClose={()=>setInitialRateTrip(null)} onChanged={load}/>}
    {financialTrip&&<TransportFinancialPanel key={financialTrip.id} trip={financialTrip} onClose={()=>setFinancialTrip(null)} onChanged={load}/>}
  </div>
}
function ColumnFilterMenu({
  label,top,left,options,selected,sortDirection,onSort,onToggle,onSelectAll,onClear,onClose
}:{
  label:string;
  top:number;
  left:number;
  options:string[];
  selected:string[];
  sortDirection:"asc"|"desc"|null;
  onSort:(direction:"asc"|"desc")=>void;
  onToggle:(value:string)=>void;
  onSelectAll:()=>void;
  onClear:()=>void;
  onClose:()=>void;
}){
  const [search,setSearch]=useState("");

  const shown=options.filter(v=>
    v.toLowerCase().includes(search.trim().toLowerCase())
  );

  return <div
    className="fixed z-[9999] w-44 rounded-md border border-slate-200 bg-white p-1.5 text-[10px] normal-case shadow-xl"
    style={{top,left}}
    onClick={e=>e.stopPropagation()}
  >
    <div className="mb-1 flex items-center justify-between leading-none">
      <span className="font-bold text-slate-800">{label}</span>
      <button type="button" onClick={onClose} className="px-1 text-slate-400 hover:text-slate-800">?</button>
    </div>

    <div className="grid grid-cols-2 gap-0.5">
      <button type="button"
        onClick={()=>onSort("asc")}
        className={`rounded border px-1.5 py-1 text-left ${sortDirection==="asc"?"border-blue-300 bg-blue-50 text-blue-700":"border-slate-200"}`}>
        Sort A to Z
      </button>

      <button type="button"
        onClick={()=>onSort("desc")}
        className={`rounded border px-1.5 py-1 text-left ${sortDirection==="desc"?"border-blue-300 bg-blue-50 text-blue-700":"border-slate-200"}`}>
        Sort Z to A
      </button>
    </div>

    <div className="relative mt-1">
      <Search className="absolute left-1.5 top-1.5 h-3 w-3 text-slate-400"/>
      <input
        autoFocus
        value={search}
        onChange={e=>setSearch(e.target.value)}
        placeholder="Search values..."
        className="h-6 w-full rounded border border-slate-200 pl-5 pr-1.5 text-[10px]"
      />
    </div>

    <div className="mt-1 flex gap-0.5">
      <button type="button" onClick={onSelectAll}
        className="flex-1 rounded border border-slate-200 px-1 py-0.5 font-semibold hover:bg-slate-50">
        Select All
      </button>

      <button type="button" onClick={onClear}
        className="flex-1 rounded border border-slate-200 px-1 py-0.5 font-semibold hover:bg-slate-50">
        Clear
      </button>
    </div>

    <div className="mt-1 max-h-52 overflow-y-auto border-t border-slate-100 pt-1">
      {shown.map(value=>
        <label key={value} className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-50">
          <input
            type="checkbox"
            checked={selected.includes(value)}
            onChange={()=>onToggle(value)}
          />
          <span className="min-w-0 flex-1 truncate">{value}</span>
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
        <button type="button" title={`Add ${label}`}
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
    <input type="date" value={value} onChange={e=>setValue(e.target.value)}
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

function TransportAccountRows({title,rows,kind,onFinance}:{title:string;rows:Trip[];kind:'driver'|'vehicle';onFinance:(trip:Trip)=>void}){
 const [search,setSearch]=useState('');
 const filtered=rows.filter(r=>`${r.trip_no} ${r.driver_name??''} ${r.vehicle_no??''}`.toLowerCase().includes(search.toLowerCase()));
 return <section className="rounded-lg border bg-white p-3"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">{title}</h2><input aria-label={`Search ${title}`} className="input" placeholder="Trip / driver / vehicle" value={search} onChange={e=>setSearch(e.target.value)}/></div>
 <TransportAccountStatement kind={kind}/><div className="overflow-auto"><table className="w-full text-xs"><thead><tr><th className="text-left">Trip</th><th className="text-left">{kind==='driver'?'Driver':'Current vehicle / owner'}</th><th>Status</th><th>Accrued / Billed</th><th>Paid</th><th>Outstanding</th><th>Posted Trip profit</th></tr></thead><tbody>{filtered.map(r=><tr className="border-t" key={r.id}><td><button className="text-blue-700 underline" onClick={()=>onFinance(r)}>{r.trip_no}</button></td><td>{kind==='driver'?r.driver_name:`${r.vehicle_no??''} / ${r.owner_name??''}`}</td><td>{r.financial_status}</td><td className="text-right">{financialNumber(kind==='driver'?r.driver_accrued:r.billed_supplier_net)}</td><td className="text-right">{financialNumber(kind==='driver'?r.driver_paid:r.supplier_paid_net)}</td><td className="text-right">{financialNumber(kind==='driver'?r.driver_outstanding:r.supplier_outstanding_gross)}</td><td className="text-right">{financialNumber(r.trip_profit)}</td></tr>)}</tbody></table></div></section>;
}
