import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { toUrduName } from "@/lib/urdu";
import * as XLSX from "xlsx";
import { Customer } from "@/types";
import DataTable, { Column } from "@/components/DataTable";
import { PageHeader, Modal, ErrorBanner, ConfirmModal } from "@/components/ui";
import { useAuth } from "@/auth/AuthContext";

type CustomerRow = Customer & {
  name_urdu?: string | null;
  ntn?: string | null;
  strn?: string | null;
  cnic?: string | null;
  tax_registration_status?: "registered" | "unregistered" | null;
};

const EMPTY = {
  name: "",
  name_urdu: "",
  email: "",
  phone: "",
  address: "",
  ntn: "",
  strn: "",
  cnic: "",
  tax_registration_status: "unregistered" as "registered" | "unregistered",
  opening_amount: "",
  balance_side: "debit",
  opening_date: new Date().toISOString().slice(0, 10),
};

export default function Customers() {
  const { isPlatformOwner, activeCompany } = useAuth();
  const role = activeCompany?.membership_role ?? "";
  const canSetOpeningBalance = isPlatformOwner || role === "company_owner" || role === "admin";

  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [urduTouched, setUrduTouched] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.from("customers").select("*").order("created_at", { ascending: false });
    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as CustomerRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchRows(); }, [fetchRows]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY, opening_date: new Date().toISOString().slice(0, 10) });
    setUrduTouched(false);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (row: CustomerRow) => {
    setEditing(row);
    setUrduTouched(Boolean(row.name_urdu));
    setForm({
      name: row.name,
      name_urdu: row.name_urdu ?? toUrduName(row.name),
      email: row.email ?? "",
      phone: row.phone ?? "",
      address: row.address ?? "",
      ntn: row.ntn ?? "",
      strn: row.strn ?? "",
      cnic: row.cnic ?? "",
      tax_registration_status: row.tax_registration_status === "registered" ? "registered" : "unregistered",
      opening_amount: "",
      balance_side: "debit",
      opening_date: new Date().toISOString().slice(0, 10),
    });
    setError(null);
    setModalOpen(true);
  };

  const updateTaxFields = async (id: string) => supabase
    .from("customers")
    .update({
      ntn: form.ntn.trim() || null,
      strn: form.strn.trim() || null,
      cnic: form.cnic.trim() || null,
      tax_registration_status: form.tax_registration_status,
    })
    .eq("id", id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const payload = {
      name: form.name.trim(),
      name_urdu: form.name_urdu.trim() || toUrduName(form.name),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      ntn: form.ntn.trim() || null,
      strn: form.strn.trim() || null,
      cnic: form.cnic.trim() || null,
      tax_registration_status: form.tax_registration_status,
    };

    if (!payload.name) return setError("Customer name is required.");
    if (payload.tax_registration_status === "registered" && !payload.strn && !payload.ntn) {
      return setError("Registered customer ke liye STRN ya NTN required hai.");
    }

    const openingAmount = Number(String(form.opening_amount || "0").replace(/,/g, ""));
    if (!Number.isFinite(openingAmount) || openingAmount < 0) {
      return setError("Opening balance must be zero or a positive number.");
    }
    if (!editing && canSetOpeningBalance && openingAmount > 0 && !form.opening_date) {
      return setError("Opening date is required.");
    }

    if (editing) {
      const { error } = await supabase.from("customers").update(payload).eq("id", editing.id);
      if (error) return setError(error.message);
    } else if (canSetOpeningBalance) {
      const { data, error } = await supabase.rpc("create_party_with_opening_balance_v2", {
        p_party_type: "customer",
        p_name: payload.name,
        p_name_urdu: payload.name_urdu,
        p_email: payload.email,
        p_phone: payload.phone,
        p_address: payload.address,
        p_opening_amount: openingAmount,
        p_balance_side: form.balance_side,
        p_opening_date: form.opening_date,
      });
      if (error) return setError(error.message);
      const createdId = (data as { party_id?: string } | null)?.party_id;
      if (createdId) {
        const { error: taxError } = await supabase.from("customers").update({
          ntn: payload.ntn,
          strn: payload.strn,
          cnic: payload.cnic,
          tax_registration_status: payload.tax_registration_status,
        }).eq("id", createdId);
        if (taxError) return setError(taxError.message);
      }
    } else {
      const { data, error } = await supabase.rpc("create_customer_with_ar", {
        p_name: payload.name,
        p_email: payload.email,
        p_phone: payload.phone,
        p_address: payload.address,
      });
      if (error) return setError(error.message);
      const created = Array.isArray(data) ? data[0] : data;
      if (created?.id) {
        const { error: updateError } = await supabase.from("customers").update({
          name_urdu: payload.name_urdu,
          ntn: payload.ntn,
          strn: payload.strn,
          cnic: payload.cnic,
          tax_registration_status: payload.tax_registration_status,
        }).eq("id", created.id);
        if (updateError) return setError(updateError.message);
      }
    }

    setModalOpen(false);
    setEditing(null);
    setForm({ ...EMPTY, opening_date: new Date().toISOString().slice(0, 10) });
    await fetchRows();
  };

  const handleStatusChange = async () => {
    if (!deleteId) return;
    const customer = rows.find((row) => row.id === deleteId);
    if (!customer) return;
    const { error } = await supabase.from("customers").update({ is_active: customer.is_active === false }).eq("id", deleteId);
    if (error) setError(error.message);
    setDeleteId(null);
    await fetchRows();
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([{
      Name: "Ali Steel Traders",
      "Urdu Name": "علی اسٹیل ٹریڈرز",
      Email: "example@email.com",
      Phone: "03001234567",
      Address: "Business Address",
      "Tax Status": "unregistered",
      NTN: "",
      STRN: "",
      CNIC: "",
    }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customers");
    XLSX.writeFile(wb, "customers_import_template.xlsx");
  };

  const exportExcel = () => {
    if (!rows.length) return setError("No customers to export.");
    const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
      Name: r.name,
      "Urdu Name": r.name_urdu ?? "",
      Email: r.email ?? "",
      Phone: r.phone ?? "",
      Address: r.address ?? "",
      "Tax Status": r.tax_registration_status ?? "unregistered",
      NTN: r.ntn ?? "",
      STRN: r.strn ?? "",
      CNIC: r.cnic ?? "",
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customers");
    XLSX.writeFile(wb, "customers_export.xlsx");
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("Uploaded file does not contain a worksheet.");
      const imported = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const existing = new Set(rows.map((r) => r.name.trim().toLowerCase()));
      const fileNames = new Set<string>();

      for (let i = 0; i < imported.length; i += 1) {
        const n = Object.fromEntries(Object.entries(imported[i]).map(([k, v]) => [k.trim().toLowerCase(), String(v ?? "").trim()]));
        const name = n["name"] || n["customer name"] || n["party name"] || "";
        if (!name) throw new Error(`Row ${i + 2}: Name is required.`);
        const key = name.toLowerCase();
        if (existing.has(key) || fileNames.has(key)) throw new Error(`Row ${i + 2}: Duplicate customer "${name}".`);
        fileNames.add(key);
        const status = (n["tax status"] || n["tax registration status"] || "unregistered").toLowerCase() === "registered" ? "registered" : "unregistered";
        const { data, error } = await supabase.rpc("create_customer_with_ar", {
          p_name: name,
          p_email: n["email"] || null,
          p_phone: n["phone"] || n["mobile"] || null,
          p_address: n["address"] || null,
        });
        if (error) throw error;
        const created = Array.isArray(data) ? data[0] : data;
        const urdu = n["urdu name"] || n["name urdu"] || toUrduName(name);
        if (created?.id) {
          const { error: ue } = await supabase.from("customers").update({
            name_urdu: urdu,
            ntn: n["ntn"] || null,
            strn: n["strn"] || null,
            cnic: n["cnic"] || null,
            tax_registration_status: status,
          }).eq("id", created.id);
          if (ue) throw ue;
        }
      }
      await fetchRows();
      alert(`${imported.length} customers imported successfully / کامیابی سے امپورٹ ہوگئے۔`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const columns: Column<CustomerRow>[] = [
    { key: "name", label: "Name / نام", render: (r) => <div data-business-data><div data-language-code="en" className="font-medium text-slate-900">{r.name}</div><div data-language-code="ur" dir="rtl" className="text-sm text-slate-500">{r.name_urdu ?? "—"}</div></div> },
    { key: "tax", label: "Tax Registration", render: (r) => <div><div className="font-medium capitalize">{r.tax_registration_status ?? "unregistered"}</div><div className="text-xs text-slate-500">{r.strn ? `STRN ${r.strn}` : r.ntn ? `NTN ${r.ntn}` : "—"}</div></div> },
    { key: "email", label: "Email / ای میل", render: (r) => r.email ?? "—" },
    { key: "phone", label: "Phone / فون", render: (r) => r.phone ?? "—" },
    { key: "address", label: "Address / پتہ", render: (r) => r.address ?? "—" },
    { key: "status", label: "Status / حیثیت", render: (r) => <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${r.is_active === false ? "bg-slate-100 text-slate-600" : "bg-emerald-100 text-emerald-700"}`}>{r.is_active === false ? "Inactive" : "Active"}</span> },
    { key: "actions", label: "", className: "text-right", render: (r) => <div className="flex justify-end gap-2"><button onClick={() => openEdit(r)} className="text-primary-600 text-sm font-medium">Edit / ترمیم</button><button onClick={() => setDeleteId(r.id)} className={`${r.is_active === false ? "text-emerald-600" : "text-amber-600"} text-sm font-medium`}>{r.is_active === false ? "Activate" : "Deactivate"}</button></div> },
  ];

  return <div>
    <PageHeader title="Customers / گاہک" subtitle="Customer accounts / گاہک اکاؤنٹس" action={<div className="flex flex-wrap items-center gap-2"><button onClick={downloadTemplate} className="btn-secondary">Template / ٹیمپلیٹ</button><label className={`btn-secondary cursor-pointer ${importing ? "opacity-50" : ""}`}>{importing ? "Importing..." : "Import Excel / ایکسل امپورٹ"}<input type="file" accept=".xlsx,.xls,.csv" disabled={importing} onChange={handleImport} className="hidden" /></label><button onClick={exportExcel} className="btn-secondary">Export Excel / ایکسل ایکسپورٹ</button><button onClick={() => window.print()} className="btn-secondary">Print / پرنٹ</button><button onClick={openCreate} className="btn-primary">+ New Customer</button></div>} />
    {error && <ErrorBanner message={error} />}
    <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No customers yet." />

    <Modal open={modalOpen} title={editing ? "Edit Customer" : "New Customer"} onClose={() => setModalOpen(false)}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div><label className="label">English Name</label><input className="input" required value={form.name} onChange={(e) => { const name = e.target.value; setForm((f) => ({ ...f, name, name_urdu: urduTouched ? f.name_urdu : toUrduName(name) })); }} /></div>
        <div><div className="flex items-center justify-between"><label className="label">Urdu Name / اردو نام</label><button type="button" className="text-xs text-primary-600" onClick={() => { setUrduTouched(false); setForm((f) => ({ ...f, name_urdu: toUrduName(f.name) })); }}>Auto Urdu</button></div><input dir="rtl" className="input text-right" value={form.name_urdu} onChange={(e) => { setUrduTouched(true); setForm({ ...form, name_urdu: e.target.value }); }} placeholder="خودکار اردو نام" /></div>
        <div><label className="label">Email / ای میل</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><label className="label">Phone / فون</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        <div><label className="label">Address / پتہ</label><textarea className="input" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-3 text-sm font-semibold text-slate-800">Tax Identity / ٹیکس شناخت</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Tax Status</label><SearchableSelect className="input" value={form.tax_registration_status} onChange={(e) => setForm({ ...form, tax_registration_status: e.target.value as "registered" | "unregistered" })}><option value="unregistered">Unregistered</option><option value="registered">Registered</option></SearchableSelect></div>
            <div><label className="label">STRN</label><input className="input" value={form.strn} onChange={(e) => setForm({ ...form, strn: e.target.value })} /></div>
            <div><label className="label">NTN</label><input className="input" value={form.ntn} onChange={(e) => setForm({ ...form, ntn: e.target.value })} /></div>
            <div><label className="label">CNIC (if applicable)</label><input className="input" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} /></div>
          </div>
          <div className="mt-2 text-xs text-slate-500">Registered customer ke Tax Invoice ke liye STRN/NTN posting validation mein use hoga.</div>
        </div>

        {!editing && canSetOpeningBalance && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
          <div className="mb-3"><div className="text-sm font-semibold text-blue-900">Opening Balance / اوپننگ بیلنس</div><div className="text-xs text-blue-700">Optional. Company Owner/Admin can enter the migrated opening balance here; 0 means no opening balance.</div></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className="label">Amount</label><input className="input" type="number" min="0" step="0.01" value={form.opening_amount} onChange={(e) => setForm({ ...form, opening_amount: e.target.value })} placeholder="0.00" /></div>
            <div><label className="label">Balance Side</label><SearchableSelect className="input" value={form.balance_side} onChange={(e) => setForm({ ...form, balance_side: e.target.value })}><option value="debit">Debit / Dr</option><option value="credit">Credit / Cr</option></SearchableSelect></div>
            <div><label className="label">Opening Date</label><input className="input" type="date" value={form.opening_date} onChange={(e) => setForm({ ...form, opening_date: e.target.value })} /></div>
          </div>
          <div className="mt-2 text-xs text-blue-700">Customer Debit = amount receivable from customer. Customer Credit = customer advance / credit balance.</div>
        </div>}

        <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel / منسوخ کریں</button><button type="submit" className="btn-primary">{editing ? "Save Changes" : "Create Customer"}</button></div>
      </form>
    </Modal>

    <ConfirmModal open={!!deleteId} title={`${rows.find((r) => r.id === deleteId)?.is_active === false ? "Activate" : "Deactivate"} Customer`} message="Historical transactions will remain safe. Inactive customers cannot be selected for new transactions." onConfirm={handleStatusChange} onCancel={() => setDeleteId(null)} />
  </div>;
}
