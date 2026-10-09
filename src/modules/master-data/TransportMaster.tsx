import NaviloSearchableSelect from "@/components/SearchableSelect";
import {vehicleDisplayLabel} from "@/lib/transportVehicleLabel";
import NaviloDateInput from '@/components/NaviloDateInput';
import { formatNaviloDate } from "@/lib/naviloDate";
import type { MasterQuickCreate } from "./MasterQuickCreate";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Power, Search, X } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { canTransportAction } from "@/auth/permissions";
import { fetchAllPages } from "@/lib/fetchAllPages";
import DataTable, { type Column } from "@/components/DataTable";
import MasterSummaryStrip from "@/components/MasterSummaryStrip";
import MasterActionButton from "@/components/MasterActionButton";
import useTransportMasterClient from "./useTransportMasterClient";

type Kind = "vehicles" | "drivers";
type Row = { id: string; name: string; detail: string; mobile: string; owner: string; active: boolean;
  truckTypeId: string; ownerType: string; supplierId: string; driverType: string;
  identityNo: string; licenceNo: string; licenceExpiry: string; employeeId: string };
type Option = { id: string; name: string; is_active: boolean };
const EMPTY = { name: "", detail: "", mobile: "", truckTypeId: "", ownerType: "company", supplierId: "",
  driverType: "company", employeeId: "", identityNo: "", licenceNo: "", licenceExpiry: "", effectiveFrom: "" };

export default function TransportMaster({ kind, quickCreate }: { kind: Kind; quickCreate?: MasterQuickCreate }) {
  const { activeCompany, activeBusinessUnit, isPlatformOwner } = useAuth();
  const supabase = useTransportMasterClient();
  const vehicle = kind === "vehicles";
  const [rows, setRows] = useState<Row[]>([]);
  const [truckTypes, setTruckTypes] = useState<Option[]>([]);
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [employees, setEmployees] = useState<Option[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [show, setShow] = useState(Boolean(quickCreate));
  const createdRecord=useRef<{id:string;name:string;truck_type_id:string}|null>(null);
  const submitting=useRef(false);
  const closeEditor=()=>{setShow(false);quickCreate?.onClose();};
  const [editing, setEditing] = useState<Row | null>(null);
  const initialForm={...EMPTY,name:quickCreate?.initialName??"",truckTypeId:quickCreate?.truckTypeId??"",supplierId:quickCreate?.supplierId??""};
  const [form, setForm] = useState(initialForm);
  const role = activeBusinessUnit?.membership_role ?? activeCompany?.membership_role;
  const permissions = {...activeCompany?.permissions,...activeBusinessUnit?.permissions,transport_actions:{...((activeCompany?.permissions?.transport_actions??{}) as Record<string,boolean>),...((activeBusinessUnit?.permissions?.transport_actions??{}) as Record<string,boolean>)}};
  const allowed = Boolean(quickCreate?.allowTransportMobileCreate) || canTransportAction(role, permissions, "master_manage", isPlatformOwner);
  const canAddOwner = canTransportAction(role, permissions, "vehicle_owner_change", isPlatformOwner);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [records, types, parties, history, employeeRows] = await Promise.all([
        fetchAllPages<any>((start, end) => supabase.from(vehicle ? "transport_vehicles" : "transport_drivers")
          .select("*").order("id").range(start, end)),
        vehicle ? fetchAllPages<Option>((start, end) => supabase.from("transport_truck_types")
          .select("id,name,is_active").order("id").range(start, end)) : Promise.resolve([]),
        fetchAllPages<Option>((start, end) => supabase.from("suppliers")
          .select("id,name,is_active").order("id").range(start, end)),
        vehicle ? fetchAllPages<any>((start, end) => supabase.from("transport_vehicle_ownership")
          .select("*").order("id").range(start, end)) : Promise.resolve([]),
        !vehicle ? fetchAllPages<Option>((start, end) => supabase.from("employees")
          .select("id,name,is_active").order("name").range(start, end)) : Promise.resolve([]),
      ]);
      setTruckTypes(types); setSuppliers(parties); setEmployees(employeeRows);
      setRows(records.map(x => {
        const today = new Date().toLocaleDateString("en-CA");
        const saved = history.filter(h => h.vehicle_id === x.id);
        const current = saved.find(h => h.effective_from <= today && (!h.effective_to || h.effective_to >= today));
        return { id: x.id, name: vehicle ? x.vehicle_no : x.driver_name,
        detail: vehicle ? x.truck_type ?? "" : x.driver_code ?? "", mobile: x.mobile ?? "",
        owner: current?.owner_name_snapshot ?? (saved.length ? "No current ownership period" : x.owner_name ?? ""), active: x.is_active, truckTypeId: x.truck_type_id ?? "",
        ownerType: current ? (current.owner_type === "third_party" ? "supplier" : "company") : saved.length ? "" : x.ownership_type ?? "", supplierId: current ? current.supplier_id ?? "" : saved.length ? "" : x.supplier_id ?? "", driverType: x.driver_type ?? "",
        identityNo: x.identity_no ?? "", licenceNo: x.driving_licence_no ?? "", licenceExpiry: x.licence_expiry ?? "", employeeId: x.employee_id ?? "" }; }));
    } catch (failure: any) { setRows([]); setTruckTypes([]); setSuppliers([]); setError(failure.message ?? "Unable to load masters."); }
    finally { setLoading(false); }
  }, [supabase, vehicle]);
  useEffect(() => { setShow(Boolean(quickCreate)); setEditing(null); setForm(initialForm); void load(); }, [load]);
  const partyName = (row: Row) => suppliers.find(s => s.id === row.supplierId)?.name ?? row.owner;
  const filtered = useMemo(() => rows.filter(row => (status === "all" || (status === "active") === row.active) &&
    (!q.trim() || [row.name, row.detail, row.mobile, row.owner, suppliers.find(s => s.id === row.supplierId)?.name ?? "",
      truckTypes.find(t => t.id === row.truckTypeId)?.name ?? ""].join(" ").toLowerCase().includes(q.trim().toLowerCase()))),
  [rows, status, q, suppliers, truckTypes]);
  const openAdd = () => { setEditing(null); setForm(EMPTY); setError(""); setShow(true); };
  const openEdit = (row: Row) => {
    setEditing(row); setForm({ ...EMPTY, ...row, effectiveFrom: "" }); setError(""); setShow(true);
  };
  const changed = async () => { window.dispatchEvent(new Event("navilo-master-data-changed")); await load(); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if(submitting.current)return; setError("");
    if (!allowed || !activeCompany?.company_id || !activeBusinessUnit?.business_unit_id) return setError("Select an authorized Transport workspace.");
    if (!form.name.trim()) return setError(vehicle ? "Vehicle number is required." : "Driver name is required.");
    if (vehicle && !editing && (!canAddOwner || !form.effectiveFrom)) return setError("Owner-history permission and actual Effective From date are required.");
    const supplierRequired = vehicle ? !editing && form.ownerType === "supplier" : form.driverType === "supplier";
    if (supplierRequired && !form.supplierId) return setError("Select the Supplier.");
    if (!vehicle && !form.driverType) return setError("Select Company Driver or Supplier Driver.");
    if (!vehicle && form.driverType === "company" && !form.employeeId) return setError("Select the Employee for a Company Driver.");
    submitting.current=true; setSaving(true);
    try {
      const result = createdRecord.current ? {data:createdRecord.current.id,error:null} : vehicle
        ? editing
          ? await supabase.from("transport_vehicles").update({ vehicle_no: form.name.trim(), truck_type_id: form.truckTypeId || null })
            .eq("id", editing.id).select("id").single()
          : await supabase.rpc("transport_create_vehicle_master", { p_vehicle_no: form.name.trim(),
            p_truck_type_id: form.truckTypeId || null, p_owner_type: form.ownerType,
            p_supplier_id: form.ownerType === "supplier" ? form.supplierId : null, p_effective_from: form.effectiveFrom })
        : await (() => {
          const fields = { driver_name: form.name.trim(), driver_code: form.detail.trim() || null,
            mobile: form.mobile.trim() || null, driver_type: form.driverType,
            supplier_id: form.driverType === "supplier" ? form.supplierId : null,
            employee_id: form.driverType === "company" ? form.employeeId : null,
            identity_no: form.identityNo.trim() || null, driving_licence_no: form.licenceNo.trim() || null,
            licence_expiry: form.licenceExpiry || null };
          return editing ? supabase.from("transport_drivers").update(fields).eq("id", editing.id).select("id").single()
            : supabase.from("transport_drivers").insert(fields).select("id").single();
        })();
      if (result.error) throw result.error;
      if(quickCreate){
        const id=typeof result.data==="string"?result.data:result.data?.id;
        if(!id)throw new Error("Master creation returned no record ID.");
        createdRecord.current ??= {id,name:form.name.trim(),truck_type_id:form.truckTypeId};
        window.dispatchEvent(new Event("navilo-master-data-changed"));
        await quickCreate.onCreated(createdRecord.current);quickCreate.onClose();return;
      }
      setShow(false); setEditing(null); setForm(EMPTY); await changed();
    } catch (failure: any) { setError(failure.message ?? "Unable to save master."); }
    finally { submitting.current=false; setSaving(false); }
  };
  const toggle = async (row: Row) => {
    if (!allowed) return;
    const result = await supabase.from(vehicle ? "transport_vehicles" : "transport_drivers")
      .update({ is_active: !row.active }).eq("id", row.id).select("id").single();
    if (result.error) setError(result.error.message); else await changed();
  };
  const columns: Column<Row>[] = [
    { key: "name", label: vehicle ? "Vehicle No / Plate No" : "Driver Name", render: row => <span className="font-semibold">{vehicle ? vehicleDisplayLabel(row.name,truckTypes.find(t=>t.id===row.truckTypeId)?.name??row.detail) : row.name}</span> },
    { key: "detail", label: vehicle ? "Truck Type" : "Driver Code", render: row => vehicle ? truckTypes.find(t => t.id === row.truckTypeId)?.name ?? (row.detail || "—") : row.detail || "—" },
    ...(!vehicle ? [{ key: "mobile", label: "Mobile", render: (row: Row) => row.mobile || "—" } as Column<Row>] : []),
    { key: "type", label: vehicle ? "Ownership Type" : "Driver Type", render: row => (vehicle ? row.ownerType : row.driverType) === "supplier" ? "Supplier" : (vehicle ? row.ownerType : row.driverType) === "company" ? "Company" : "Legacy / not classified" },
    { key: "owner", label: "Supplier / Owner", render: row => partyName(row) || "—" },
    ...(!vehicle ? [{ key: "licence", label: "Licence Expiry", render: (row: Row) => formatNaviloDate(row.licenceExpiry) } as Column<Row>] : []),
    { key: "status", label: "Status", render: row => row.active ? "Active" : "Inactive" },
    { key: "actions", label: "Actions", className: "text-right", render: row => allowed && <div className="flex justify-end gap-2">
      <button className="btn-secondary px-2 py-1 text-xs" onClick={() => openEdit(row)}><Pencil className="inline h-3.5 w-3.5" /> Edit</button>
      <MasterActionButton tone="danger" title={`${row.active ? "Deactivate" : "Activate"} ${vehicle ? "Vehicle" : "Driver"}`}
        message="Historical Transport records remain unchanged. Inactive masters cannot be selected for new Trips."
        onConfirm={() => toggle(row)} className="btn-secondary px-2 py-1 text-xs"><Power className="inline h-3.5 w-3.5" /> {row.active ? "Deactivate" : "Activate"}</MasterActionButton>
    </div> },
  ];
  const supplierOptions = suppliers.filter(s => s.is_active || s.id === form.supplierId);
  const editor = <div role="dialog" aria-modal="true" aria-labelledby="transport-master-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={save} className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3"><h2 id="transport-master-title" className="font-bold">{editing ? "Edit" : "Add"} {vehicle ? "Vehicle" : "Driver"}</h2><button type="button" className="btn" aria-label="Close" onClick={closeEditor}><X className="h-4 w-4" /></button></div>
        {quickCreate && error && <div role="alert" className="px-5 pt-3 text-xs text-red-700">{error}</div>}
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <label className="text-xs font-semibold">{vehicle ? "Vehicle No / Plate No" : "Driver Name"} *<input className="input mt-1 w-full" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
          {vehicle ? <label className="text-xs font-semibold">Truck Type<NaviloSearchableSelect nativeCompatibility preserveLabel className="input mt-1 w-full" value={form.truckTypeId} onChange={e => setForm({ ...form, truckTypeId: e.target.value })}><option value="">Select Truck Type</option>{truckTypes.filter(t => t.is_active || t.id === form.truckTypeId).map(t => <option key={t.id} value={t.id}>{t.name}{!t.is_active ? " (Inactive)" : ""}</option>)}</NaviloSearchableSelect></label>
            : <label className="text-xs font-semibold">Driver Code<input className="input mt-1 w-full" value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })} /></label>}
          {vehicle && editing ? <div className="text-xs sm:col-span-2">Owner: {partyName(editing) || "Legacy / not classified"}. <Link className="text-blue-700 underline" to="/master-data/vehicle-ownership">Change through Vehicle Ownership History</Link></div>
            : <><label className="text-xs font-semibold">{vehicle ? "Ownership Type" : "Driver Type"}<NaviloSearchableSelect nativeCompatibility preserveLabel required className="input mt-1 w-full" value={vehicle ? form.ownerType : form.driverType} onChange={e => setForm({ ...form, ...(vehicle ? { ownerType: e.target.value } : { driverType: e.target.value, employeeId: "" }), supplierId: "" })}>
              <option value="">Select type</option><option value="company">{vehicle ? "Company Owned" : "Company Driver"}</option><option value="supplier">{vehicle ? "Supplier Owned" : "Supplier Driver"}</option></NaviloSearchableSelect></label>
              {!vehicle && form.driverType === "company" && <label className="text-xs font-semibold">Employee *<NaviloSearchableSelect nativeCompatibility preserveLabel required className="input mt-1 w-full" value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })}><option value="">Select Employee</option>{employees.filter(e => e.is_active || e.id === form.employeeId).map(e => <option key={e.id} value={e.id}>{e.name}{!e.is_active ? " (Inactive)" : ""}</option>)}</NaviloSearchableSelect></label>}
              {(vehicle ? form.ownerType : form.driverType) === "supplier" && <label className="text-xs font-semibold">Supplier *<NaviloSearchableSelect nativeCompatibility preserveLabel required className="input mt-1 w-full" value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })}><option value="">Select Supplier</option>{supplierOptions.map(s => <option key={s.id} value={s.id}>{s.name}{!s.is_active ? " (Inactive)" : ""}</option>)}</NaviloSearchableSelect></label>}</>}
          {vehicle && !editing && <label className="text-xs font-semibold">Ownership Effective From *<NaviloDateInput required type="date" className="input mt-1 w-full" value={form.effectiveFrom} onChange={e => setForm({ ...form, effectiveFrom: e.target.value })} /></label>}
          {!vehicle && <><label className="text-xs font-semibold">Mobile<input className="input mt-1 w-full" value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} /></label>
            <label className="text-xs font-semibold">ID / CNIC / Iqama<input className="input mt-1 w-full" value={form.identityNo} onChange={e => setForm({ ...form, identityNo: e.target.value })} /></label>
            <label className="text-xs font-semibold">Driving Licence No<input className="input mt-1 w-full" value={form.licenceNo} onChange={e => setForm({ ...form, licenceNo: e.target.value })} /></label>
            <label className="text-xs font-semibold">Licence Expiry<NaviloDateInput type="date" className="input mt-1 w-full" value={form.licenceExpiry} onChange={e => setForm({ ...form, licenceExpiry: e.target.value })} /></label></>}
        </div><div className="flex justify-end gap-2 border-t px-5 py-3"><button type="button" className="btn-secondary" onClick={closeEditor}>Cancel</button><button className="btn-primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button></div>
      </form></div>;
  if(quickCreate) return allowed && (!vehicle || canAddOwner) ? editor : <div role="alert">Master / ownership permission required.</div>;
  return <div className="space-y-4" data-navilo-master-standard="true">
    <MasterSummaryStrip kind={kind} title={vehicle ? "Vehicles" : "Drivers"} subtitle={vehicle ? "Vehicle identities and dated ownership" : "Drivers are independent of permanent Vehicle assignments"}
      total={rows.length} active={rows.filter(r => r.active).length} inactive={rows.filter(r => !r.active).length} fourthLabel="Displayed" fourthValue={filtered.length} />
    <div className="flex justify-end gap-2" data-no-print data-no-export>{vehicle && <Link className="btn-secondary" to="/master-data/vehicle-ownership">Vehicle Ownership History</Link>}
      {allowed && (!vehicle || canAddOwner) && <button className="btn-primary" onClick={openAdd}><Plus className="h-4 w-4" />Add {vehicle ? "Vehicle" : "Driver"}</button>}</div>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
    <div className="navilo-master-filterbar flex flex-wrap items-center gap-2 px-3 py-2" data-no-print data-no-export>
      <div className="relative min-w-52 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="input w-full pl-9"
        aria-label={`Search ${kind}`} placeholder={vehicle ? "Search vehicle, type or supplier..." : "Search driver, code, mobile or supplier..."} value={q} onChange={e => setQ(e.target.value)} /></div>
      <NaviloSearchableSelect nativeCompatibility preserveLabel aria-label="Status" className="input" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option></NaviloSearchableSelect>
    </div>
    <div data-report-content data-navilo-customizable="true" data-navilo-print-surface className="contents"><DataTable showSerialNumber columns={columns} rows={filtered} loading={loading} emptyMessage={`No ${kind} found.`} /></div>
    {show && editor}
  </div>;
}
