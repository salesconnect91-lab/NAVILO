import { Routes, Route } from "react-router-dom";
import JournalEntryList from "./JournalEntryList";
import JournalEntryDetail from "./JournalEntryDetail";
import ChartOfAccounts from "./ChartOfAccounts";
import Ledgers from "./Ledgers";
import DayBook from "./DayBook";
import TrialBalance from "./TrialBalance";
import ProfitLoss from "./ProfitLoss";
import BalanceSheet from "./BalanceSheet";
import AuditTrail from "./AuditTrail";
import CashCounterWorkspace from "./CashCounterWorkspace";
import PayrollLedger from "./PayrollLedger";
import LoanLedger from "./LoanLedger";
import AccountMappingSetup from "./AccountMappingSetup";
import AccountingPeriods from "./AccountingPeriods";
import OpeningBalances from "./OpeningBalances";
import ReturnNotes from "./ReturnNotes";
import BankReconciliation from "./BankReconciliation";
import FiscalYearClosing from "./FiscalYearClosing";
import CashFlowStatement from "./CashFlowStatement";
import FinancialControls from "./FinancialControls";
import PaymentReversals from "./PaymentReversals";
import VatRegister from "./VatRegister";
import ReportSurface from "@/components/reports/ReportSurface";

const report = (node: React.ReactNode) => <ReportSurface>{node}</ReportSurface>;

export default function Accounting() {
  return (
    <div className="space-y-4">
      <Routes>
        <Route path="/" element={<JournalEntryList />} />
        <Route path="/cash-counter" element={<CashCounterWorkspace />} />
        <Route path="/payroll" element={report(<PayrollLedger />)} />
        <Route path="/loans" element={report(<LoanLedger />)} />
        <Route path="/payment-reversals" element={<PaymentReversals />} />
        <Route path="/vat-register" element={report(<VatRegister />)} />
        <Route path="/day-book" element={report(<DayBook />)} />
        <Route path="/accounts" element={<ChartOfAccounts />} />
        <Route path="/mappings" element={<AccountMappingSetup />} />
        <Route path="/opening-balances" element={<OpeningBalances />} />
        <Route path="/periods" element={report(<AccountingPeriods />)} />
        <Route path="/returns" element={<ReturnNotes />} />
        <Route path="/bank-reconciliation" element={report(<BankReconciliation />)} />
        <Route path="/year-closing" element={report(<FiscalYearClosing />)} />
        <Route path="/cash-flow" element={report(<CashFlowStatement />)} />
        <Route path="/controls" element={report(<FinancialControls />)} />
        <Route path="/ledgers" element={report(<Ledgers />)} />
        <Route path="/trial-balance" element={report(<TrialBalance />)} />
        <Route path="/profit-loss" element={report(<ProfitLoss />)} />
        <Route path="/balance-sheet" element={report(<BalanceSheet />)} />
        <Route path="/audit-trail" element={report(<AuditTrail />)} />
        <Route path="/:id" element={<JournalEntryDetail />} />
      </Routes>
    </div>
  );
}
