import * as XLSX from 'xlsx';
import {createImportTemplateWorkbook} from '@/lib/importExcelTemplate';
export const TEMPLATE_HEADERS = [
  "entry_no",
  "entry_date",
  "description",
  "account_name",
  "line_description",
  "party_type",
  "party_name",
  "debit",
  "credit",
];

// Template is blank by design: real GL and parties must
// be selected from the active company's masters, never copied from fake samples.
export const TEMPLATE_ROWS: string[][] = [];

export const downloadCSVTemplate = () => {
  const rows = [
    TEMPLATE_HEADERS,
    ...TEMPLATE_ROWS,
  ];

  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell);

          if (
            value.includes(",") ||
            value.includes('"') ||
            value.includes("\n")
          ) {
            return `"${value.replace(
              /"/g,
              '""'
            )}"`;
          }

          return value;
        })
        .join(",")
    )
    .join("\r\n");

  const blob = new Blob(
    [csv],
    {
      type: "text/csv;charset=utf-8;",
    }
  );

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href = url;
  link.download =
    "journal-import-template.csv";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
};
export const downloadExcelTemplate = () => {
 const workbook=createImportTemplateWorkbook({
  filename:'journal-import-template.xlsx',sheetName:'Journal Import',
  headers:TEMPLATE_HEADERS,example:[],
  title:'NAVILO General Journal bulk import',
  notes:[
   'Upload creates DRAFT journals only. Review and post each journal in Accounting; no entries are posted automatically.',
   'All rows with the same entry_no must have the same entry_date and description. Debit and credit totals for each entry MUST balance.',
   'Account Name is the GL account receiving the debit or credit. General Journal lines do not carry a vehicle selection.',
   'Party Type/Party Name are for genuine AR/AP control accounts only. For vehicle-specific costs, use the Transport Vehicle Expenses module; for vehicle income, use the relevant transport invoice/import workflow.',
   'Do not invent missing accounts or use group accounts. If an account name is ambiguous, use the optional legacy account_head column to disambiguate.',
   'Supplier payment examples: DEBIT Accounts Payable with the correct Supplier Party and CREDIT Cash/Bank. Review direction and any existing allocations before posting.',
   'line_description is optional per line; description is the overall journal narration. Debit/Credit must balance per Entry No, with only one nonzero side per line.',
   'There is no sales/purchase invoice or receipt created by general Journal import. Do not re-import posted vouchers.'
  ]
 });
 const sheet=XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS,...TEMPLATE_ROWS]);
 sheet['!cols']=[
  {wch:18},{wch:15},{wch:35},{wch:34},{wch:38},{wch:16},{wch:36},{wch:17},{wch:17}
 ];
 sheet['!autofilter']={ref:`A1:I${TEMPLATE_ROWS.length+1}`};
 workbook.Sheets['Journal Import']=sheet;
 XLSX.writeFile(workbook,'journal-import-template.xlsx');
};
