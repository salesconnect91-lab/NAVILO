import { printReportDescription } from "./printDocument";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  loadDocumentPrintSettings,
  documentContactText,
  documentTaxText,
  documentPageFormat,
  documentOrientation,
} from "@/lib/documentPrintSettings";

interface ReportPdfOptions {
  fileName: string;
  title: string;
  subtitle?: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  summaryRows?: Array<[string, string | number]>;
}

export async function downloadAccountingReportPdf({ fileName, title, subtitle, columns, rows, summaryRows = [] }: ReportPdfOptions) {
  const settings = await loadDocumentPrintSettings("reports");
  const { company, visibility } = settings;
  const doc = new jsPDF({ orientation: documentOrientation(company.page_orientation), unit: "mm", format: documentPageFormat(company.page_size) });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 8;
  let y = 8;

  if (visibility.show_logo && company.logo_url) {
    try {
      const response = await fetch(company.logo_url);
      const blob = await response.blob();
      if (!blob.type.includes("svg")) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        doc.addImage(dataUrl, blob.type.includes("jpeg") ? "JPEG" : "PNG", margin, y, 26, 14);
      }
    } catch { /* continue without image */ }
  }

  if (visibility.show_company_name) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text(company.company_name || "Company", pageWidth / 2, y + 4, { align: "center" });
  }
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  if (visibility.show_address && company.address) { y += 8; doc.text(company.address, pageWidth / 2, y, { align: "center" }); }
  if (visibility.show_phone_email) { const value = documentContactText(company); if (value) { y += 4; doc.text(value, pageWidth / 2, y, { align: "center" }); } }
  if (visibility.show_tax_details) { const value = documentTaxText(company); if (value) { y += 4; doc.text(value, pageWidth / 2, y, { align: "center" }); } }
  if (visibility.show_header && company.document_header) { y += 5; doc.setFont("helvetica", "bold"); doc.text(company.document_header, pageWidth / 2, y, { align: "center" }); }

  y += 6; doc.setDrawColor(30, 41, 59); doc.setLineWidth(0.55); doc.line(margin, y, pageWidth - margin, y);
  y += 7; doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text(title, margin, y);
  if (subtitle) { doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(71, 85, 105); doc.text(printReportDescription(subtitle), pageWidth - margin, y, { align: "right" }); doc.setTextColor(15, 23, 42); }
  y += 5;

  const numericStart = Math.max(0, columns.findIndex((column) => /debit|credit|balance|amount|total|dr\b|cr\b/i.test(column)));
  autoTable(doc, {
    startY: y, head: [columns], body: rows, theme: "plain",
    styles: { font: "helvetica", fontSize: 7.7, cellPadding: { top: 1.2, right: 1.2, bottom: 1.2, left: 1.2 }, textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: { bottom: 0.12 }, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: [238, 242, 247], textColor: [30, 41, 59], fontStyle: "bold", fontSize: 7.3, lineColor: [148, 163, 184], lineWidth: { top: 0.25, bottom: 0.25 } },
    alternateRowStyles: { fillColor: [251, 253, 255] },
    columnStyles: Object.fromEntries(columns.map((_, index) => [index, index >= numericStart ? { halign: "right" } : { halign: "left" }])),
    margin: { left: margin, right: margin, bottom: 22 },
    didDrawPage: () => { doc.setDrawColor(226, 232, 240); doc.line(margin, pageHeight - 17, pageWidth - margin, pageHeight - 17); },
  });

  const tableEnd = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  let summaryY = tableEnd + 6;
  if (summaryRows.length) {
    const boxWidth = Math.min(88, pageWidth - margin * 2);
    const boxX = pageWidth - margin - boxWidth;
    if (summaryY + summaryRows.length * 5.5 > pageHeight - 25) { doc.addPage(); summaryY = 18; }
    doc.setFillColor(248, 250, 252); doc.setDrawColor(203, 213, 225);
    doc.roundedRect(boxX, summaryY - 4, boxWidth, summaryRows.length * 5.5 + 4, 1, 1, "FD");
    summaryRows.forEach(([label, value], index) => {
      const lineY = summaryY + index * 5.5;
      doc.setFont("helvetica", index === summaryRows.length - 1 ? "bold" : "normal"); doc.setFontSize(8);
      doc.text(String(label), boxX + 3, lineY); doc.text(String(value), pageWidth - margin - 3, lineY, { align: "right" });
    });
    summaryY += summaryRows.length * 5.5 + 7;
  }

  if (visibility.show_signatures) {
    if (summaryY > pageHeight - 35) { doc.addPage(); summaryY = 28; } else summaryY += 8;
    const labels = [company.prepared_by_label || "Prepared By", company.checked_by_label || "Checked By", company.approved_by_label || "Approved By"];
    const sectionWidth = (pageWidth - margin * 2) / 3;
    labels.forEach((label, index) => { const x1 = margin + sectionWidth * index; const center = x1 + sectionWidth / 2; doc.setDrawColor(100); doc.line(x1 + 5, summaryY, x1 + sectionWidth - 5, summaryY); doc.setFontSize(7.5); doc.text(label, center, summaryY + 4.5, { align: "center" }); });
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page); doc.setFont("helvetica", "normal"); doc.setFontSize(6.8); doc.setTextColor(100, 116, 139);
    if (visibility.show_footer && company.document_footer) doc.text(company.document_footer, pageWidth / 2, pageHeight - 11, { align: "center" });
    if (visibility.show_print_datetime) doc.text(`Printed ${new Date().toLocaleString("en-PK")}`, margin, pageHeight - 6);
    if (visibility.show_page_numbers) doc.text(`Page ${page} / ${pages}`, pageWidth - margin, pageHeight - 6, { align: "right" });
  }
  doc.save(fileName);
}
