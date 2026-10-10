import * as XLSX from 'xlsx';
import {createImportTemplateWorkbook} from '@/lib/importExcelTemplate';
export const TEMPLATE_HEADERS = [
  "entry_no",
  "entry_date",
  "description",
  "account_code",
  "account_head",
  "account_name",
  "debit",
  "credit",
];

export const TEMPLATE_ROWS = [
 // Replace these example accounts with current Company Chart of Accounts names or codes.
 ['JE-1001','2026-10-01','Example supplier settlement','','Accounts Payable','Example Supplier',5000,0],
 ['JE-1001','2026-10-01','Example supplier settlement','','Cash','Petty Cash',0,5000],
 ['JE-1002','2026-10-02','Office expenses','','Office Expenses','Office Rent',2000,0],
 ['JE-1002','2026-10-02','Office expenses','','Office Expenses','Stationery',1000,0],
 ['JE-1002','2026-10-02','Office expenses','','Cash','Petty Cash',0,3000],
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
   'Enter an existing active Chart of Accounts account_code OR the exact account_head + account_name combination. The sample names must be replaced with your real Company accounts.',
   'Do not invent missing accounts or use group/header accounts; account matching follows the selected Company and Business Unit.',
   'For payments to a supplier: DEBIT the payable and CREDIT Cash/Bank. For expenses: DEBIT expense, CREDIT Cash/Bank or the applicable liability.',
   'Debit/Credit should be numeric with a maximum of two decimals; each line has only one nonzero side.',
   'There is no sales/purchase invoice or receipt created by general Journal import. Do not re-import posted vouchers.'
  ]
 });
 const sheet=XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS,...TEMPLATE_ROWS]);
 sheet['!cols']=[
  {wch:18},{wch:15},{wch:35},{wch:19},{wch:30},{wch:34},{wch:17},{wch:17}
 ];
 sheet['!autofilter']={ref:`A1:H${TEMPLATE_ROWS.length+1}`};
 workbook.Sheets['Journal Import']=sheet;
 XLSX.writeFile(workbook,'journal-import-template.xlsx');
};
