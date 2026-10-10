import * as XLSX from 'xlsx';
import {HISTORY_COLUMNS,PAYMENT_COLUMNS} from './transportHistoricalImport';
export const TRANSPORT_TRIP_HEADERS=[
  "DATE",
  "TRUCK TYPE",
  "PO/DO/JOB NO.",
  "INVOICED",
  "COMPANY NAME",
  "DRIVER NAME",
  "OWNER",
  "PLATE #",
  "FROM",
  "TO",
  "PAPER RECEIVED BY",
  "DATE",
  "PAY TO DRIVER",
  "Supplier Rent",
  "REMAINING WITH US",
  "PAYMENT DATE",
  "AMOUNT",
  "Customer Rate",
  "received from company",
  "remaining with company",
  "PROFIT",
  "paid commissin for trip",
  "INVOICE NUMBER",
  "Sale Type (Cash / Credit)"
] as const;
export const downloadDailyTripTemplate=()=>{
    const example=[
      new Date(),
      "FLATBED",
      "PO-001",
      "",
      "Example Customer",
      "Example Driver",
      "Example Supplier",
      "ABC-123",
      "Dammam",
      "Riyadh",
      "PPR PENDING",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Credit"
    ];

    const ws=XLSX.utils.aoa_to_sheet([
      [...TRANSPORT_TRIP_HEADERS],
      example
    ]);

    ws["!cols"]=TRANSPORT_TRIP_HEADERS.map((header)=>({
      wch:Math.min(28,Math.max(12,String(header).length+3))
    }));

    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Trips");

    const companies=XLSX.utils.aoa_to_sheet([["COMPANY NAME"]]);
    const vehicles=XLSX.utils.aoa_to_sheet([["PLATE #","TRUCK TYPE"]]);
    const owners=XLSX.utils.aoa_to_sheet([["OWNER"]]);
    const places=XLSX.utils.aoa_to_sheet([["PLACE"]]);

    XLSX.utils.book_append_sheet(wb,companies,"compnies");
    XLSX.utils.book_append_sheet(wb,vehicles,"vehicles");
    XLSX.utils.book_append_sheet(wb,owners,"owners");
    XLSX.utils.book_append_sheet(wb,places,"places");

    XLSX.writeFile(wb,"Transport_Trip_Excel_Upload_template-NAVILO.xlsx");
  };
export function downloadHistoricalTemplate(){const w=XLSX.utils.book_new();const headers=['DATE','TRUCK TYPE','PO/DO/JOB NO.','INVOICED','COMPANY NAME','DRIVER NAME','OWNER','PLATE #','FROM','TO','PAPER RECEIVED BY','Customer Rate','Supplier Rent','Sale Type (Cash / Credit)',...HISTORY_COLUMNS];
  XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([headers,['2026-10-01','FLATBED','JOB-1','Yes','Example Customer','Example Driver','Example Supplier','ABC-123','From','To','PPR PENDING',2000,1700,'Credit','OLD-0001','Yes','2026-10-01','No',2000,600,1400,'Yes','2026-10-01','No',1700,1000,700]]),'Trips');
  XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([[...PAYMENT_COLUMNS],['OLD-0001','customer','2026-10-02',600,'YOUR-CASH-CODE','RCPT-1'],['OLD-0001','supplier','2026-10-02',1000,'YOUR-BANK-CODE','PAY-1']]),'Payments');
  const notes=[['Historical Transport import'],['One Source Record ID per real trip. Same-date repeat journeys need distinct IDs.'],['Yes/No posted and VAT flags are independent for customer and supplier. Rates/rent exclude VAT. Gross and remaining include VAT.'],['Payments: one allocation per dated partial payment. Use the existing Chart of Accounts cash/bank code. Repeat a shared voucher reference for separate trip allocations.'],['This creates canonical service invoices, customer receipts and supplier payments. Each trip has its own NAVILO invoice; original invoice reference remains informational.'],['Add explicit historical columns and Payments sheet to an existing BuKu file. PAY TO DRIVER must equal Supplier Paid only when it actually represents supplier rent. Employee payroll and commissions require separately reconciled canonical entries.'],['Opening balances must exclude these imported invoices and payments. Reconcile starting cash/bank balances before confirmation. Closed accounting periods and dated ownership must be resolved through existing controls.'],['One historical dataset per business unit. After posting starts, resume the original file/settings. Completed imports cannot be repeated.']];
  XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(notes),'Instructions');for(const n of w.SheetNames)w.Sheets[n]['!cols']=(n==='Instructions'?[{wch:130}]:Array.from({length:n==='Trips'?headers.length:PAYMENT_COLUMNS.length},()=>({wch:22})));
  XLSX.writeFile(w,'Transport-Historical-Import-Template.xlsx');
 }
