import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, Pencil, Plus, Printer, Search, Upload, X } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { suggestEmployeeName } from "@/lib/employeeLanguageFields";

type Employee = { id: string; user_id: string; employee_code: string | null; name: string; name_urdu: string | null; phone: string | null; designation: string | null; designation_urdu: string | null; department: string | null; department_urdu: string | null; is_active: boolean };
type Form = { name: string; name_urdu: string; phone: string; designation: string; designation_urdu: string; department: string; department_urdu: string; is_active: boolean };
type ImportRow = Form & { rowNo: number; employee_code: string; error: string };
const blank: Form = { name: "", name_urdu: "", phone: "", designation: "", designation_urdu: "", department: "", department_urdu: "", is_active: true };
const clean = (value: unknown) => String(value ?? "").trim();
const escapeHtml = (value: unknown) => clean(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
function urduEnabled() { const root = document.documentElement; return root.dataset.primaryLanguage === "ur" || (root.dataset.languageMode === "bilingual" && root.dataset.secondaryLanguage === "ur"); }

export default function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [showUrdu, setShowUrdu] = useState(urduEnabled);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => setShowUrdu(urduEnabled());
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-primary-language", "data-secondary-language", "data-language-mode"] });
    window.addEventListener("navilo-language-changed", sync);
    window.addEventListener("navilo:language-changed", sync);
    window.addEventListener("navilo-workspace-changed", sync);
    return () => { observer.disconnect(); window.removeEventListener("navilo-language-changed", sync); window.removeEventListener("navilo:language-changed", sync); window.removeEventListener("navilo-workspace-changed", sync); };
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error: failure } = await supabase.from("employees").select("*").order("name");
    if (failure) setError(failure.message);
    else { setEmployees((data ?? []) as Employee[]); setError(""); }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => employees.filter((employee) => (status === "all" || (status === "active") === employee.is_active) && [employee.employee_code, employee.name, employee.phone, employee.designation, employee.department, ...(showUrdu ? [employee.name_urdu, employee.designation_urdu, employee.department_urdu] : [])].some((value) => clean(value).toLowerCase().includes(search.trim().toLowerCase()))), [employees, status, search, showUrdu]);
  const openAdd = () => { setEditing(null); setForm({ ...blank }); setError(""); setShowForm(true); };
  const openEdit = (employee: Employee) => { setEditing(employee); setForm({ name: employee.name, name_urdu: employee.name_urdu ?? "", phone: employee.phone ?? "", designation: employee.designation ?? "", designation_urdu: employee.designation_urdu ?? "", department: employee.department ?? "", department_urdu: employee.department_urdu ?? "", is_active: employee.is_active }); setError(""); setShowForm(true); };
  const autoConvert = (source: "name" | "designation" | "department", target: "name_urdu" | "designation_urdu" | "department_urdu") => {
    if (!urduEnabled()) return;
    const result = suggestEmployeeName(form[source], "ur");
    if (result.status !== "suggested" || !result.value) { setError("Automatic conversion is unavailable. Enter the translation manually."); return; }
    if (form[target] && !window.confirm("Replace the existing translation?")) return;
    setForm((previous) => ({ ...previous, [target]: result.value })); setError("");
  };
  const save = async () => {
    if (!form.name.trim()) { setError("Employee name is required."); return; }
    setSaving(true); setError(""); setSuccess("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Authentication required.");
      const payload = { user_id: user.id, name: form.name.trim(), phone: form.phone.trim() || null, designation: form.designation.trim() || null, department: form.department.trim() || null, is_active: form.is_active, updated_at: new Date().toISOString(), ...(urduEnabled() ? { name_urdu: form.name_urdu.trim() || null, designation_urdu: form.designation_urdu.trim() || null, department_urdu: form.department_urdu.trim() || null } : {}) };
      const result = editing ? await supabase.from("employees").update(payload).eq("id", editing.id).eq("user_id", user.id) : await supabase.from("employees").insert({ ...payload, employee_code: null });
      if (result.error) throw result.error;
      setShowForm(false); setEditing(null); setForm({ ...blank }); await load(); setSuccess(editing ? "Employee updated successfully." : "Employee added successfully.");
    } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : "Unable to save employee."); }
    finally { setSaving(false); }
  };
  const toggle = async (employee: Employee) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Authentication required."); return; }
    const result = await supabase.from("employees").update({ is_active: !employee.is_active, updated_at: new Date().toISOString() }).eq("id", employee.id).eq("user_id", user.id);
    if (result.error) setError(result.error.message); else await load();
  };
  const sheetRows = (template: boolean) => (template ? [{ employee_code: "", name: "Ahmed Khan", name_urdu: "", phone: "03001234567", designation: "Operator", designation_urdu: "", department: "Production", department_urdu: "", is_active: true }] : filtered).map((employee) => ({ "Employee Code": template ? "" : ("employee_code" in employee ? employee.employee_code ?? "" : ""), "Employee Name": employee.name, ...(showUrdu ? { "Employee Urdu Name": employee.name_urdu ?? "" } : {}), Phone: employee.phone ?? "", Designation: employee.designation ?? "", ...(showUrdu ? { "Designation Urdu": employee.designation_urdu ?? "" } : {}), Department: employee.department ?? "", ...(showUrdu ? { "Department Urdu": employee.department_urdu ?? "" } : {}), Active: employee.is_active ? "Yes" : "No" }));
  const downloadSheet = (template: boolean) => { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(sheetRows(template)), "Employees"); XLSX.writeFile(book, template ? "employee_import_template.xlsx" : "employees.xlsx"); };
  const parseImport = async (file: File) => {
    setError(""); setImportRows([]);
    try {
      const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = book.Sheets[book.SheetNames[0]];
      if (!sheet) throw new Error("The file contains no worksheet.");
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const existing = new Set(employees.map((employee) => clean(employee.employee_code).toLowerCase()).filter(Boolean));
      const seen = new Set<string>();
      const rows: ImportRow[] = raw.map((row, index) => {
        const employee_code = clean(row["Employee Code"] ?? row["Code"] ?? row["employee_code"]);
        const name = clean(row["Employee Name"] ?? row["Name"] ?? row["name"]);
        const code = employee_code.toLowerCase();
        const error = !name ? "Employee name is required" : code && (existing.has(code) || seen.has(code)) ? "Duplicate employee code" : "";
        if (code) seen.add(code);
        return { rowNo: index + 2, employee_code, name, name_urdu: urduEnabled() ? clean(row["Employee Urdu Name"] ?? row["Urdu Name"] ?? row["name_urdu"]) : "", phone: clean(row["Phone"] ?? row["phone"]), designation: clean(row["Designation"] ?? row["designation"]), designation_urdu: urduEnabled() ? clean(row["Designation Urdu"] ?? row["designation_urdu"]) : "", department: clean(row["Department"] ?? row["department"]), department_urdu: urduEnabled() ? clean(row["Department Urdu"] ?? row["department_urdu"]) : "", is_active: !["no", "inactive", "false", "0"].includes(clean(row["Active"] ?? row["Status"] ?? row["is_active"]).toLowerCase()), error };
      }).filter((row) => row.employee_code || row.name || row.phone || row.designation || row.department);
      setImportRows(rows); setShowImport(true);
    } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : "Unable to read import file."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };
  const confirmImport = async () => {
    if (!importRows.length || importRows.some((row) => row.error)) { setError("Import requires at least one valid row and no invalid rows."); return; }
    setSaving(true); setError(""); setSuccess("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Authentication required.");
      const payload = importRows.map((row) => ({ user_id: user.id, employee_code: row.employee_code || null, name: row.name, phone: row.phone || null, designation: row.designation || null, department: row.department || null, is_active: row.is_active, ...(urduEnabled() ? { name_urdu: row.name_urdu || null, designation_urdu: row.designation_urdu || null, department_urdu: row.department_urdu || null } : {}) }));
      const result = await supabase.from("employees").insert(payload);
      if (result.error) throw result.error;
      setShowImport(false); setImportRows([]); await load(); setSuccess(`${payload.length} employee(s) imported successfully.`);
    } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : "Employee import failed."); }
    finally { setSaving(false); }
  };
  const print = () => {
    const rows = filtered.map((employee) => `<tr>${[employee.employee_code, employee.name, ...(showUrdu ? [employee.name_urdu] : []), employee.phone, employee.designation, employee.department, employee.is_active ? "Active" : "Inactive"].map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("");
    const popup = window.open("", "_blank", "width=1100,height=750");
    if (!popup) { setError("Allow pop-ups to print employees."); return; }
    popup.document.write(`<!doctype html><html><head><title>Employees</title><style>body{font-family:Arial,sans-serif;padding:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:8px;text-align:left;font-size:12px}</style></head><body><h1>Employees</h1><p>Total Records: ${filtered.length}</p><div data-report-content data-navilo-customizable="true" className="contents"><table><thead><tr>${["Code", "Name", ...(showUrdu ? ["Urdu Name"] : []), "Phone", "Designation", "Department", "Status"].map((label) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></body></html>`);
    popup.document.close(); popup.focus(); popup.print();
  };
  const field = (label: string, key: "name" | "phone" | "designation" | "department", required = false) => <label className="text-xs font-semibold">{label}{required ? " *" : ""}<input className="input mt-1 w-full" value={form[key]} onChange={(event) => setForm((previous) => ({ ...previous, [key]: event.target.value }))} required={required} /></label>;
  const translated = (label: string, source: "name" | "designation" | "department", target: "name_urdu" | "designation_urdu" | "department_urdu") => showUrdu ? <label data-language-code="ur" className="text-xs font-semibold"><span className="flex items-center justify-between">{label}<button type="button" className="text-primary-600" onClick={() => autoConvert(source, target)}>Auto Convert</button></span><input dir="rtl" className="input mt-1 w-full text-right" value={form[target]} onChange={(event) => setForm((previous) => ({ ...previous, [target]: event.target.value }))} /></label> : null;
  return <div className="space-y-4" data-navilo-master-standard="true">
    <div className="rounded-xl border bg-white p-4 shadow-sm flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-bold">Employees</h1><p className="text-xs text-slate-500">Manage employee master records</p></div><button className="btn-primary" onClick={openAdd}><Plus className="h-4 w-4" /> Add Employee</button></div>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
    {success && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">{success}</div>}
    <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center gap-2"><div className="relative flex-1 min-w-48"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="input w-full pl-9" placeholder="Search employees" value={search} onChange={(event) => setSearch(event.target.value)} /></div><select className="input" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option></select><button className="btn" onClick={() => void load()}>Refresh</button></div>
    <div className="mt-4 overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b bg-slate-50 text-left">{["Code", "Employee", ...(showUrdu ? ["Urdu Name"] : []), "Phone", "Designation", "Department", "Status", "Actions"].map((heading) => <th key={heading} className="px-3 py-2">{heading}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={showUrdu ? 8 : 7} className="p-8 text-center">Loading employees...</td></tr> : filtered.length === 0 ? <tr><td colSpan={showUrdu ? 8 : 7} className="p-8 text-center">No employees found</td></tr> : filtered.map((employee) => <tr key={employee.id} className="border-b"><td className="px-3 py-2">{employee.employee_code || "—"}</td><td className="px-3 py-2 font-semibold">{employee.name}</td>{showUrdu && <td data-language-code="ur" className="px-3 py-2">{employee.name_urdu || "—"}</td>}<td className="px-3 py-2">{employee.phone || "—"}</td><td className="px-3 py-2">{employee.designation || "—"}</td><td className="px-3 py-2">{employee.department || "—"}</td><td className="px-3 py-2"><button type="button" className="btn" onClick={() => void toggle(employee)}>{employee.is_active ? "Active" : "Inactive"}</button></td><td className="px-3 py-2"><button className="btn" title="Edit" onClick={() => openEdit(employee)}><Pencil className="h-4 w-4" /></button></td></tr>)}</tbody></table></div><p className="mt-3 text-xs text-slate-500">Showing {filtered.length} of {employees.length} employees</p></div>
    {showForm && <div role="dialog" aria-modal="true" aria-label={editing ? "Edit Employee" : "Add Employee"} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl"><div className="flex items-center justify-between border-b px-5 py-4"><h2 className="font-bold">{editing ? "Edit Employee" : "Add Employee"}</h2><button className="btn" aria-label="Close" onClick={() => setShowForm(false)}><X className="h-4 w-4" /></button></div><div className="grid gap-4 p-5 sm:grid-cols-2"><label className="text-xs font-semibold">Employee Code<input className="input mt-1 w-full bg-slate-50" value={editing?.employee_code ?? ""} placeholder={editing ? "" : "Auto-generated on save"} readOnly disabled /></label>{field("Employee Name", "name", true)}{translated("Urdu Name", "name", "name_urdu")}{field("Phone", "phone")}{field("Designation", "designation")}{translated("Designation Urdu", "designation", "designation_urdu")}{field("Department", "department")}{translated("Department Urdu", "department", "department_urdu")}<label className="flex items-center gap-2 self-end rounded-lg border p-3 text-xs font-semibold"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm((previous) => ({ ...previous, is_active: event.target.checked }))} /> Active Employee</label></div><div className="flex justify-end gap-2 border-t px-5 py-4"><button className="btn" onClick={() => setShowForm(false)}>Cancel</button><button className="btn-primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : "Save Employee"}</button></div></div></div>}
    {showImport && <div role="dialog" aria-modal="true" aria-label="Employee Import Preview" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-5xl rounded-xl bg-white shadow-xl"><div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-bold">Employee Import Preview</h2><p className="text-xs text-slate-500">Review and validate before import</p></div><button className="btn" aria-label="Close" onClick={() => setShowImport(false)}><X className="h-4 w-4" /></button></div><div className="max-h-[60vh] overflow-auto p-5"><table className="w-full text-xs"><thead><tr className="border-b bg-slate-50 text-left">{["Row", "Code", "Name", ...(showUrdu ? ["Urdu Name"] : []), "Phone", "Designation", "Department", "Validation"].map((heading) => <th key={heading} className="p-2">{heading}</th>)}</tr></thead><tbody>{importRows.map((row) => <tr key={row.rowNo} className={row.error ? "border-b bg-red-50" : "border-b"}><td className="p-2">{row.rowNo}</td><td className="p-2">{row.employee_code || "—"}</td><td className="p-2">{row.name || "—"}</td>{showUrdu && <td data-language-code="ur" className="p-2">{row.name_urdu || "—"}</td>}<td className="p-2">{row.phone || "—"}</td><td className="p-2">{row.designation || "—"}</td><td className="p-2">{row.department || "—"}</td><td className="p-2">{row.error || "Valid"}</td></tr>)}</tbody></table></div><div className="flex items-center justify-between border-t px-5 py-4"><span className="text-xs">{importRows.length} rows • {importRows.filter((row) => row.error).length} invalid</span><div className="flex gap-2"><button className="btn" onClick={() => setShowImport(false)}>Cancel</button><button className="btn-primary" disabled={saving || !importRows.length || importRows.some((row) => row.error)} onClick={() => void confirmImport()}>{saving ? "Importing..." : "Confirm Import"}</button></div></div></div></div>}
  </div>;
}
