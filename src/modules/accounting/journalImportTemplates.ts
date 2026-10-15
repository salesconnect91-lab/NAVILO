import * as XLSX from 'xlsx';
import {createImportTemplateWorkbook} from '@/lib/importExcelTemplate';
export const TEMPLATE_HEADERS = [
  "entry_no",
  "entry_date",
  "description",
  "account_code",
  "account_head",
  "account_name",
  "party_type",
  "party_name",
  "debit",
  "credit",
];

export const TEMPLATE_ROWS = [
  // Examples only. Replace with the selected Company's existing accounts and parties.
  ['JE-EXAMPLE-001','2026-10-01','Customer balance reclassification','1130','','Accounts Receivable','customer','EXISTING CUSTOMER NAME',1000,0],
  ['JE-EXAMPLE-001','2026-10-01','Customer balance reclassification','1130','','Accounts Receivable','customer','OTHER EXISTING CUSTOMER NAME',0,1000],
  ['JE-EXAMPLE-002','2026-10-02','Office expenses','','Office Expenses','Office Rent','','',2000,0],
  ['JE-EXAMPLE-002','2026-10-02','Office expenses','','Cash','Petty Cash','','',0,2000],
];

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
  headers:TEMPLATE_HEADERS,example:TEMPLATE_ROWS[0],
  title:'NAVILO General Journal bulk import',
  notes:[
   'Upload creates DRAFT journals only. Review and post each journal in Accounting; no entries are posted automatically.',
   'All rows with the same entry_no must have the same entry_date and description. Debit and credit totals for each entry MUST balance.',
   'Enter an existing active account_code OR an exact account_head + account_name. Replace all sample values with current Company accounts.',
   'For Accounts Receivable use the mapped AR account and party_type customer plus an existing Customer Master party_name. For Accounts Payable use the mapped AP account and party_type supplier plus an existing Supplier Master party_name. For other accounts leave both party columns blank.',
   'Do not invent missing accounts or use group/header accounts; account matching follows the selected Company and Business Unit.',
   'Supplier payment examples: DEBIT Accounts Payable with the correct Supplier Party and CREDIT Cash/Bank. Review direction and any existing allocations before posting.',
   'Debit/Credit should be numeric with a maximum of two decimals; each line has only one nonzero side.',
   'There is no sales/purchase invoice or receipt created by general Journal import. Do not re-import posted vouchers.'
  ]
 });
 const sheet=XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS,...TEMPLATE_ROWS]);
 sheet['!cols']=[
  {wch:18},{wch:15},{wch:35},{wch:19},{wch:30},{wch:34},{wch:16},{wch:36},{wch:17},{wch:17}
 ];
 sheet['!autofilter']={ref:`A1:J${TEMPLATE_ROWS.length+1}`};
 workbook.Sheets['Journal Import']=sheet;
 XLSX.writeFile(workbook,'journal-import-template.xlsx');
};
