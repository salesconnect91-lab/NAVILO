// Dashboard labels are translated explicitly; never substitute Urdu for another locale.
// This dictionary is intentionally limited to verified English and Urdu UI strings.
export const DASHBOARD_URDU_LABELS: Readonly<Record<string, string>> = {
  "Customize": "اپنی مرضی کے مطابق بنائیں",
  "Show / Hide Dashboard": "ڈیش بورڈ دکھائیں / چھپائیں",
  "Close": "بند کریں",
  "Recommended": "تجویز کردہ",
  "Show All": "سب دکھائیں",
  "Period": "مدت",
  "Today": "آج",
  "This Week": "اس ہفتے",
  "This Month": "اس مہینے",
  "3M": "۳ ماہ",
  "6M": "۶ ماہ",
  "12M": "۱۲ ماہ",
  "This FY": "اس مالی سال",
  "Custom": "اپنی مرضی کی مدت",
  "to": "تا",
  "Account-wise breakdown": "اکاؤنٹ کے لحاظ سے تفصیل",
  "No mapped child accounts found.": "کوئی منسلک ذیلی اکاؤنٹ نہیں ملا۔",
} as const;

export function dashboardLabel(english: string, language: "en" | "ur", bilingual = false): string {
  if (language === "en") return english;
  const urdu = DASHBOARD_URDU_LABELS[english];
  if (!urdu) return english;
  return bilingual ? `${english} / ${urdu}` : urdu;
}
