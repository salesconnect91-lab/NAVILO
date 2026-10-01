import { useEffect, useMemo, useState } from "react";
import { Search, Plus, Upload, Route, History, ReceiptText, UserRound, Truck, RefreshCw } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";

type Tab="trips"|"new"|"audit"|"driver-expenses"|"driver-account"|"vehicle-account";
type Trip={
  id:string;
  trip_no:string;
  trip_date:string;
  customer_name:string|null;
  vehicle_no:string|null;
  driver_name:string|null;
  from_location:string;
  to_location:string;
  trip_status:string|null;
  job_status:string|null;
  ppr_status:string|null;
  customer_rate:number|null;
  supplier_rent:number|null;
  trip_margin:number|null;
  po_do_job_no?:string|null;
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
  "Sale Type `n( Cash / Credit)"
] as const;

export default function TransportWorkspace(){
  const {activeCompany,activeBusinessUnit}=useAuth();

  const [tab,setTab]=useState<Tab>("trips");
  const [rows,setRows]=useState<Trip[]>([]);
  const [loading,setLoading]=useState(false);

  const [error,setError]=useState("");

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

  const [form,setForm]=useState({
    trip_date:new Date().toISOString().slice(0,10),
    customer_name_snapshot:"",
    from_location:"",
    to_location:"",
    po_do_job_no:"",
    customer_rate:"",
    supplier_rent:"",
    notes:""
  });

  async function load(){
    setLoading(true);
    setError("");

    try{
      const pageSize=1000;
      let from=0;
      const all:Trip[]=[];

      while(true){
        const {data,error}=await supabase
          .from("transport_trip_register")
          .select("*")
          .order("trip_date",{ascending:false})
          .order("trip_no",{ascending:false})
          .range(from,from+pageSize-1);

        if(error) throw error;

        const batch=(data??[]) as Trip[];
        all.push(...batch);

        if(batch.length<pageSize) break;
        from+=pageSize;
      }

      setRows(all);
    }catch(e:any){
      setError(e?.message||"Unable to load trips.");
    }finally{
      setLoading(false);
    }
  }

  useEffect(()=>{
    if(activeCompany?.company_id&&activeBusinessUnit?.business_unit_id) void load();
  },[activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);

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
    String(r.trip_status??"").toLowerCase()==="completed"
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

  const tripsGridWheel=(e:React.WheelEvent<HTMLDivElement>)=>{
    const el=e.currentTarget;

    e.preventDefault();
    e.stopPropagation();

    const delta=
      Math.abs(e.deltaX)>Math.abs(e.deltaY)
        ? e.deltaX
        : e.deltaY;

    el.scrollLeft+=delta;
  };


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

  async function createTrip(){
    if(!form.from_location.trim()||!form.to_location.trim()){setError("From and To locations are required.");return}
    setLoading(true);setError("");
    const payload={company_id:activeCompany?.company_id,business_unit_id:activeBusinessUnit?.business_unit_id,trip_no:"",trip_date:form.trip_date,customer_name_snapshot:form.customer_name_snapshot||null,from_location:form.from_location,to_location:form.to_location,po_do_job_no:form.po_do_job_no||null,customer_rate:form.customer_rate?Number(form.customer_rate):null,supplier_rent:form.supplier_rent?Number(form.supplier_rent):null,notes:form.notes||null};
    const {error}=await supabase.from("transport_trips").insert(payload);
    if(error)setError(error.message);else{setForm({...form,customer_name_snapshot:"",from_location:"",to_location:"",po_do_job_no:"",customer_rate:"",supplier_rent:"",notes:""});setTab("trips");await load()}
    setLoading(false);
  }


  const tripCellValue=(r:Trip,key:string):string=>{
    switch(key){
      case "trip_no": return String(r.trip_no??"");
      case "trip_date": return String(r.trip_date??"");
      case "truck_type": return "";
      case "job_no": return String(r.po_do_job_no??"");
      case "invoiced": return "";
      case "company": return String(r.customer_name??"");
      case "driver": return String(r.driver_name??"");
      case "owner": return "";
      case "plate": return String(r.vehicle_no??"");
      case "from": return String(r.from_location??"");
      case "to": return String(r.to_location??"");
      case "paper_received_by": return "";
      case "ppr_date": return "";
      case "pay_driver": return "";
      case "rent_driver": return r.supplier_rent==null?"":String(r.supplier_rent);
      case "remaining_us": return "";
      case "payment_date": return "";
      case "amount": return "";
      case "company_rate": return r.customer_rate==null?"":String(r.customer_rate);
      case "received_company": return "";
      case "remaining_company": return "";
      case "profit": return r.trip_margin==null?"":String(r.trip_margin);
      case "commission": return "";
      case "sale_type": return "";
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
  };

  return <div className="mx-auto w-full max-w-[1800px] space-y-1 p-1.5">


    <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
      <nav className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto" aria-label="Transport workspace">
        {tabs.map(t=>{const I=t.icon;return <button key={t.key} onClick={()=>setTab(t.key)} className={`flex min-w-max items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${tab===t.key?"bg-slate-900 text-white":"text-slate-600 hover:bg-slate-100"}`}><I className="h-3.5 w-3.5"/>{t.label}</button>})}
      </nav>


    </div>

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
        className="min-h-[220px] overscroll-contain overflow-auto border-t border-slate-200 bg-white"
        style={{height:tripsGridHeight}}
        onWheel={tripsGridWheel}
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
              <td className="sticky left-0 z-[5] border-b border-slate-100 bg-white px-1.5 py-0.5 font-bold text-slate-900">{r.trip_no}</td>

              {/* BuKu operational register order */}
              <td className="border-b border-slate-100 px-1.5 py-0.5">{r.trip_date}</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5">?</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5">?</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5">?</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5">{r.customer_name||"?"}</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5">{r.driver_name||"?"}</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5">?</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5">{r.vehicle_no||"?"}</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5">{r.from_location||"?"}</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5">{r.to_location||"?"}</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5">?</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5">?</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5 text-right">?</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5 text-right">{r.supplier_rent?.toLocaleString()??"?"}</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5 text-right">?</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5">?</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5 text-right">?</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5 text-right">{r.customer_rate?.toLocaleString()??"?"}</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5 text-right">?</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5 text-right">?</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5 text-right font-bold">{r.trip_margin?.toLocaleString()??"?"}</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5 text-right">?</td>
              <td className="border-b border-slate-100 px-1.5 py-0.5">?</td>
            </tr>)}
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
        New Trip
      </h2>

      <p className="text-xs text-slate-500">
        Trip number is generated automatically by NAVILO.
      </p>
    </div>

    <div className="flex items-center gap-1 px-4 pb-3">
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
    </div>
  </div>


  {newTripMode==="single"&&
  <div className="p-4">

    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">

      <label className="text-xs font-semibold">
        Trip Date
        <input
          type="date"
          value={form.trip_date}
          onChange={e=>setForm({...form,trip_date:e.target.value})}
          className="mt-1 w-full rounded-lg border p-2 text-sm"
        />
      </label>

      <label className="text-xs font-semibold">
        Customer
        <input
          value={form.customer_name_snapshot}
          onChange={e=>setForm({...form,customer_name_snapshot:e.target.value})}
          className="mt-1 w-full rounded-lg border p-2 text-sm"
          placeholder="Customer"
        />
      </label>

      <label className="text-xs font-semibold">
        Job / PO / DO
        <input
          value={form.po_do_job_no}
          onChange={e=>setForm({...form,po_do_job_no:e.target.value})}
          className="mt-1 w-full rounded-lg border p-2 text-sm"
        />
      </label>

      <label className="text-xs font-semibold">
        From
        <input
          value={form.from_location}
          onChange={e=>setForm({...form,from_location:e.target.value})}
          className="mt-1 w-full rounded-lg border p-2 text-sm"
        />
      </label>

      <label className="text-xs font-semibold">
        To
        <input
          value={form.to_location}
          onChange={e=>setForm({...form,to_location:e.target.value})}
          className="mt-1 w-full rounded-lg border p-2 text-sm"
        />
      </label>

      <label className="text-xs font-semibold">
        Customer Rate
        <input
          type="number"
          value={form.customer_rate}
          onChange={e=>setForm({...form,customer_rate:e.target.value})}
          className="mt-1 w-full rounded-lg border p-2 text-sm"
        />
      </label>

      <label className="text-xs font-semibold">
        Supplier Rent
        <input
          type="number"
          value={form.supplier_rent}
          onChange={e=>setForm({...form,supplier_rent:e.target.value})}
          className="mt-1 w-full rounded-lg border p-2 text-sm"
        />
      </label>

      <label className="text-xs font-semibold md:col-span-2">
        Notes
        <input
          value={form.notes}
          onChange={e=>setForm({...form,notes:e.target.value})}
          className="mt-1 w-full rounded-lg border p-2 text-sm"
        />
      </label>

    </div>

    <div className="mt-4 flex justify-end gap-2">

      <button
        className="btn"
        onClick={()=>setTab("trips")}
      >
        Cancel
      </button>

      <button
        className="btn-primary"
        onClick={()=>void createTrip()}
        disabled={loading}
      >
        Create Trip
      </button>

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

    {tab==="audit"&&<SimplePanel title="Trip Audit" text="Searchable immutable trip-change history is backed by transport_trip_audit. Detailed old/new field viewer is the next UI batch."/>}
    {tab==="driver-expenses"&&<SimplePanel title="Driver Expense Upload" text="Foundation table and RLS are active. Manual and Excel validated upload will be connected in the next batch."/>}
    {tab==="driver-account"&&<SimplePanel title="Driver Account / Hisaab" text="This surface will use NAVILO Employee/Payroll/accounting as source of truth; no parallel ledger will be created."/>}
    {tab==="vehicle-account"&&<SimplePanel title="Vehicle Account / Gari Hisaab" text="Vehicle economics will distinguish company-owned and supplier-owned vehicles and will not invent owner rent for company vehicles."/>}
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
