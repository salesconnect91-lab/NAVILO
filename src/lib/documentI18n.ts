export type DocumentLanguage = "en" | "ur" | "ar";
export type DocumentLanguageMode = "single" | "bilingual";

type Translation = { en: string; ur: string; ar: string };

const CATALOG: Record<string, Translation> = {
  "invoice": { en: "Invoice", ur: "انوائس", ar: "الفاتورة" },
  "sales invoice": { en: "Sales Invoice", ur: "سیلز انوائس", ar: "فاتورة المبيعات" },
  "purchase invoice": { en: "Purchase Invoice", ur: "خریداری انوائس", ar: "فاتورة المشتريات" },
  "tax invoice": { en: "Tax Invoice", ur: "ٹیکس انوائس", ar: "فاتورة ضريبية" },
  "cash bill": { en: "Cash Bill", ur: "کیش بل", ar: "فاتورة نقدية" },
  "purchase order": { en: "Purchase Order", ur: "پرچیز آرڈر", ar: "أمر الشراء" },
  "sales order": { en: "Sales Order", ur: "سیلز آرڈر", ar: "أمر البيع" },
  "consolidated invoice": { en: "Consolidated Invoice", ur: "مشترکہ انوائس", ar: "فاتورة مجمعة" },
  "credit note": { en: "Credit Note", ur: "کریڈٹ نوٹ", ar: "إشعار دائن" },
  "debit note": { en: "Debit Note", ur: "ڈیبٹ نوٹ", ar: "إشعار مدين" },
  "receipt": { en: "Receipt", ur: "وصولی", ar: "إيصال" },
  "payment voucher": { en: "Payment Voucher", ur: "ادائیگی واؤچر", ar: "سند دفع" },
  "receipt voucher": { en: "Receipt Voucher", ur: "وصولی واؤچر", ar: "سند قبض" },
  "journal voucher": { en: "Journal Voucher", ur: "جرنل واؤچر", ar: "سند قيد" },
  "gate pass": { en: "Gate Pass", ur: "گیٹ پاس", ar: "تصريح البوابة" },
  "delivery challan": { en: "Delivery Challan", ur: "ڈیلیوری چالان", ar: "إذن تسليم" },
  "customer statement": { en: "Customer Statement", ur: "گاہک اسٹیٹمنٹ", ar: "كشف حساب العميل" },
  "supplier statement": { en: "Supplier Statement", ur: "سپلائر اسٹیٹمنٹ", ar: "كشف حساب المورد" },
  "general ledger": { en: "General Ledger", ur: "جنرل لیجر", ar: "دفتر الأستاذ العام" },
  "trial balance": { en: "Trial Balance", ur: "ٹرائل بیلنس", ar: "ميزان المراجعة" },
  "profit & loss": { en: "Profit & Loss", ur: "نفع و نقصان", ar: "الأرباح والخسائر" },
  "balance sheet": { en: "Balance Sheet", ur: "بیلنس شیٹ", ar: "الميزانية العمومية" },
  "cash flow": { en: "Cash Flow", ur: "کیش فلو", ar: "التدفق النقدي" },
  "invoice no": { en: "Invoice No", ur: "انوائس نمبر", ar: "رقم الفاتورة" },
  "invoice date": { en: "Invoice Date", ur: "انوائس تاریخ", ar: "تاريخ الفاتورة" },
  "order no": { en: "Order No", ur: "آرڈر نمبر", ar: "رقم الطلب" },
  "order date": { en: "Order Date", ur: "آرڈر تاریخ", ar: "تاريخ الطلب" },
  "reference": { en: "Reference", ur: "حوالہ", ar: "المرجع" },
  "date": { en: "Date", ur: "تاریخ", ar: "التاريخ" },
  "due date": { en: "Due Date", ur: "واجب الادا تاریخ", ar: "تاريخ الاستحقاق" },
  "customer": { en: "Customer", ur: "گاہک", ar: "العميل" },
  "supplier": { en: "Supplier", ur: "سپلائر", ar: "المورد" },
  "salesperson": { en: "Salesperson", ur: "سیلز پرسن", ar: "مندوب المبيعات" },
  "address": { en: "Address", ur: "پتہ", ar: "العنوان" },
  "phone": { en: "Phone", ur: "فون", ar: "الهاتف" },
  "email": { en: "Email", ur: "ای میل", ar: "البريد الإلكتروني" },
  "ntn": { en: "NTN", ur: "این ٹی این", ar: "الرقم الضريبي" },
  "strn": { en: "STRN", ur: "ایس ٹی آر این", ar: "رقم التسجيل الضريبي" },
  "item": { en: "Item", ur: "آئٹم", ar: "الصنف" },
  "description": { en: "Description", ur: "تفصیل", ar: "الوصف" },
  "qty": { en: "Qty", ur: "مقدار", ar: "الكمية" },
  "quantity": { en: "Quantity", ur: "مقدار", ar: "الكمية" },
  "uom": { en: "UOM", ur: "اکائی", ar: "الوحدة" },
  "rate": { en: "Rate", ur: "ریٹ", ar: "السعر" },
  "price": { en: "Price", ur: "قیمت", ar: "السعر" },
  "amount": { en: "Amount", ur: "رقم", ar: "المبلغ" },
  "discount": { en: "Discount", ur: "رعایت", ar: "الخصم" },
  "tax": { en: "Tax", ur: "ٹیکس", ar: "الضريبة" },
  "vat": { en: "VAT", ur: "وی اے ٹی", ar: "ضريبة القيمة المضافة" },
  "vat amount": { en: "VAT Amount", ur: "وی اے ٹی رقم", ar: "مبلغ ضريبة القيمة المضافة" },
  "charges": { en: "Charges", ur: "چارجز", ar: "الرسوم" },
  "subtotal": { en: "Subtotal", ur: "ذیلی کل", ar: "المجموع الفرعي" },
  "total": { en: "Total", ur: "کل", ar: "الإجمالي" },
  "grand total": { en: "Grand Total", ur: "مجموعی کل", ar: "الإجمالي العام" },
  "balance": { en: "Balance", ur: "بیلنس", ar: "الرصيد" },
  "opening balance": { en: "Opening Balance", ur: "ابتدائی بیلنس", ar: "الرصيد الافتتاحي" },
  "closing balance": { en: "Closing Balance", ur: "اختتامی بیلنس", ar: "الرصيد الختامي" },
  "debit": { en: "Debit", ur: "ڈیبٹ", ar: "مدين" },
  "credit": { en: "Credit", ur: "کریڈٹ", ar: "دائن" },
  "payment method": { en: "Payment Method", ur: "ادائیگی کا طریقہ", ar: "طريقة الدفع" },
  "cash": { en: "Cash", ur: "نقد", ar: "نقد" },
  "bank": { en: "Bank", ur: "بینک", ar: "البنك" },
  "notes": { en: "Notes", ur: "نوٹس", ar: "ملاحظات" },
  "remarks": { en: "Remarks", ur: "ریمارکس", ar: "ملاحظات" },
  "prepared by": { en: "Prepared By", ur: "تیار کردہ", ar: "أعده" },
  "checked by": { en: "Checked By", ur: "جانچ کردہ", ar: "راجعه" },
  "approved by": { en: "Approved By", ur: "منظور کردہ", ar: "اعتمده" },
  "signature": { en: "Signature", ur: "دستخط", ar: "التوقيع" },
  "warehouse": { en: "Warehouse", ur: "ویئرہاؤس", ar: "المستودع" },
  "godown": { en: "Godown", ur: "گودام", ar: "المخزن" },
  "branch": { en: "Branch", ur: "برانچ", ar: "الفرع" },
  "business unit": { en: "Business Unit", ur: "بزنس یونٹ", ar: "وحدة الأعمال" },
  "vehicle no": { en: "Vehicle No", ur: "گاڑی نمبر", ar: "رقم المركبة" },
  "driver": { en: "Driver", ur: "ڈرائیور", ar: "السائق" },
  "weight": { en: "Weight", ur: "وزن", ar: "الوزن" },
  "gross weight": { en: "Gross Weight", ur: "مجموعی وزن", ar: "الوزن الإجمالي" },
  "tare weight": { en: "Tare Weight", ur: "خالی وزن", ar: "الوزن الفارغ" },
  "net weight": { en: "Net Weight", ur: "خالص وزن", ar: "الوزن الصافي" },
};

const WORDS: Record<string, { ur: string; ar: string }> = {
  invoice:{ur:"انوائس",ar:"فاتورة"}, sales:{ur:"سیلز",ar:"المبيعات"}, purchase:{ur:"خریداری",ar:"الشراء"}, order:{ur:"آرڈر",ar:"طلب"}, customer:{ur:"گاہک",ar:"العميل"}, supplier:{ur:"سپلائر",ar:"المورد"}, item:{ur:"آئٹم",ar:"الصنف"}, date:{ur:"تاریخ",ar:"التاريخ"}, number:{ur:"نمبر",ar:"الرقم"}, no:{ur:"نمبر",ar:"رقم"}, quantity:{ur:"مقدار",ar:"الكمية"}, qty:{ur:"مقدار",ar:"الكمية"}, rate:{ur:"ریٹ",ar:"السعر"}, price:{ur:"قیمت",ar:"السعر"}, amount:{ur:"رقم",ar:"المبلغ"}, total:{ur:"کل",ar:"الإجمالي"}, tax:{ur:"ٹیکس",ar:"الضريبة"}, vat:{ur:"وی اے ٹی",ar:"ضريبة القيمة المضافة"}, discount:{ur:"رعایت",ar:"الخصم"}, charge:{ur:"چارج",ar:"رسم"}, charges:{ur:"چارجز",ar:"رسوم"}, debit:{ur:"ڈیبٹ",ar:"مدين"}, credit:{ur:"کریڈٹ",ar:"دائن"}, balance:{ur:"بیلنس",ar:"الرصيد"}, cash:{ur:"نقد",ar:"نقد"}, bank:{ur:"بینک",ar:"البنك"}, payment:{ur:"ادائیگی",ar:"الدفع"}, receipt:{ur:"وصولی",ar:"إيصال"}, reference:{ur:"حوالہ",ar:"المرجع"}, description:{ur:"تفصیل",ar:"الوصف"}, notes:{ur:"نوٹس",ar:"ملاحظات"}, remarks:{ur:"ریمارکس",ar:"ملاحظات"}, warehouse:{ur:"ویئرہاؤس",ar:"المستودع"}, godown:{ur:"گودام",ar:"المخزن"}, branch:{ur:"برانچ",ar:"الفرع"}, vehicle:{ur:"گاڑی",ar:"المركبة"}, driver:{ur:"ڈرائیور",ar:"السائق"}, weight:{ur:"وزن",ar:"الوزن"}, prepared:{ur:"تیار",ar:"أعد"}, checked:{ur:"جانچ",ar:"راجع"}, approved:{ur:"منظور",ar:"اعتمد"}, by:{ur:"کردہ",ar:"بواسطة"}, opening:{ur:"ابتدائی",ar:"افتتاحي"}, closing:{ur:"اختتامی",ar:"ختامي"}, grand:{ur:"مجموعی",ar:"العام"}, net:{ur:"خالص",ar:"الصافي"}, gross:{ur:"مجموعی",ar:"الإجمالي"}, tare:{ur:"خالی",ar:"الفارغ"},
};

const RTL = /[\u0600-\u06FF]/;
const LATIN = /[A-Za-z]/;

export function normalizeDocumentLanguages(mode: string | null | undefined, primary: string | null | undefined, secondary: string | null | undefined) {
  const safePrimary: DocumentLanguage = primary === "ur" || primary === "ar" ? primary : "en";
  if (mode !== "bilingual") return { mode: "single" as DocumentLanguageMode, primary: safePrimary, secondary: null as DocumentLanguage | null };
  const requestedSecondary: DocumentLanguage | null = secondary === "ur" || secondary === "ar" || secondary === "en" ? secondary : null;
  if (!requestedSecondary || requestedSecondary === safePrimary) return { mode: "single" as DocumentLanguageMode, primary: safePrimary, secondary: null as DocumentLanguage | null };
  const pair = new Set([safePrimary, requestedSecondary]);
  if (!pair.has("en") || (!pair.has("ur") && !pair.has("ar"))) return { mode: "single" as DocumentLanguageMode, primary: safePrimary, secondary: null as DocumentLanguage | null };
  return { mode: "bilingual" as DocumentLanguageMode, primary: safePrimary, secondary: requestedSecondary };
}

function normalize(value: string) { return value.trim().replace(/\s+/g, " ").replace(/[:：]\s*$/, "").toLowerCase(); }

function englishSource(value: string) {
  const parts = value.split(/\s*\/\s*|\s*\|\s*|\n+/).map((part) => part.trim()).filter(Boolean);
  return parts.find((part) => LATIN.test(part) && !RTL.test(part)) || value.trim();
}

function translateEnglish(value: string, language: DocumentLanguage) {
  if (language === "en") return value.trim();
  const key = normalize(value);
  const exact = CATALOG[key];
  if (exact) return exact[language];
  return value.replace(/[A-Za-z]+/g, (token) => WORDS[token.toLowerCase()]?.[language] || token);
}

export function isKnownDocumentLabel(value: string) {
  return Boolean(CATALOG[normalize(englishSource(value))]);
}

export function renderDocumentLabel(value: string, mode: string | null | undefined, primary: string | null | undefined, secondary: string | null | undefined) {
  const source = englishSource(value);
  const language = normalizeDocumentLanguages(mode, primary, secondary);
  const selected: DocumentLanguage[] = language.mode === "bilingual" && language.secondary ? [language.primary, language.secondary] : [language.primary];
  return selected.map((code) => translateEnglish(source, code)).filter((part, index, all) => part && all.indexOf(part) === index).join(" / ");
}
