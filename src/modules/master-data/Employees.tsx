import SearchableSelect from "@/components/SearchableSelect";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  Pencil,
  Plus,
  Printer,
  Search,
  Upload,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { toUrduName } from "@/lib/urdu";

type Employee = {
  id: string;
  user_id: string;
  employee_code: string | null;
  name: string;
  name_urdu: string | null;
  phone: string | null;
  designation: string | null;
  designation_urdu: string | null;
  department: string | null;
  department_urdu: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

type EmployeeForm = {
  employee_code: string;
  name: string;
  name_urdu: string;
  phone: string;
  designation: string;
  designation_urdu: string;
  department: string;
  department_urdu: string;
  is_active: boolean;
};

type ImportRow = EmployeeForm & {
  rowNo: number;
  error?: string;
};

const emptyForm: EmployeeForm = {
  employee_code: "",
  name: "",
  name_urdu: "",
  phone: "",
  designation: "",
  designation_urdu: "",
  department: "",
  department_urdu: "",
  is_active: true,
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export default function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<EmployeeForm>(emptyForm);

  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadEmployees = async () => {
    setLoading(true);
    setError("");

    const { data, error: loadError } = await supabase
      .from("employees")
      .select("*")
      .order("name");

    if (loadError) {
      setError(loadError.message);
      setEmployees([]);
    } else {
      setEmployees((data ?? []) as Employee[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadEmployees();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return employees.filter((employee) => {
      if (statusFilter === "active" && !employee.is_active) return false;
      if (statusFilter === "inactive" && employee.is_active) return false;

      if (!q) return true;

      return [
        employee.employee_code,
        employee.name,
        employee.phone,
        employee.designation,
        employee.department,
      ].some((value) => String(value ?? "").toLowerCase().includes(q));
    });
  }, [employees, search, statusFilter]);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setShowForm(true);
  };

  const openEdit = (employee: Employee) => {
    setEditing(employee);
    setForm({
      employee_code: employee.employee_code ?? "",
      name: employee.name,
      name_urdu: employee.name_urdu ?? toUrduName(employee.name),
      phone: employee.phone ?? "",
      designation: employee.designation ?? "",
      designation_urdu: employee.designation_urdu ?? toUrduName(employee.designation ?? ""),
      department: employee.department ?? "",
      department_urdu: employee.department_urdu ?? toUrduName(employee.department ?? ""),
      is_active: employee.is_active,
    });
    setError("");
    setShowForm(true);
  };

  const saveEmployee = async () => {
    setError("");
    setSuccess("");

    if (!form.name.trim()) {
      setError("Employee name is required / ملازم کا نام ضروری ہے۔");
      return;
    }

    setSaving(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("Authentication required.");

      const payload = {
        user_id: user.id,
        employee_code: editing ? (editing.employee_code ?? null) : null,
        name: form.name.trim(),
        name_urdu: form.name_urdu.trim() || toUrduName(form.name),
        phone: form.phone.trim() || null,
        designation: form.designation.trim() || null,
        designation_urdu: form.designation_urdu.trim() || toUrduName(form.designation),
        department: form.department.trim() || null,
        department_urdu: form.department_urdu.trim() || toUrduName(form.department),
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      };

      if (editing) {
        const { error: updateError } = await supabase
          .from("employees")
          .update(payload)
          .eq("id", editing.id);

        if (updateError) throw updateError;
        setSuccess("Employee updated successfully / ملازم کامیابی سے اپڈیٹ ہوگیا۔");
      } else {
        const { error: insertError } = await supabase
          .from("employees")
          .insert(payload);

        if (insertError) throw insertError;
        setSuccess("Employee added successfully / ملازم کامیابی سے شامل ہوگیا۔");
      }

      setShowForm(false);
      setEditing(null);
      setForm(emptyForm);
      await loadEmployees();
    } catch (e: any) {
      setError(e?.message || "Unable to save employee.");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (employee: Employee) => {
    setError("");

    const { error: updateError } = await supabase
      .from("employees")
      .update({
        is_active: !employee.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", employee.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await loadEmployees();
  };

  const downloadTemplate = () => {
    const worksheet = XLSX.utils.json_to_sheet([
      {
        "Employee Code": "EMP-001",
        "Employee Name": "Ahmed Khan",
        "Employee Urdu Name": "احمد خان",
        Phone: "03001234567",
        Designation: "Operator",
        "Designation Urdu": "آپریٹر",
        Department: "Production",
        "Department Urdu": "پروڈکشن",
        Active: "Yes",
      },
    ]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Employees");
    XLSX.writeFile(workbook, "employee_import_template.xlsx");
  };

  const exportExcel = () => {
    const rows = filtered.map((employee) => ({
      "Employee Code": employee.employee_code ?? "",
      "Employee Name": employee.name,
      "Employee Urdu Name": employee.name_urdu ?? "",
      Phone: employee.phone ?? "",
      Designation: employee.designation ?? "",
      "Designation Urdu": employee.designation_urdu ?? "",
      Department: employee.department ?? "",
      "Department Urdu": employee.department_urdu ?? "",
      Status: employee.is_active ? "Active" : "Inactive",
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Employees");
    XLSX.writeFile(workbook, "employees.xlsx");
  };

  const parseImport = async (file: File) => {
    setError("");
    setImportRows([]);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
      });

      const existingCodes = new Set(
        employees
          .map((e) => (e.employee_code ?? "").trim().toLowerCase())
          .filter(Boolean)
      );

      const fileCodes = new Set<string>();

      const parsed: ImportRow[] = raw
        .map((row, index) => {
          const employee_code = clean(
            row["Employee Code"] ?? row["Code"] ?? row["employee_code"]
          );
          const name = clean(
            row["Employee Name"] ?? row["Name"] ?? row["name"]
          );
          const name_urdu = clean(row["Employee Urdu Name"] ?? row["Urdu Name"] ?? row["name_urdu"]) || toUrduName(name);
          const phone = clean(row["Phone"] ?? row["phone"]);
          const designation = clean(row["Designation"] ?? row["designation"]);
          const designation_urdu = clean(row["Designation Urdu"] ?? row["designation_urdu"]) || toUrduName(designation);
          const department = clean(row["Department"] ?? row["department"]);
          const department_urdu = clean(row["Department Urdu"] ?? row["department_urdu"]) || toUrduName(department);
          const activeText = clean(
            row["Active"] ?? row["Status"] ?? row["is_active"]
          ).toLowerCase();

          let error = "";

          if (!name) {
            error = "Employee name is required";
          } else if (
            employee_code &&
            (existingCodes.has(employee_code.toLowerCase()) ||
              fileCodes.has(employee_code.toLowerCase()))
          ) {
            error = "Duplicate employee code";
          }

          if (employee_code) fileCodes.add(employee_code.toLowerCase());

          return {
            rowNo: index + 2,
            employee_code,
            name,
            name_urdu,
            phone,
            designation,
            designation_urdu,
            department,
            department_urdu,
            is_active: !["no", "inactive", "false", "0"].includes(activeText),
            error,
          };
        })
        .filter(
          (row) =>
            row.employee_code ||
            row.name ||
            row.phone ||
            row.designation ||
            row.department
        );

      setImportRows(parsed);
      setShowImport(true);
    } catch (e: any) {
      setError(e?.message || "Unable to read import file.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const confirmImport = async () => {
    const invalid = importRows.filter((row) => row.error);
    if (invalid.length) {
      setError(
        "Fix invalid rows before import / امپورٹ سے پہلے غلط قطاریں درست کریں۔"
      );
      return;
    }

    if (!importRows.length) {
      setError("No rows to import / امپورٹ کیلئے کوئی ریکارڈ نہیں۔");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("Authentication required.");

      const payload = importRows.map((row) => ({
        user_id: user.id,
        employee_code: row.employee_code || null,
        name: row.name,
        name_urdu: row.name_urdu || toUrduName(row.name),
        phone: row.phone || null,
        designation: row.designation || null,
        designation_urdu: row.designation_urdu || toUrduName(row.designation),
        department: row.department || null,
        department_urdu: row.department_urdu || toUrduName(row.department),
        is_active: row.is_active,
      }));

      const { error: insertError } = await supabase
        .from("employees")
        .insert(payload);

      if (insertError) throw insertError;

      setSuccess(
        `${payload.length} employee(s) imported successfully / ملازمین کامیابی سے امپورٹ ہوگئے۔`
      );
      setImportRows([]);
      setShowImport(false);
      await loadEmployees();
    } catch (e: any) {
      setError(e?.message || "Employee import failed.");
    } finally {
      setSaving(false);
    }
  };

  const printEmployees = () => {
    const rows = filtered
      .map(
        (employee) => `
          <tr>
            <td>${employee.employee_code ?? ""}</td>
            <td>${employee.name}</td>
            <td>${employee.phone ?? ""}</td>
            <td>${employee.designation ?? ""}</td>
            <td>${employee.department ?? ""}</td>
            <td>${employee.is_active ? "Active" : "Inactive"}</td>
          </tr>`
      )
      .join("");

    const win = window.open("", "_blank", "width=1100,height=750");
    if (!win) return;

    win.document.write(`
      <!doctype html>
      <html>
      <head>
        <title>Employees</title>
        <style>
          body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}
          h1{font-size:20px;margin-bottom:4px}
          p{font-size:12px;color:#64748b}
          table{width:100%;border-collapse:collapse;margin-top:20px}
          th,td{border:1px solid #cbd5e1;padding:8px;text-align:left;font-size:12px}
          th{background:#f1f5f9}
        </style>
      </head>
      <body>
        <h1>Employees / ملازمین</h1>
        <p>Total Records / کل ریکارڈ: ${filtered.length}</p>
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Name</th><th>Phone</th>
              <th>Designation</th><th>Department</th><th>Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
      </html>
    `);

    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              Employees / ملازمین
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              Manage employees used in salary and staff transactions /
              تنخواہ اور اسٹاف لین دین کیلئے ملازمین کا ریکارڈ
            </p>
          </div>

          <button className="btn-primary" onClick={openAdd}>
            <Plus className="h-4 w-4" />
            Add Employee / ملازم شامل کریں
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
          {success}
        </div>
      )}

      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                className="input w-full pl-9"
                placeholder="Search employee / ملازم تلاش کریں"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <SearchableSelect
              className="input sm:w-44"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "all" | "active" | "inactive")
              }
            >
              <option value="all">All Status / تمام</option>
              <option value="active">Active / فعال</option>
              <option value="inactive">Inactive / غیر فعال</option>
            </SearchableSelect>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={downloadTemplate}>
              <Download className="h-4 w-4" />
              Template
            </button>

            <button className="btn" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Import
            </button>

            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void parseImport(file);
              }}
            />

            <button className="btn" onClick={exportExcel}>
              <FileSpreadsheet className="h-4 w-4" />
              Excel
            </button>

            <button className="btn" onClick={printEmployees}>
              <Printer className="h-4 w-4" />
              Print
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-slate-600">
                <th className="px-3 py-2">Code / کوڈ</th>
                <th className="px-3 py-2">Employee / ملازم</th>
                <th className="px-3 py-2">Phone / فون</th>
                <th className="px-3 py-2">Designation / عہدہ</th>
                <th className="px-3 py-2">Department / شعبہ</th>
                <th className="px-3 py-2">Status / حیثیت</th>
                <th className="px-3 py-2 text-right">Actions / ایکشن</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                    Loading employees...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                    No employees found / کوئی ملازم نہیں ملا
                  </td>
                </tr>
              ) : (
                filtered.map((employee) => (
                  <tr key={employee.id} className="border-b hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">
                      {employee.employee_code || "—"}
                    </td>
                    <td className="px-3 py-2 font-semibold">{employee.name}</td>
                    <td className="px-3 py-2">{employee.phone || "—"}</td>
                    <td className="px-3 py-2">{employee.designation || "—"}</td>
                    <td className="px-3 py-2">{employee.department || "—"}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => void toggleStatus(employee)}
                        className={`rounded-full px-2 py-1 font-semibold ${
                          employee.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {employee.is_active ? "Active / فعال" : "Inactive / غیر فعال"}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          className="btn"
                          title="Edit"
                          onClick={() => openEdit(employee)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-xs text-slate-500">
          Showing {filtered.length} of {employees.length} employee(s) /
          کل {employees.length} میں سے {filtered.length} ریکارڈ
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="font-bold">
                  {editing
                    ? "Edit Employee / ملازم میں ترمیم"
                    : "Add Employee / ملازم شامل کریں"}
                </h2>
                <p className="text-xs text-slate-500">
                  Employee master record / ملازم ماسٹر ریکارڈ
                </p>
              </div>
              <button className="btn" onClick={() => setShowForm(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="text-xs font-semibold">
                Employee Code / ملازم کوڈ
                <input
                  className="input mt-1 w-full cursor-not-allowed bg-slate-50 text-slate-500"
                  value={editing?.employee_code ?? ""}
                  readOnly
                  disabled
                  placeholder={editing ? "" : "Auto-generated on save"}
                  title="Employee code is generated automatically and cannot be edited"
                />
              </label>

              <label className="text-xs font-semibold">
                Employee Name / ملازم کا نام *
                <input
                  className="input mt-1 w-full"
                  value={form.name}
                  onChange={(e) => setForm((x) => ({ ...x, name: e.target.value, name_urdu: toUrduName(e.target.value) }))}
                />
              </label>

              <label className="text-xs font-semibold">
                <span className="flex items-center justify-between">Urdu Name / اردو نام <button type="button" className="text-primary-600" onClick={()=>setForm(x=>({...x,name_urdu:toUrduName(x.name)}))}>Auto Urdu</button></span>
                <input dir="rtl" className="input mt-1 w-full text-right" value={form.name_urdu} onChange={(e)=>setForm(x=>({...x,name_urdu:e.target.value}))}/>
              </label>

              <label className="text-xs font-semibold">
                Phone / فون
                <input
                  className="input mt-1 w-full"
                  value={form.phone}
                  onChange={(e) =>
                    setForm((x) => ({ ...x, phone: e.target.value }))
                  }
                />
              </label>

              <label className="text-xs font-semibold">
                Designation / عہدہ
                <input
                  className="input mt-1 w-full"
                  value={form.designation}
                  onChange={(e) => setForm((x) => ({ ...x, designation: e.target.value, designation_urdu: toUrduName(e.target.value) }))}
                  placeholder="Operator, Manager..."
                />
              </label>

              <label className="text-xs font-semibold">
                <span className="flex items-center justify-between">Designation Urdu / عہدہ <button type="button" className="text-primary-600" onClick={()=>setForm(x=>({...x,designation_urdu:toUrduName(x.designation)}))}>Auto Urdu</button></span>
                <input dir="rtl" className="input mt-1 w-full text-right" value={form.designation_urdu} onChange={(e)=>setForm(x=>({...x,designation_urdu:e.target.value}))}/>
              </label>

              <label className="text-xs font-semibold">
                Department / شعبہ
                <input
                  className="input mt-1 w-full"
                  value={form.department}
                  onChange={(e) => setForm((x) => ({ ...x, department: e.target.value, department_urdu: toUrduName(e.target.value) }))}
                  placeholder="Production, Accounts..."
                />
              </label>

              <label className="text-xs font-semibold">
                <span className="flex items-center justify-between">Department Urdu / شعبہ <button type="button" className="text-primary-600" onClick={()=>setForm(x=>({...x,department_urdu:toUrduName(x.department)}))}>Auto Urdu</button></span>
                <input dir="rtl" className="input mt-1 w-full text-right" value={form.department_urdu} onChange={(e)=>setForm(x=>({...x,department_urdu:e.target.value}))}/>
              </label>

              <label className="flex items-center gap-2 self-end rounded-lg border p-3 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm((x) => ({ ...x, is_active: e.target.checked }))
                  }
                />
                Active Employee / فعال ملازم
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t px-5 py-4">
              <button className="btn" onClick={() => setShowForm(false)}>
                Cancel / منسوخ
              </button>
              <button
                className="btn-primary"
                disabled={saving}
                onClick={() => void saveEmployee()}
              >
                {saving ? "Saving..." : "Save Employee / محفوظ کریں"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-5xl rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="font-bold">
                  Employee Import Preview / ملازمین امپورٹ پری ویو
                </h2>
                <p className="text-xs text-slate-500">
                  Review and validate before import / امپورٹ سے پہلے ریکارڈ چیک کریں
                </p>
              </div>
              <button className="btn" onClick={() => setShowImport(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-auto p-5">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-slate-50 text-left">
                    <th className="p-2">Row</th>
                    <th className="p-2">Code</th>
                    <th className="p-2">Name</th>
                    <th className="p-2">Phone</th>
                    <th className="p-2">Designation</th>
                    <th className="p-2">Department</th>
                    <th className="p-2">Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {importRows.map((row) => (
                    <tr
                      key={row.rowNo}
                      className={`border-b ${row.error ? "bg-red-50" : ""}`}
                    >
                      <td className="p-2">{row.rowNo}</td>
                      <td className="p-2">{row.employee_code || "—"}</td>
                      <td className="p-2">{row.name || "—"}</td>
                      <td className="p-2">{row.phone || "—"}</td>
                      <td className="p-2">{row.designation || "—"}</td>
                      <td className="p-2">{row.department || "—"}</td>
                      <td className="p-2">
                        {row.error ? (
                          <span className="font-semibold text-red-600">
                            {row.error}
                          </span>
                        ) : (
                          <span className="font-semibold text-emerald-600">
                            Valid / درست
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t px-5 py-4">
              <div className="text-xs text-slate-500">
                {importRows.length} rows •{" "}
                {importRows.filter((row) => row.error).length} invalid
              </div>

              <div className="flex gap-2">
                <button className="btn" onClick={() => setShowImport(false)}>
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  disabled={
                    saving ||
                    !importRows.length ||
                    importRows.some((row) => row.error)
                  }
                  onClick={() => void confirmImport()}
                >
                  {saving ? "Importing..." : "Confirm Import / امپورٹ کریں"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
