const WORDS: Record<string, string> = {
  ali: "علی", ahmed: "احمد", ahmad: "احمد", muhammad: "محمد", mohammad: "محمد", mohammed: "محمد", farhan: "فرحان", khan: "خان",
  sons: "سنز", brothers: "برادرز", ms: "ایم ایس", ss: "ایس ایس", gi: "جی آئی",
  steel: "اسٹیل", steels: "اسٹیلز", iron: "آئرن", metal: "میٹل", metals: "میٹلز", mill: "مل", mills: "ملز",
  trader: "ٹریڈر", traders: "ٹریڈرز", trading: "ٹریڈنگ", industry: "انڈسٹری", industries: "انڈسٹریز", company: "کمپنی",
  enterprise: "انٹرپرائز", enterprises: "انٹرپرائزز", private: "پرائیویٹ", limited: "لمیٹڈ", ltd: "لمیٹڈ",
  sheet: "شیٹ", sheets: "شیٹس", pipe: "پائپ", pipes: "پائپس", coil: "کوائل", coils: "کوائلز", bar: "بار", bars: "بارز",
  rod: "راڈ", rods: "راڈز", scrap: "اسکریپ", plate: "پلیٹ", plates: "پلیٹس", angle: "اینگل", angles: "اینگلز", channel: "چینل", channels: "چینلز",
  customer: "گاہک", customers: "گاہک", supplier: "سپلائر", suppliers: "سپلائرز", transport: "ٹرانسپورٹ", transporter: "ٹرانسپورٹر",
  loading: "لوڈنگ", unloading: "ان لوڈنگ", cutting: "کٹنگ", labour: "مزدوری", labor: "مزدوری", handling: "ہینڈلنگ", freight: "مال برداری",
  charge: "چارج", charges: "چارجز", warehouse: "گودام", warehouses: "گودام", godown: "گودام", godowns: "گودام",
  kilogram: "کلوگرام", kilograms: "کلوگرام", kg: "کلوگرام", ton: "ٹن", tons: "ٹن", tonne: "ٹن", tonnes: "ٹن", piece: "عدد", pieces: "عدد", pcs: "عدد",
  serya: "سریا", rebar: "سریا", garder: "گارڈر", girder: "گارڈر", beam: "بیم", main: "مرکزی", branch: "برانچ", lahore: "لاہور",
  grade: "گریڈ", mm: "ایم ایم", cm: "سینٹی میٹر", ft: "فٹ", feet: "فٹ", foot: "فٹ", inch: "انچ", inches: "انچ", meter: "میٹر", meters: "میٹر", metre: "میٹر", metres: "میٹر",
  production: "پیداوار", accounts: "اکاؤنٹس", account: "اکاؤنٹ", operator: "آپریٹر", manager: "منیجر", sales: "فروخت", sale: "فروخت", purchase: "خریداری",
  store: "اسٹور", office: "دفتر", address: "پتہ", location: "مقام", department: "شعبہ", designation: "عہدہ",
  head: "مرکزی", raw: "خام", material: "مال", materials: "مال", finished: "تیار", goods: "مال", service: "سروس", services: "سروسز",
};

const PHRASES: Record<string, string> = {
  "main warehouse": "مرکزی گودام",
  "main godown": "مرکزی گودام",
  "main store": "مرکزی اسٹور",
  "head office": "مرکزی دفتر",
  "sales department": "شعبہ فروخت",
  "purchase department": "شعبہ خریداری",
  "production department": "شعبہ پیداوار",
  "raw material": "خام مال",
  "raw materials": "خام مال",
  "finished goods": "تیار مال",
};

const REPLACEMENTS: Array<[string, string]> = [
  ["sh", "ش"], ["ch", "چ"], ["kh", "خ"], ["gh", "غ"], ["ph", "ف"], ["th", "تھ"], ["dh", "دھ"], ["zh", "ژ"],
  ["aa", "ا"], ["ee", "ی"], ["oo", "و"], ["ou", "اؤ"], ["ai", "ائی"], ["ay", "ے"],
  ["a", "ا"], ["b", "ب"], ["c", "ک"], ["d", "د"], ["e", "ے"], ["f", "ف"], ["g", "گ"], ["h", "ہ"], ["i", "ی"],
  ["j", "ج"], ["k", "ک"], ["l", "ل"], ["m", "م"], ["n", "ن"], ["o", "و"], ["p", "پ"], ["q", "ق"], ["r", "ر"],
  ["s", "س"], ["t", "ت"], ["u", "و"], ["v", "و"], ["w", "و"], ["x", "کس"], ["y", "ی"], ["z", "ز"],
];

function normalize(value: string) {
  return value.toLowerCase().replace(/([0-9])([a-z])/g, "$1 $2").replace(/([a-z])([0-9])/g, "$1 $2").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function transliterateUnknownWord(word: string) {
  let out = word;
  for (const [latin, urdu] of REPLACEMENTS) out = out.split(latin).join(urdu);
  return out;
}

/**
 * Central legacy English -> Urdu helper used by NAVILO Auto Urdu controls.
 * Separators such as '-', '_', '/', and repeated spaces are normalized first,
 * so business phrases (for example Main-Warehouse) resolve semantically.
 */
export function toUrduName(value: string): string {
  const input = value.trim();
  if (!input) return "";
  if (/[\u0600-\u06FF]/.test(input)) return input;

  const normalized = normalize(input);
  if (!normalized) return "";

  const exactPhrase = PHRASES[normalized];
  if (exactPhrase) return exactPhrase;

  return normalized.split(" ").filter(Boolean).map((word) => {
    if (WORDS[word]) return WORDS[word];
    if (/^\d+$/.test(word)) return word;
    return transliterateUnknownWord(word);
  }).join(" ");
}
