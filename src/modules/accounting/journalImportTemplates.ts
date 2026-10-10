import * as XLSX from 'xlsx';
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
  [
    "JE-1001",
    "2026-08-26",
    "Payment to Amjad Khan",
    "",
    "Accounts Payable",
    "Amjad Khan",
    "0",
    "5000",
  ],
  [
    "JE-1001",
    "2026-08-26",
    "Payment to Amjad Khan",
    "",
    "Cash",
    "Cash",
    "5000",
    "0",
  ],
  [
    "JE-1002",
    "2026-08-26",
    "Office expense",
    "",
    "Office Expenses",
    "Office Rent",
    "2000",
    "0",
  ],
  [
    "JE-1002",
    "2026-08-26",
    "Office expense",
    "",
    "Office Expenses",
    "Stationery",
    "1000",
    "0",
  ],
  [
    "JE-1002",
    "2026-08-26",
    "Office expense",
    "",
    "Cash",
    "Cash",
    "0",
    "3000",
  ],
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
  const worksheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_ROWS]);
  worksheet["!cols"] = [
    { wch: 18 }, { wch: 14 }, { wch: 34 }, { wch: 18 },
    { wch: 30 }, { wch: 34 }, { wch: 16 }, { wch: 16 },
  ];
  worksheet["!autofilter"] = { ref: `A1:H${TEMPLATE_ROWS.length + 1}` };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Journal Import");
  XLSX.writeFile(workbook, "journal-import-template.xlsx");
};
