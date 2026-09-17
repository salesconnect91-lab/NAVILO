import SearchableSelect from "@/components/SearchableSelect";
import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Printer, FileDown, LockKeyhole } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/lib/supabase";
import { WorkOrder, WorkOrderLine, Item, WorkOrderStatus } from "@/types";
import {
  PageHeader,
  ErrorBanner,
  StatusBadge,
  formatDate,
  ConfirmModal,
} from "@/components/ui";
import { useAuth } from "@/auth/AuthContext";
import { canPerformModule } from "@/auth/permissions";

type CompanyPrintSettings = {
  company_name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  ntn?: string | null;
  strn?: string | null;
  logo_url?: string | null;
  document_header?: string | null;
  document_header_urdu?: string | null;
  document_footer?: string | null;
  document_footer_urdu?: string | null;
  prepared_by_label?: string | null;
  checked_by_label?: string | null;
  approved_by_label?: string | null;
  page_size?: string | null;
  page_orientation?: string | null;
};

type WorkOrderVisibility = {
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
};

const DEFAULT_VISIBILITY: WorkOrderVisibility = {
  show_company_name: true,
  show_logo: true,
  show_address: true,
  show_phone_email: true,
  show_tax_details: false,
  show_header: true,
  show_footer: true,
  show_signatures: true,
  show_print_datetime: false,
  show_page_numbers: true,
};

function safe(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function prettyStatus(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeCompany, isPlatformOwner } = useAuth();
  const role = activeCompany?.membership_role;
  const permissions = activeCompany?.permissions;
  const canEditProduction = canPerformModule(role, "production", "edit", permissions, isPlatformOwner);
  const canDeleteProduction = canPerformModule(role, "production", "delete", permissions, isPlatformOwner);
  const canPostProduction = canPerformModule(role, "production", "post", permissions, isPlatformOwner);
  const canPrintProduction = canPerformModule(role, "production", "print", permissions, isPlatformOwner);

  const [order, setOrder] = useState<WorkOrder | null>(null);
  const [lines, setLines] = useState<WorkOrderLine[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteLineId, setDeleteLineId] = useState<string | null>(null);
  const [newLine, setNewLine] = useState({ item_id: "", qty: "1" });

  const fetchOrder = useCallback(async () => {
    if (!id) return;

    const { data, error } = await supabase
      .from("work_orders")
      .select("*, item:items(*)")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      setError(error.message);
      return;
    }

    setOrder(data);
  }, [id]);

  const fetchLines = useCallback(async () => {
    if (!id) return;

    const { data, error } = await supabase
      .from("work_order_lines")
      .select("*, item:items(*)")
      .eq("order_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
      return;
    }

    setLines(data ?? []);
  }, [id]);

  const fetchItems = useCallback(async () => {
    const { data } = await supabase
      .from("items")
      .select("*")
      .in("type", ["raw", "component"])
      .order("name");

    setItems(data ?? []);
  }, []);

  useEffect(() => {
    void (async () => {
      await Promise.all([fetchOrder(), fetchLines(), fetchItems()]);
      setLoading(false);
    })();
  }, [fetchOrder, fetchLines, fetchItems]);

  const isLocked =
    order?.status === "completed" || order?.status === "closed";

  const handleAddLine = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!id || !newLine.item_id || !order) return;

    if (isLocked) {
      setError(
        "Completed or closed work orders cannot be modified. / مکمل یا بند ورک آرڈر میں تبدیلی نہیں کی جا سکتی۔"
      );
      return;
    }

    const qty = parseFloat(newLine.qty) || 0;

    if (qty <= 0) {
      setError("Quantity must be greater than zero. / مقدار صفر سے زیادہ ہونی چاہیے۔");
      return;
    }

    const { data, error } = await supabase
      .from("work_order_lines")
      .insert({
        order_id: id,
        item_id: newLine.item_id,
        qty,
      })
      .select("*, item:items(*)")
      .single();

    if (error) {
      setError(error.message);
      return;
    }

    setLines([...lines, data]);
    setNewLine({ item_id: "", qty: "1" });
    setError(null);
  };

  const handleDeleteLine = async () => {
    if (!deleteLineId || !order) return;

    if (isLocked) {
      setDeleteLineId(null);
      setError(
        "Completed or closed work orders cannot be modified. / مکمل یا بند ورک آرڈر میں تبدیلی نہیں کی جا سکتی۔"
      );
      return;
    }

    const { error } = await supabase
      .from("work_order_lines")
      .delete()
      .eq("id", deleteLineId);

    if (error) {
      setError(error.message);
      return;
    }

    setLines(lines.filter((line) => line.id !== deleteLineId));
    setDeleteLineId(null);
  };

  const handleStatusChange = async (status: WorkOrderStatus) => {
    if (!order) return;

    setError(null);

    if (status === "completed") {
      const { error } = await supabase.rpc("complete_work_order", {
        p_order_id: order.id,
      });

      if (error) {
        setError(error.message);
        return;
      }

      await Promise.all([fetchOrder(), fetchLines()]);
      return;
    }

    const { error } = await supabase
      .from("work_orders")
      .update({ status })
      .eq("id", order.id);

    if (error) {
      setError(error.message);
      return;
    }

    setOrder({ ...order, status });
  };

  const handleDeleteOrder = async () => {
    if (!order || order.status !== "planned") return;

    const { error } = await supabase
      .from("work_orders")
      .delete()
      .eq("id", order.id);

    if (error) {
      setError(error.message);
      return;
    }

    navigate("/production");
  };


  const handlePdf = async () => {
    if (!order) return;

    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("Authentication required.");

      const [companyResult, visibilityResult] = await Promise.all([
        supabase
          .from("company_settings")
          .select("*")
          .maybeSingle(),

        supabase
          .from("document_print_visibility")
          .select("*")
          .eq("document_type", "work_order")
          .maybeSingle(),
      ]);

      if (companyResult.error) throw companyResult.error;
      if (visibilityResult.error) throw visibilityResult.error;

      const company =
        (companyResult.data || {}) as CompanyPrintSettings;

      const visibility: WorkOrderVisibility = {
        ...DEFAULT_VISIBILITY,
        ...(visibilityResult.data || {}),
      };

      const orientation =
        company.page_orientation === "landscape"
          ? "landscape"
          : "portrait";

      const format =
        company.page_size === "Letter"
          ? "letter"
          : "a4";

      const pdf = new jsPDF({
        orientation,
        unit: "mm",
        format,
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 14;

      let y = 15;

      if (
        visibility.show_logo &&
        company.logo_url
      ) {
        try {
          const response = await fetch(company.logo_url);
          const blob = await response.blob();

          const dataUrl = await new Promise<string>(
            (resolve, reject) => {
              const reader = new FileReader();

              reader.onload = () =>
                resolve(String(reader.result));

              reader.onerror = () =>
                reject(reader.error);

              reader.readAsDataURL(blob);
            }
          );

          let imageType: "PNG" | "JPEG" = "PNG";

          if (
            blob.type.includes("jpeg") ||
            blob.type.includes("jpg")
          ) {
            imageType = "JPEG";
          }

          pdf.addImage(
            dataUrl,
            imageType,
            margin,
            y,
            28,
            18
          );
        } catch {
          // Logo failure should not block PDF generation.
        }
      }

      const companyTextX =
        visibility.show_logo && company.logo_url
          ? margin + 34
          : margin;

      if (visibility.show_company_name) {
        pdf.setFontSize(18);
        pdf.setFont("helvetica", "bold");

        pdf.text(
          company.company_name || "Steel Mill ERP",
          companyTextX,
          y + 5
        );
      }

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);

      let companyLineY = y + 10;

      if (
        visibility.show_address &&
        company.address
      ) {
        pdf.text(
          String(company.address),
          companyTextX,
          companyLineY
        );

        companyLineY += 4;
      }

      if (visibility.show_phone_email) {
        const contact = [
          company.phone
            ? `Phone: ${company.phone}`
            : "",
          company.email
            ? `Email: ${company.email}`
            : "",
        ]
          .filter(Boolean)
          .join(" | ");

        if (contact) {
          pdf.text(
            contact,
            companyTextX,
            companyLineY
          );

          companyLineY += 4;
        }
      }

      if (visibility.show_tax_details) {
        const tax = [
          company.ntn
            ? `NTN: ${company.ntn}`
            : "",
          company.strn
            ? `STRN: ${company.strn}`
            : "",
        ]
          .filter(Boolean)
          .join(" | ");

        if (tax) {
          pdf.text(
            tax,
            companyTextX,
            companyLineY
          );
        }
      }

      y = Math.max(y + 24, companyLineY + 5);

      pdf.setDrawColor(60);
      pdf.line(
        margin,
        y,
        pageWidth - margin,
        y
      );

      y += 8;

      if (
        visibility.show_header &&
        company.document_header
      ) {
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");

        const headerLines =
          pdf.splitTextToSize(
            company.document_header,
            pageWidth - margin * 2
          );

        pdf.text(
          headerLines,
          pageWidth / 2,
          y,
          { align: "center" }
        );

        y += headerLines.length * 4 + 3;
      }

      const documentTitle =
        order.status === "completed" ||
        order.status === "closed"
          ? "PRODUCTION COMPLETION REPORT"
          : "WORK ORDER / JOB CARD";

      pdf.setFontSize(15);
      pdf.setFont("helvetica", "bold");

      pdf.text(
        documentTitle,
        pageWidth / 2,
        y,
        { align: "center" }
      );

      y += 6;

      pdf.setFontSize(10);

      pdf.text(
        order.order_no,
        pageWidth / 2,
        y,
        { align: "center" }
      );

      y += 8;

      autoTable(pdf, {
        startY: y,
        theme: "grid",

        styles: {
          fontSize: 9,
          cellPadding: 3,
        },

        head: [
          [
            "Product",
            "Quantity",
            "Start Date",
            "End Date",
            "Status",
          ],
        ],

        body: [
          [
            order.item?.name || "—",
            String(order.qty),
            order.start_date
              ? formatDate(order.start_date)
              : "—",
            order.end_date
              ? formatDate(order.end_date)
              : "—",
            prettyStatus(order.status),
          ],
        ],
      });

      let nextY =
        (pdf as any).lastAutoTable?.finalY
          ? (pdf as any).lastAutoTable.finalY + 9
          : y + 25;

      pdf.setFontSize(11);
      pdf.setFont("helvetica", "bold");

      pdf.text(
        "Bill of Materials (Components)",
        margin,
        nextY
      );

      nextY += 4;

      autoTable(pdf, {
        startY: nextY,
        theme: "grid",

        styles: {
          fontSize: 9,
          cellPadding: 3,
        },

        head: [
          [
            "#",
            "Component",
            "SKU",
            "Qty",
          ],
        ],

        body:
          lines.length > 0
            ? lines.map((line, index) => [
                String(index + 1),
                line.item?.name || "—",
                line.item?.sku || "—",
                String(line.qty),
              ])
            : [
                [
                  "",
                  "No components",
                  "",
                  "",
                ],
              ],
      });

      nextY =
        (pdf as any).lastAutoTable?.finalY
          ? (pdf as any).lastAutoTable.finalY + 10
          : nextY + 20;

      if (
        order.status === "completed" ||
        order.status === "closed"
      ) {
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "normal");

        pdf.text(
          "Production completed - this Work Order is read-only.",
          margin,
          nextY
        );

        nextY += 12;
      }

      if (visibility.show_signatures) {
        const signatureY = Math.max(
          nextY + 15,
          pdf.internal.pageSize.getHeight() - 35
        );

        const usableWidth =
          pageWidth - margin * 2;

        const columnWidth =
          usableWidth / 3;

        const labels = [
          company.prepared_by_label ||
            "Prepared By",
          company.checked_by_label ||
            "Checked By",
          company.approved_by_label ||
            "Approved By",
        ];

        labels.forEach((label, index) => {
          const x =
            margin +
            columnWidth * index;

          pdf.line(
            x + 4,
            signatureY,
            x + columnWidth - 4,
            signatureY
          );

          pdf.setFontSize(8);

          pdf.text(
            label,
            x + columnWidth / 2,
            signatureY + 5,
            { align: "center" }
          );
        });
      }

      if (
        visibility.show_footer &&
        company.document_footer
      ) {
        const footerY =
          pdf.internal.pageSize.getHeight() - 12;

        pdf.setFontSize(8);
        pdf.setFont("helvetica", "normal");

        pdf.text(
          company.document_footer,
          pageWidth / 2,
          footerY,
          {
            align: "center",
            maxWidth:
              pageWidth - margin * 2,
          }
        );
      }

      if (visibility.show_print_datetime) {
        pdf.setFontSize(7);

        pdf.text(
          `Generated: ${new Date().toLocaleString(
            "en-PK"
          )}`,
          margin,
          pdf.internal.pageSize.getHeight() - 5
        );
      }

      if (visibility.show_page_numbers) {
        const pages =
          pdf.getNumberOfPages();

        for (
          let page = 1;
          page <= pages;
          page += 1
        ) {
          pdf.setPage(page);
          pdf.setFontSize(7);

          pdf.text(
            `Page ${page} of ${pages}`,
            pageWidth - margin,
            pdf.internal.pageSize.getHeight() - 5,
            { align: "right" }
          );
        }
      }

      pdf.save(
        `${order.order_no}-Work-Order.pdf`
      );
    } catch (err: any) {
      setError(
        err?.message ||
          "Unable to generate Work Order PDF."
      );
    }
  };

  const handlePrint = async () => {
    if (!order) return;

    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("Authentication required.");

      const [companyResult, visibilityResult] = await Promise.all([
        supabase
          .from("company_settings")
          .select("*")
          .maybeSingle(),

        supabase
          .from("document_print_visibility")
          .select("*")
          .eq("document_type", "work_order")
          .maybeSingle(),
      ]);

      if (companyResult.error) throw companyResult.error;
      if (visibilityResult.error) throw visibilityResult.error;

      const company =
        (companyResult.data || {}) as CompanyPrintSettings;

      const visibility: WorkOrderVisibility = {
        ...DEFAULT_VISIBILITY,
        ...(visibilityResult.data || {}),
      };

      const pageSize =
        company.page_size === "Letter" ? "Letter" : "A4";

      const orientation =
        company.page_orientation === "landscape"
          ? "landscape"
          : "portrait";

      const title =
        order.status === "completed" || order.status === "closed"
          ? "Production Completion Report"
          : "Work Order / Job Card";

      const contactParts = [
        visibility.show_phone_email && company.phone
          ? `Phone: ${safe(company.phone)}`
          : "",
        visibility.show_phone_email && company.email
          ? `Email: ${safe(company.email)}`
          : "",
      ].filter(Boolean);

      const taxParts = [
        company.ntn ? `NTN: ${safe(company.ntn)}` : "",
        company.strn ? `STRN: ${safe(company.strn)}` : "",
      ].filter(Boolean);

      const rows =
        lines.length > 0
          ? lines
              .map(
                (line, index) => `
                  <tr>
                    <td class="center">${index + 1}</td>
                    <td>
                      <strong>${safe(line.item?.name || "—")}</strong>
                      ${
                        line.item?.sku
                          ? `<div class="muted">${safe(line.item.sku)}</div>`
                          : ""
                      }
                    </td>
                    <td class="right">${safe(line.qty)}</td>
                  </tr>
                `
              )
              .join("")
          : `
              <tr>
                <td colspan="3" class="center muted">
                  No components / کوئی اجزاء نہیں
                </td>
              </tr>
            `;

      const popup = window.open(
        "",
        "_blank",
        "width=1000,height=800"
      );

      if (!popup) {
        throw new Error(
          "Print window was blocked. Please allow pop-ups for this site."
        );
      }

      popup.document.open();

      popup.document.write(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safe(order.order_no)} - ${safe(title)}</title>

  <style>
    @page {
      size: ${pageSize} ${orientation};
      margin: 12mm;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      color: #111827;
      background: white;
      font-family: Arial, "Noto Nastaliq Urdu", sans-serif;
      font-size: 12px;
      line-height: 1.45;
    }

    .document {
      width: 100%;
    }

    .company {
      display: flex;
      align-items: center;
      gap: 16px;
      padding-bottom: 14px;
      border-bottom: 2px solid #111827;
    }

    .logo {
      width: 100px;
      height: 70px;
      object-fit: contain;
    }

    .company-main {
      flex: 1;
    }

    .company-name {
      margin: 0;
      font-size: 23px;
      font-weight: 800;
    }

    .company-line {
      margin-top: 3px;
      color: #475569;
    }

    .custom-header {
      margin-top: 10px;
      text-align: center;
      font-size: 12px;
      color: #475569;
    }

    .document-title {
      margin: 18px 0 14px;
      text-align: center;
    }

    .document-title h1 {
      margin: 0;
      font-size: 20px;
      text-transform: uppercase;
      letter-spacing: .5px;
    }

    .document-title .number {
      margin-top: 4px;
      font-weight: 700;
    }

    .meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin-bottom: 16px;
      border: 1px solid #cbd5e1;
    }

    .meta-item {
      min-height: 54px;
      padding: 8px 10px;
      border-right: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
    }

    .label {
      margin-bottom: 3px;
      color: #64748b;
      font-size: 12px;
      text-transform: uppercase;
    }

    .value {
      font-weight: 700;
    }

    .section-title {
      margin: 18px 0 7px;
      font-size: 13px;
      font-weight: 800;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th {
      padding: 8px;
      border: 1px solid #cbd5e1;
      background: #f1f5f9;
      text-align: left;
      font-size: 12px;
    }

    td {
      padding: 8px;
      border: 1px solid #cbd5e1;
      vertical-align: top;
    }

    .center {
      text-align: center;
    }

    .right {
      text-align: right;
    }

    .muted {
      color: #64748b;
      font-size: 12px;
    }

    .locked {
      margin-top: 12px;
      padding: 8px 10px;
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      font-size: 12px;
      color: #475569;
    }

    .signatures {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 28px;
      margin-top: 60px;
      page-break-inside: avoid;
    }

    .signature {
      padding-top: 6px;
      border-top: 1px solid #334155;
      text-align: center;
      font-weight: 700;
    }

    .footer {
      margin-top: 28px;
      padding-top: 10px;
      border-top: 1px solid #cbd5e1;
      text-align: center;
      color: #64748b;
      font-size: 12px;
    }

    .print-meta {
      margin-top: 8px;
      text-align: right;
      color: #94a3b8;
      font-size: 12px;
    }

    ${
      visibility.show_page_numbers
        ? `
          @media print {
            .page-number:after {
              content: counter(page);
            }
          }
        `
        : ""
    }

    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>

<body>
  <div class="document">

    <div class="company">
      ${
        visibility.show_logo &&
        company.logo_url
          ? `<img class="logo" src="${safe(company.logo_url)}" alt="Company Logo" />`
          : ""
      }

      <div class="company-main">
        ${
          visibility.show_company_name
            ? `<h2 class="company-name">${safe(
                company.company_name || "Steel Mill ERP"
              )}</h2>`
            : ""
        }

        ${
          visibility.show_address && company.address
            ? `<div class="company-line">${safe(company.address)}</div>`
            : ""
        }

        ${
          contactParts.length
            ? `<div class="company-line">${contactParts.join(" &nbsp; | &nbsp; ")}</div>`
            : ""
        }

        ${
          visibility.show_tax_details && taxParts.length
            ? `<div class="company-line">${taxParts.join(" &nbsp; | &nbsp; ")}</div>`
            : ""
        }
      </div>
    </div>

    ${
      visibility.show_header &&
      (company.document_header || company.document_header_urdu)
        ? `
          <div class="custom-header">
            ${
              company.document_header
                ? `<div>${safe(company.document_header)}</div>`
                : ""
            }
            ${
              company.document_header_urdu
                ? `<div>${safe(company.document_header_urdu)}</div>`
                : ""
            }
          </div>
        `
        : ""
    }

    <div class="document-title">
      <h1>${safe(title)}</h1>
      <div class="number">${safe(order.order_no)}</div>
    </div>

    <div class="meta">
      <div class="meta-item">
        <div class="label">Product / مصنوعات</div>
        <div class="value">${safe(order.item?.name || "—")}</div>
      </div>

      <div class="meta-item">
        <div class="label">Quantity / مقدار</div>
        <div class="value">${safe(order.qty)}</div>
      </div>

      <div class="meta-item">
        <div class="label">Start Date / آغاز</div>
        <div class="value">${
          order.start_date
            ? safe(formatDate(order.start_date))
            : "—"
        }</div>
      </div>

      <div class="meta-item">
        <div class="label">End Date / اختتام</div>
        <div class="value">${
          order.end_date
            ? safe(formatDate(order.end_date))
            : "—"
        }</div>
      </div>

      <div class="meta-item">
        <div class="label">Status / حالت</div>
        <div class="value">${safe(prettyStatus(order.status))}</div>
      </div>

      <div class="meta-item">
        <div class="label">Document Type / ڈاکومنٹ</div>
        <div class="value">${safe(title)}</div>
      </div>
    </div>

    <div class="section-title">
      Bill of Materials (Components) / بل آف میٹریلز
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:60px;text-align:center">#</th>
          <th>Component / جز</th>
          <th style="width:130px;text-align:right">Qty / مقدار</th>
        </tr>
      </thead>

      <tbody>
        ${rows}
      </tbody>
    </table>

    ${
      order.status === "completed" || order.status === "closed"
        ? `
          <div class="locked">
            Production completed — this Work Order is read-only.
            / پروڈکشن مکمل ہوچکی ہے، یہ ورک آرڈر صرف پڑھنے کیلئے ہے۔
          </div>
        `
        : ""
    }

    ${
      visibility.show_signatures
        ? `
          <div class="signatures">
            <div class="signature">
              ${safe(company.prepared_by_label || "Prepared By")}
            </div>

            <div class="signature">
              ${safe(company.checked_by_label || "Checked By")}
            </div>

            <div class="signature">
              ${safe(company.approved_by_label || "Approved By")}
            </div>
          </div>
        `
        : ""
    }

    ${
      visibility.show_footer &&
      (company.document_footer || company.document_footer_urdu)
        ? `
          <div class="footer">
            ${
              company.document_footer
                ? `<div>${safe(company.document_footer)}</div>`
                : ""
            }

            ${
              company.document_footer_urdu
                ? `<div>${safe(company.document_footer_urdu)}</div>`
                : ""
            }
          </div>
        `
        : ""
    }

    ${
      visibility.show_print_datetime
        ? `
          <div class="print-meta">
            Printed: ${safe(new Date().toLocaleString("en-PK"))}
          </div>
        `
        : ""
    }

    ${
      visibility.show_page_numbers
        ? `
          <div class="print-meta">
            Page <span class="page-number"></span>
          </div>
        `
        : ""
    }
  </div>

  <script>
    window.onload = function () {
      setTimeout(function () {
        window.print();
      }, 250);
    };
  </script>
</body>
</html>
      `);

      popup.document.close();
    } catch (err: any) {
      setError(err?.message || "Unable to prepare Work Order print.");
    }
  };

  if (loading) {
    return (
      <div className="card p-12 text-center text-slate-400">
        Loading… / لوڈ ہو رہا ہے…
      </div>
    );
  }

  if (!order) {
    return (
      <ErrorBanner message="Work order not found. / ورک آرڈر نہیں ملا۔" />
    );
  }

  return (
    <div>
      <Link
        to="/production"
        className="mb-4 inline-block text-sm text-primary-600 hover:text-primary-700"
      >
        ← Back to Work Orders / ورک آرڈرز
      </Link>

      <PageHeader
        title={order.order_no}
        subtitle={
          order.item
            ? `Product / مصنوعات: ${order.item.name}`
            : "No product assigned / کوئی مصنوعات منتخب نہیں"
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={order.status} />

            {canPrintProduction && <button
              type="button"
              onClick={() => void handlePrint()}
              className="btn btn-secondary"
              title="Open professional print view. Choose Save as PDF in the print dialog."
            >
              <Printer className="h-4 w-4" />
              Print / پرنٹ
            </button>}

            {canPrintProduction && <button
              type="button"
              onClick={() => void handlePdf()}
              className="btn btn-secondary"
              title="Download Work Order as PDF / ورک آرڈر PDF ڈاؤن لوڈ کریں"
            >
              <FileDown className="h-4 w-4" />
              PDF / پی ڈی ایف
            </button>}

            {order.status === "planned" && canEditProduction && (
              <button
                type="button"
                onClick={() =>
                  void handleStatusChange("in_progress")
                }
                className="btn-primary"
              >
                Start Production / پروڈکشن شروع کریں
              </button>
            )}

            {order.status === "in_progress" && canPostProduction && (
              <button
                type="button"
                onClick={() =>
                  void handleStatusChange("completed")
                }
                className="btn-primary"
              >
                Complete Production / پروڈکشن مکمل کریں
              </button>
            )}

            {order.status === "completed" && canEditProduction && (
              <button
                type="button"
                onClick={() =>
                  void handleStatusChange("closed")
                }
                className="btn-secondary"
              >
                Close Work Order / ورک آرڈر بند کریں
              </button>
            )}

            {order.status === "closed" && (
              <span className="text-sm font-medium text-slate-500">
                Work Order Closed / ورک آرڈر بند ہے
              </span>
            )}

            {order.status === "planned" && canDeleteProduction && (
              <button
                type="button"
                onClick={handleDeleteOrder}
                className="btn-danger"
              >
                Delete Order / آرڈر حذف کریں
              </button>
            )}
          </div>
        }
      />

      {isLocked && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-slate-600">
          <LockKeyhole className="h-4 w-4" />
          Completed production is locked and read-only. / مکمل پروڈکشن لاک ہے اور صرف دیکھنے کیلئے ہے۔
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card p-4">
          <div className="text-sm text-slate-500">
            Product / مصنوعات
          </div>
          <div className="mt-1 font-medium">
            {order.item?.name ?? "—"}
          </div>
        </div>

        <div className="card p-4">
          <div className="text-sm text-slate-500">
            Quantity / مقدار
          </div>
          <div className="mt-1 font-medium">{order.qty}</div>
        </div>

        <div className="card p-4">
          <div className="text-sm text-slate-500">
            Start / آغاز
          </div>
          <div className="mt-1 font-medium">
            {order.start_date
              ? formatDate(order.start_date)
              : "—"}
          </div>
        </div>

        <div className="card p-4">
          <div className="text-sm text-slate-500">
            Status / حالت
          </div>
          <div className="mt-1">
            <StatusBadge status={order.status} />
          </div>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="card mb-6 p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-semibold text-slate-900">
            Bill of Materials (Components) / بل آف میٹریلز (اجزاء)
          </h3>

          {isLocked && (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
              Read Only / صرف دیکھیں
            </span>
          )}
        </div>

        {lines.length === 0 ? (
          <div className="py-4 text-sm text-slate-400">
            No components yet. / ابھی کوئی جز شامل نہیں۔
          </div>
        ) : (
          <table className="mb-4 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="py-2 text-left font-medium text-slate-600">
                  Component / جز
                </th>

                <th className="py-2 text-right font-medium text-slate-600">
                  Qty / مقدار
                </th>

                {!isLocked && canEditProduction && <th />}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="py-2">
                    {line.item?.name ?? "—"}
                  </td>

                  <td className="py-2 text-right">
                    {line.qty}
                  </td>

                  {!isLocked && canEditProduction && (
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteLineId(line.id)
                        }
                        className="text-sm text-error-600 hover:text-error-700"
                      >
                        Remove / ہٹائیں
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!isLocked && canEditProduction && (
          <form
            onSubmit={handleAddLine}
            className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4"
          >
            <div className="min-w-[200px] flex-1">
              <label className="label">
                Add Component / جز شامل کریں
              </label>

              <SearchableSelect
                className="input"
                required
                value={newLine.item_id}
                onChange={(e) =>
                  setNewLine({
                    ...newLine,
                    item_id: e.target.value,
                  })
                }
              >
                <option value="">
                  — Select component —
                </option>

                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </SearchableSelect>
            </div>

            <div>
              <label className="label">
                Qty / مقدار
              </label>

              <input
                className="input w-24"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={newLine.qty}
                onChange={(e) =>
                  setNewLine({
                    ...newLine,
                    qty: e.target.value,
                  })
                }
              />
            </div>

            <button type="submit" className="btn-primary">
              Add Component / جز شامل کریں
            </button>
          </form>
        )}
      </div>

      <ConfirmModal
        open={!!deleteLineId && !isLocked}
        title="Remove Component / جز ہٹائیں"
        message="Remove this component from the bill of materials? / کیا یہ جز بل آف میٹریلز سے ہٹانا ہے؟"
        onConfirm={handleDeleteLine}
        onCancel={() => setDeleteLineId(null)}
      />
    </div>
  );
}
