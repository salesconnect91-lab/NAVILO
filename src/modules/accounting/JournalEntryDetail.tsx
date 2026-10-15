import {recordDisplayText} from '@/lib/recordDisplayText';
import {useAuth} from '@/auth/AuthContext';
import NaviloDateInput from '@/components/NaviloDateInput';
import SearchableSelect from "@/components/SearchableSelect";
import {
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";

import {
  useParams,
  useNavigate,
  Link,
} from "react-router-dom";

import * as XLSX from "xlsx";

import { supabase } from "@/lib/supabase";
import { fetchAllPages } from "@/lib/fetchAllPages";
import {vehicleDisplayLabel} from "@/lib/transportVehicleLabel";
import {journalRelatedToMode,vehicleOwnedOnDate,normalizedJournalVehicleNo,type OwnedPeriod} from "./journalRelatedTo";
import {canReversePostedManualJournal} from "./journalPostedActionPolicy";

import {
  JournalEntry,
  JournalLine,
  ChartOfAccount,
  Customer,
  Supplier,
  PartyType,
} from "@/types";

import {
  ErrorBanner,
  StatusBadge,
  formatCurrency,
  formatDate,
  ConfirmModal,
  Modal,
} from "@/components/ui";

/* =========================================================
   TYPES
========================================================= */

type DraftLine = {
  tempId: string;
  accountId: string;
  vehicleId?: string;
  partyType: PartyType | "";
  partyId: string;
  debit: string;
  credit: string;
  description: string;
};

type ImportRow = {
  description: string;
  accountCode: string;
  accountName: string;
  partyType: PartyType | "";
  partyName: string;
  vehicleNo: string;
  debit: string;
  c¶»§q«^