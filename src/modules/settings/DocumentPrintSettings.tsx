import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FileText, LayoutTemplate, Loader2, Save, X } from "lucide-react";
import { ErrorBanner, PageHeader } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { PRINT_TEMPLATES, normalizePrintTemplate, type PrintTemplateKey } from "@/lib/documentPrintSettings";

type DocumentType =
  | "sales_invoice"
  | "purchase"
  | "work_order"
  | "receipt_payment"
  | "gate_pass"
  | "reports";

type VisibilityKey =
  | "show_company_name"
  | "show_logo"
  | "show_address"
  | "show_phone_email"
  | "show_tax_details"
  | "show_header"
  | "show_footer"
  | "show_signatures"
  | "show_print_datetime"
  | "show_page_numbers"
  | "show_previous_balance"
  | "show_closing_balance";

type VisibilityRow = {
  id?: string;
  company_id?: string;
  document_type: DocumentType;
  template_key: PrintTemplateKey;
  show_company_name: boolean;
  show_logo: boolean;
  show_address: boolean;
  show_phone_email: boolean;
  show_tax_details: boolean;
  show_header: boolean;
  show_footer: boolean;
  show_signatures: boolean;
  show_print_datetime: boolean;
  show_page_numbers: boolean;
  show_previous_balance: boolean;
  show_closing_balance: boolean;
};

const DOCUMENTS: Array<{ type: DocumentType; label: string }> = [
  { type: "sales_invoice", label: "Sales Invoice" },
  { type: "purchase", label: "Purchase" },
  { type: "work_order", label: "Work Order" },
  { type: "receipt_payment", label: "Receipt / Payment" },
  { type: "gate_pass", label: "Gate Pass" },
  { type: "reports", label: "Reports" },
];

const ELEMENTS: Array<{ key: VisibilityKey; label: string }> = [
  { key: "show_company_name", label: "Company Name" },
  { key: "show_logo", label: "Company Logo" },
  { key: "show_address", label: "Address" },
  { key: "show_phone_email", label: "Phone / Email" },
  { key: "show_tax_details", label: "NTN / STRN" },
  { key: "show_header", label: "Header" },
  { key: "show_footer", label: "Footer" },
  { key: "show_signatures", label: "Signatures" },
  { key: "show_print_datetime", label: "Print Date / Time" },
  { key: "show_page_numbers", label: "Page Numbers" },
  { key: "show_previous_balance", label: "Previous Balance" },
  { key: "show_closing_balance", label: "Closing Balance" },
];

function defaultVisibility(documentType: DocumentType): VisibilityRow {
  return {
    document_type: documentType,
    template_key: "standard",
    show_company_name: true,
    show_logo: true,
    show_address: true,
    show_phone_email: true,
    show_tax_details: documentType !== "work_order" && documentType !== "gate_pass",
    show_header: true,
    show_footer: true,
    show_signatures: documentType !== "reports",
    show_print_datetime: false,
    show_page_numbers: true,
    show_previous_balance: documentType === "receipt_payment",
    show_closing_balance: documentType === "receipt_payment",
  };
}

async function getCurrentCompanyId(): Promise<string> {
  const { data, error } = await supabase.rpc("current_company_id");
  if (error) throw error;
  if (!data) throw new Error("No active company selected.");
  return String(data);
}

export default function DocumentPrintSettings() {
  const [header, setHeader] = useState("");
  const [headerUrdu, setHeaderUrdu] = useState("");
  const [footer, setFooter] = useState("");
  const [footerUrdu, setFooterUrdu] = useState("");
  const [preparedBy, setPreparedBy] = useState("Prepared By");
  const [checkedBy, setCheckedBy] = useState("Checked By");
  const [approvedBy, setApprovedBy] = useState("Approved By");
  const [pageSize, setPageSize] = useState("A4");
  const [orientation, setOrientation] = useState("portrait");
  const [matrix, setMatrix] = useState<VisibilityRow[]>(DOCUMENTS.map(({ type }) => defaultVisibility(type)));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matrixByType = useMemo(
    () => Object.fromEntries(matrix.map((row) => [row.document_type, row])) as Record<DocumentType, VisibilityRow>,
    [matrix]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const companyId = await getCurrentCompanyId();
      const [companyResult, visibilityResult] = await Promise.all([
        supabase.from("company_settings").select("*").eq("company_id", companyId).maybeSingle(),
        supabase.from("document_print_visibility").select("*").eq("company_id", companyId).order("document_type"),
      ]);

      if (companyResult.error) throw companyResult.error;
      if (visibilityResult.error) throw visibilityResult.error;

      const company = companyResult.data;
      if (company) {
        setHeader(company.document_header || "");
        setHeaderUrdu(company.document_header_urdu || "");
        setFooter(company.document_footer || "");
        setFooterUrdu(company.document_footer_urdu || "");
        setPreparedBy(company.prepared_by_label || "Prepared By");
        setCheckedBy(company.checked_by_label || "Checked By");
        setApprovedBy(company.approved_by_label || "Approved By");
        setPageSize(company.page_size || "A4");
        setOrientation(company.page_orientation || "portrait");
      }

      let existing = (visibilityResult.data || []).map((row: any) => ({
        ...row,
        template_key: normalizePrintTemplate(row.template_key),
      })) as VisibilityRow[];
      const missingRows = DOCUMENTS
        .filter(({ type }) => !existing.some((row) => row.document_type === type))
        .map(({ type }) => ({ ...defaultVisibility(type), company_id: companyId, updated_at: new Date().toISOString() }));

      if (missingRows.length) {
        const { data: createdRows, error: createError } = await supabase
          .from("document_print_visibility")
          .upsert(missingRows, { onConflict: "company_id,document_type" })
          .select("*");
        if (createError) throw createError;
        existing = [
          ...existing,
          ...((createdRows || []).map((row: any) => ({ ...row, template_key: normalizePrintTemplate(row.template_key) })) as VisibilityRow[]),
        ];
      }

      setMatrix(DOCUMENTS.map(({ type }) => existing.find((row) => row.document_type === type) || defaultVisibility(type)));
    } catch (err: any) {
      setError(err?.message || "Failed to load document settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleMatrix = (documentType: DocumentType, key: VisibilityKey) => {
    setMatrix((current) => current.map((row) => row.document_type === documentType ? { ...row, [key]: !row[key] } : row));
  };

  const setTemplateForDocument = (documentType: DocumentType, template: PrintTemplateKey) => {
    setMatrix((current) => current.map((row) => row.document_type === documentType ? { ...row, template_key: template } : row));
  };

  const setAllForElement = (key: VisibilityKey, value: boolean) => {
    setMatrix((current) => current.map((row) => ({ ...row, [key]: value })));
  };

  const setAllForDocument = (documentType: DocumentType, value: boolean) => {
    setMatrix((current) => current.map((row) => {
      if (row.document_type !== documentType) return row;
      return ELEMENTS.reduce((next, element) => ({ ...next, [element.key]: value }), { ...row });
    }));
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const companyId = await getCurrentCompanyId();
      const companyPayload = {
        company_id: companyId,
        document_header: header.trim() || null,
        document_header_urdu: headerUrdu.trim() || null,
        document_footer: footer.trim() || null,
        document_footer_urdu: footerUrdu.trim() || null,
        prepared_by_label: preparedBy.trim() || "Prepared By",
        checked_by_label: checkedBy.trim() || "Checked By",
        approved_by_label: approvedBy.trim() || "Approved By",
        page_size: pageSize,
        page_orientation: orientation,
        updated_at: new Date().toISOString(),
      };

      const visibilityPayload = matrix.map((row) => ({
        company_id: companyId,
        document_type: row.document_type,
        template_key: row.template_key,
        show_company_name: row.show_company_name,
        show_logo: row.show_logo,
        show_address: row.show_address,
        show_phone_email: row.show_phone_email,
        show_tax_details: row.show_tax_details,
        show_header: row.show_header,
        show_footer: row.show_footer,
        show_signatures: row.show_signatures,
        show_print_datetime: row.show_print_datetime,
        show_page_numbers: row.show_page_numbers,
        show_previous_balance: row.show_previous_balance,
        show_closing_balance: row.show_closing_balance,
        updated_at: new Date().toISOString(),
      }));

      const [companySave, visibilitySave] = await Promise.all([
        supabase.from("company_settings").upsert(companyPayload, { onConflict: "company_id" }),
        supabase.from("document_print_visibility").upsert(visibilityPayload, { onConflict: "company_id,document_type" }).select("document_type"),
      ]);
      if (companySave.error) throw companySave.error;
      if (visibilitySave.error) throw visibilitySave.error;

      const savedTypes = new Set((visibilitySave.data || []).map((row: { document_type: string }) => row.document_type));
      const missing = DOCUMENTS.filter(({ type }) => !savedTypes.has(type));
      if (missing.length) throw new Error(`Document visibility settings were not fully saved: ${missing.map(({ type }) => type).join(", ")}`);

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to save document settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-[300px] items-center justify-center"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading document settings...</div>;
  }

  return (
    <div>
      <PageHeader title="Document & Print Settings" subtitle="Control content and design without changing transaction or accounting data" />
      {error && <div className="mt-4"><ErrorBanner message={error} /></div>}
      {saved && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">Document & print settings saved successfully</div>}

      <div className="mt-4 max-w-[1500px] space-y-5">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2"><FileText className="h-5 w-5 text-blue-600" /><div><h2 className="font-bold">Header & Footer</h2><p className="mt-1 text-xs text-slate-500">Common text used by enabled document types.</p></div></div>
          <div className="grid gap-4 md:grid-cols-2">
            <Area label="Header" value={header} setValue={setHeader} />
            <Area label="Urdu Header" value={headerUrdu} setValue={setHeaderUrdu} />
            <Area label="Footer" value={footer} setValue={setFooter} />
            <Area label="Urdu Footer" value={footerUrdu} setValue={setFooterUrdu} />
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2"><LayoutTemplate className="h-5 w-5 text-violet-600" /><div><h2 className="font-bold">Print Design by Document</h2><p className="mt-1 text-xs text-slate-500">Changing a template only changes appearance. Invoice amounts, tax, stock and accounting postings are never changed.</p></div></div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {DOCUMENTS.map((doc) => {
              const row = matrixByType[doc.type] || defaultVisibility(doc.type);
              const selected = PRINT_TEMPLATES.find((item) => item.key === row.template_key) || PRINT_TEMPLATES[0];
              return <div key={doc.type} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-bold text-slate-900">{doc.label}</div>
                <SearchableSelect className="input mt-3 w-full" value={row.template_key} onChange={(e) => setTemplateForDocument(doc.type, e.target.value as PrintTemplateKey)}>
                  {PRINT_TEMPLATES.map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}
                </SearchableSelect>
                <p className="mt-2 text-xs leading-5 text-slate-500">{selected.description}</p>
              </div>;
            })}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-bold">Signature Labels</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Input label="Prepared By" value={preparedBy} setValue={setPreparedBy} />
            <Input label="Checked By" value={checkedBy} setValue={setCheckedBy} />
            <Input label="Approved By" value={approvedBy} setValue={setApprovedBy} />
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-bold">Page Setup</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium">Page Size<SearchableSelect className="input mt-1 w-full" value={pageSize} onChange={(e) => setPageSize(e.target.value)}><option value="A4">A4</option><option value="Letter">Letter</option></SearchableSelect></label>
            <label className="text-sm font-medium">Orientation<SearchableSelect className="input mt-1 w-full" value={orientation} onChange={(e) => setOrientation(e.target.value)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></SearchableSelect></label>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5"><h2 className="font-bold">Document Visibility Matrix</h2></div>
          <div className="overflow-x-auto">
            <table className="min-w-[1250px] w-full text-xs">
              <thead className="bg-slate-950 text-white"><tr><th className="px-4 py-3 text-left">Element</th>{DOCUMENTS.map((doc) => <th key={doc.type} className="px-3 py-3 text-center"><div>{doc.label}</div><div className="mt-2 flex justify-center gap-1"><button type="button" onClick={() => setAllForDocument(doc.type, true)} className="rounded bg-white/10 px-2 py-1">All Show</button><button type="button" onClick={() => setAllForDocument(doc.type, false)} className="rounded bg-white/10 px-2 py-1">All Hide</button></div></th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {ELEMENTS.map((element) => <tr key={element.key} className="hover:bg-slate-50"><td className="px-4 py-3 font-semibold"><div className="flex items-center justify-between gap-2"><span>{element.label}</span><span className="flex gap-1"><button type="button" onClick={() => setAllForElement(element.key, true)} className="rounded border px-1.5 py-0.5">All ✓</button><button type="button" onClick={() => setAllForElement(element.key, false)} className="rounded border px-1.5 py-0.5">All ×</button></span></div></td>{DOCUMENTS.map((doc) => { const enabled = matrixByType[doc.type]?.[element.key] ?? false; return <td key={`${doc.type}-${element.key}`} className="px-3 py-2 text-center"><button type="button" onClick={() => toggleMatrix(doc.type, element.key)} className={`inline-flex min-w-[78px] items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 font-semibold ${enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-400"}`}>{enabled ? <><Check className="h-3.5 w-3.5" />Show</> : <><X className="h-3.5 w-3.5" />Hide</>}</button></td>; })}</tr>)}
              </tbody>
            </table>
          </div>
        </section>

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <div className="font-bold">Safe design architecture</div>
          <p className="mt-1 text-xs leading-5">Templates, show/hide options, language, header/footer and page setup are presentation settings only. Posted accounting, VAT, stock movements and document values remain controlled by the transaction data.</p>
        </div>

        <div className="flex justify-end"><button type="button" onClick={() => void save()} disabled={saving} className="btn btn-primary">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save Document Settings</button></div>
      </div>
    </div>
  );
}

function Input({ label, value, setValue }: { label: string; value: string; setValue: (value: string) => void }) {
  return <label className="text-sm font-medium">{label}<input className="input mt-1 w-full" value={value} onChange={(e) => setValue(e.target.value)} /></label>;
}

function Area({ label, value, setValue }: { label: string; value: string; setValue: (value: string) => void }) {
  return <label className="text-sm font-medium">{label}<textarea rows={3} className="input mt-1 w-full" value={value} onChange={(e) => setValue(e.target.value)} /></label>;
}
