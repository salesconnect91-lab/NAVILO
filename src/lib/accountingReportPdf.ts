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
  rowKinds?: Array<'section' | 'group' | 'subheading' | 'detail' | 'subtotal' | 'total' | 'check'>;
  orientation?: 'portrait' | 'landscape';
}

export async function downloadAccountingReportPdf({ fileName, title, subtitle, columns, rows, summaryRows = [], rowKinds = [], orientation }: ReportPdfOptions) {
  const settings = await loadDocumentPrintSettings("reports");
  const { company, visibility } = settings;
  const doc = new jsPDF({ orientation: orientation || (columns.length >= 6 ? "landscape" : documentOrientation(company.page_orientation)), unit: "mm", format: documentPageFormat(company.page_size) });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 8;
  let y = 8;
  let logoDrawn = false;

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
        logoDrawn = true;
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

  if (logoDrawn) y = Math.max(y, 20); // Keep the title divider clear of the logo.
  y += 6; doc.setDrawColor(30, 41, 59); doc.setLineWidth(0.55); doc.line(margin, y, pageWidth - margin, y);
  y += 7; doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text(title, margin, y);
  if (subtitle) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    const lines = doc.splitTextToSize(printReportDescription(subtitle), pageWidth - margin * 2);
    if (lines.length) { y += 5; doc.text(lines, margin, y); y += Math.max(0, lines.length - 1) * 3.3; }
    doc.setTextColor(15, 23, 42);
  }
  y += 5;

  const numericIndexes = new Set(columns.flatMap((column, index) => /debit|credit|balance|amount|total|movement|vouchers|opening|closing|\bdr\b|\bcr\b/i.test(column) ? [index] : []));
  autoTable(doc, {
    startY: y,
    head: [columns],
    body: rows.map((row, index) =>
      rowKinds[index] === "section" ? [{content:String(row[0] ?? ""),colSpan:columns.length}] : row.map(cell => typeof cell === "number" ? cell.toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2}) : cell)),
    theme: "plain",
    showHead: "everyPage",
    styles: { font: "helvetica", fontSize: 7.7, cellPadding: { top: 1.55, right: 1.8, bottom: 1.55, left: 1.8 }, textColor: [30, 41, 59], lineColor: [216, 226, 236], lineWidth: { bottom: 0.12 }, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: [231, 239, 247], textColor: [25, 54, 83], fontStyle: "bold", fontSize: 7.5, lineColor: [160, 179, 200], lineWidth: { top: 0.35, bottom: 0.35 } },
    columnStyles: Object.fromEntries(columns.map((_, index) => [index, { halign: numericIndexes.has(index) ? "right" : "left" }])),
    margin: { top: 23, left: margin, right: margin, bottom: 22 },
    didParseCell: (cell) => {
      if (cell.section !== "body") return;
      const kind = rowKinds[cell.row.index];
      if (kind === "section") {
        cell.cell.styles.fillColor=[239, 244, 249];
        cell.cell.styles.textColor=[23, 54, 85];
        cell.cell.styles.fontStyle="bold";
        cell.cell.styles.fontSize=8.2;
        cell.cell.styles.cellPadding={top:2.6,right:1.8,bottom:2,left:1.8};
        cell.cell.styles.halign="left";
      } else if (kind === "subtotal" || kind === "total" || kind === "check") {
        cell.cell.styles.fontStyle="bold";
        cell.cell.styles.fillColor=kind === "total" ? [232, 241, 249] : [246, 249, 252];
        cell.cell.styles.lineColor=[114, 143, 171];
        cell.cell.styles.lineWidth={top:kind === "total" ? 0.4 : 0.2,bottom:0.2};
      }
    },
    didDrawPage: (page) => {
      if(page.pageNumber > 1){
        doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(34,65,95);
        doc.text(company.company_name || "Company", margin, 10);
        doc.setFontSize(10);doc.text(title,margin,16);
        doc.setDrawColor(114,143,171);doc.line(margin,19,pageWidth-margin,19);
      }
      doc.setDrawColor(216, 226, 236);
      doc.line(margin, pageHeight - 17, pageWidth - margin, pageHeight - 17);
    },
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
