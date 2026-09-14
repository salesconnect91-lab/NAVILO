export type ConfiguredChargeUnit = "fixed" | "percent" | "per_qty" | "per_kg" | "per_ton" | "per_piece" | "manual";

type ChargeRow = { item_id: string; qty: number | string };
type ChargeItem = { id: string; unit?: string | null };

function normalizedUnit(unit?: string | null): string {
  return String(unit ?? "").trim().toLowerCase();
}

function isKgUnit(unit?: string | null): boolean {
  const value = normalizedUnit(unit);
  return value === "kg" || value === "kgs" || value.includes("kilogram") || value.includes("kilo gram") || value.includes("کلوگرام") || value.includes("کلو گرام");
}

function isTonUnit(unit?: string | null): boolean {
  const value = normalizedUnit(unit);
  return value === "t" || value === "mt" || value === "ton" || value === "tons" || value === "tonne" || value === "tonnes" || value.includes("metric ton") || value.includes("ٹن");
}

function isPieceUnit(unit?: string | null): boolean {
  const value = normalizedUnit(unit);
  return value === "pc" || value === "pcs" || value === "piece" || value === "pieces" || value.includes("piece") || value.includes("عدد");
}

export function chargeQuantityForUnit(
  chargeUnit: ConfiguredChargeUnit,
  rows: ChargeRow[],
  items: ChargeItem[],
  baseAmount: number,
): number {
  if (chargeUnit === "fixed" || chargeUnit === "manual") return 1;
  if (chargeUnit === "percent") return Math.max(0, Number(baseAmount) || 0);
  if (chargeUnit === "per_qty") {
    // Only real item lines contribute to quantity-based charges. Purchase forms
    // intentionally start with an empty row whose default qty is 1; counting it
    // would overstate per-qty charges before an item is selected.
    return rows.reduce((sum, row) => {
      if (!row.item_id) return sum;
      return sum + Math.max(0, Number(row.qty) || 0);
    }, 0);
  }

  let totalKg = 0;
  let totalPieces = 0;
  for (const row of rows) {
    const qty = Math.max(0, Number(row.qty) || 0);
    if (!row.item_id || qty <= 0) continue;
    const item = items.find((candidate) => candidate.id === row.item_id);
    if (!item) continue;
    if (isKgUnit(item.unit)) totalKg += qty;
    else if (isTonUnit(item.unit)) totalKg += qty * 1000;
    else if (isPieceUnit(item.unit)) totalPieces += qty;
  }

  if (chargeUnit === "per_kg") return totalKg;
  if (chargeUnit === "per_ton") return totalKg / 1000;
  if (chargeUnit === "per_piece") return totalPieces;
  return 0;
}

export function calculateConfiguredChargeAmount(args: {
  unit: ConfiguredChargeUnit;
  rate: number;
  rows: ChargeRow[];
  items: ChargeItem[];
  baseAmount: number;
}): number {
  const rate = Math.max(0, Number(args.rate) || 0);
  if (args.unit === "manual") return Math.round((rate + Number.EPSILON) * 100) / 100;
  const quantity = chargeQuantityForUnit(args.unit, args.rows, args.items, args.baseAmount);
  const amount = args.unit === "percent" ? (quantity * rate) / 100 : quantity * rate;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
