import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { isSupportedRuntimeLanguage, languageByCode, type LanguageMode } from "@/lib/languageConfig";

type RuntimeLanguage = {
  mode: LanguageMode;
  primary: string;
  secondary: string | null;
  documentMode: LanguageMode;
  documentPrimary: string;
  documentSecondary: string | null;
};

type Translation = { ur?: string; ar?: string };
type UiLanguage = "en" | "ur" | "ar";

const ENGLISH_ONLY: RuntimeLanguage = {
  mode: "single",
  primary: "en",
  secondary: null,
  documentMode: "single",
  documentPrimary: "en",
  documentSecondary: null,
};

const phrase = (en: string, ur: string, ar: string): [string, Translation] => [en, { ur, ar }];

const UI_TRANSLATIONS = Object.fromEntries([
  phrase("Dashboard", "ڈیش بورڈ", "لوحة التحكم"),
  phrase("Business Overview", "کاروباری خلاصہ", "نظرة عامة على الأعمال"),
  phrase("Master Data", "ماسٹر ڈیٹا", "البيانات الأساسية"),
  phrase("Items", "آئٹمز", "الأصناف"),
  phrase("Item", "آئٹم", "الصنف"),
  phrase("Categories", "کیٹیگریز", "الفئات"),
  phrase("Category", "کیٹیگری", "الفئة"),
  phrase("Customers", "گاہک", "العملاء"),
  phrase("Customer", "گاہک", "العميل"),
  phrase("Suppliers", "سپلائرز", "الموردون"),
  phrase("Supplier", "سپلائر", "المورد"),
  phrase("Employees", "ملازمین", "الموظفون"),
  phrase("Employee", "ملازم", "الموظف"),
  phrase("Warehouses", "ویئرہاؤسز", "المستودعات"),
  phrase("Warehouse", "ویئرہاؤس", "المستودع"),
  phrase("Godowns", "گودام", "المخازن"),
  phrase("Godown", "گودام", "المخزن"),
  phrase("Units of Measure", "پیمائشی اکائیاں", "وحدات القياس"),
  phrase("Unit of Measure", "پیمائشی اکائی", "وحدة القياس"),
  phrase("Transporters", "ٹرانسپورٹرز", "الناقلون"),
  phrase("Transporter", "ٹرانسپورٹر", "الناقل"),
  phrase("Charge Master", "چارج ماسٹر", "دليل الرسوم"),
  phrase("Sales", "سیلز", "المبيعات"),
  phrase("Sales Invoices", "سیلز انوائسز", "فواتير المبيعات"),
  phrase("Sales Invoice", "سیلز انوائس", "فاتورة المبيعات"),
  phrase("New Sales Invoice", "نئی سیلز انوائس", "فاتورة مبيعات جديدة"),
  phrase("Sales Order Book", "سیلز آرڈر بک", "سجل أوامر المبيعات"),
  phrase("Consolidated Invoices", "مشترکہ انوائسز", "الفواتير المجمعة"),
  phrase("Purchase", "خریداری", "المشتريات"),
  phrase("Purchases", "خریداریاں", "المشتريات"),
  phrase("Purchase Invoices", "خریداری انوائسز", "فواتير المشتريات"),
  phrase("Purchase Invoice", "خریداری انوائس", "فاتورة المشتريات"),
  phrase("New Purchase", "نئی خریداری", "عملية شراء جديدة"),
  phrase("Consolidated Purchase", "مشترکہ خریداری", "المشتريات المجمعة"),
  phrase("Purchase Order Book", "پرچیز آرڈر بک", "سجل أوامر الشراء"),
  phrase("Inventory", "اسٹاک", "المخزون"),
  phrase("Inventory / Stock", "اسٹاک", "المخزون"),
  phrase("Current Stock", "موجودہ اسٹاک", "المخزون الحالي"),
  phrase("Stock Movements", "اسٹاک موومنٹس", "حركات المخزون"),
  phrase("Stock Movement", "اسٹاک موومنٹ", "حركة المخزون"),
  phrase("Production", "پیداوار", "الإنتاج"),
  phrase("Production / Furnace & Mill", "پیداوار / فرنس و مل", "الإنتاج / الفرن والدرفلة"),
  phrase("Work Orders", "ورک آرڈرز", "أوامر العمل"),
  phrase("Work Order", "ورک آرڈر", "أمر العمل"),
  phrase("Furnace Yield", "فرنس پیداوار", "إنتاجية الفرن"),
  phrase("Cutting & Loading", "کٹنگ و لوڈنگ", "القطع والتحميل"),
  phrase("Cutting Orders", "کٹنگ آرڈرز", "أوامر القطع"),
  phrase("Cutting Order", "کٹنگ آرڈر", "أمر القطع"),
  phrase("Gate Pass & Weighbridge", "گیٹ پاس و وزن کانٹا", "تصريح البوابة والميزان"),
  phrase("Gate Pass", "گیٹ پاس", "تصريح البوابة"),
  phrase("Accounting", "اکاؤنٹنگ", "المحاسبة"),
  phrase("Transactions", "لین دین", "المعاملات"),
  phrase("Journal Entries", "جرنل اندراجات", "قيود اليومية"),
  phrase("Journal Entry", "جرنل اندراج", "قيد اليومية"),
  phrase("Cash Counter", "کیش کاؤنٹر", "الصندوق النقدي"),
  phrase("Payment Reversals", "ادائیگی واپسی", "عكس المدفوعات"),
  phrase("Credit / Debit Notes", "کریڈٹ / ڈیبٹ نوٹس", "إشعارات الدائن / المدين"),
  phrase("Return Notes", "ریٹرن نوٹس", "إشعارات المرتجعات"),
  phrase("Return Note", "ریٹرن نوٹ", "إشعار مرتجع"),
  phrase("Books & Registers", "بکس و رجسٹر", "الدفاتر والسجلات"),
  phrase("VAT Register", "وی اے ٹی رجسٹر", "سجل ضريبة القيمة المضافة"),
  phrase("Day Book", "روزنامچہ", "دفتر اليومية"),
  phrase("General Ledgers", "جنرل لیجر", "دفاتر الأستاذ العام"),
  phrase("General Ledger", "جنرل لیجر", "دفتر الأستاذ العام"),
  phrase("Bank Reconciliation", "بینک ریکنسیلی ایشن", "تسوية البنك"),
  phrase("Financial Statements", "مالی بیانات", "القوائم المالية"),
  phrase("Trial Balance", "ٹرائل بیلنس", "ميزان المراجعة"),
  phrase("Profit & Loss", "نفع و نقصان", "الأرباح والخسائر"),
  phrase("Balance Sheet", "بیلنس شیٹ", "الميزانية العمومية"),
  phrase("Cash Flow", "کیش فلو", "التدفق النقدي"),
  phrase("Controls & Closing", "کنٹرول و کلوزنگ", "الضوابط والإقفال"),
  phrase("Period Closing", "پیریڈ کلوزنگ", "إقفال الفترة"),
  phrase("Year Closing", "سالانہ اختتام", "الإقفال السنوي"),
  phrase("Financial Controls", "مالی کنٹرولز", "الضوابط المالية"),
  phrase("Audit Trail", "آڈٹ ٹریل", "سجل التدقيق"),
  phrase("Accounting Setup", "اکاؤنٹنگ سیٹ اپ", "إعداد المحاسبة"),
  phrase("Chart of Accounts", "چارٹ آف اکاؤنٹس", "دليل الحسابات"),
  phrase("Account Mapping", "اکاؤنٹ میپنگ", "ربط الحسابات"),
  phrase("Reports", "رپورٹس", "التقارير"),
  phrase("Sales & Customer", "سیلز و گاہک", "المبيعات والعملاء"),
  phrase("Sales & Margin", "سیلز و مارجن", "المبيعات والهامش"),
  phrase("Sales Register", "سیلز رجسٹر", "سجل المبيعات"),
  phrase("Customer Aging", "گاہک ایجنگ", "أعمار ديون العملاء"),
  phrase("Customer Item History", "گاہک آئٹم ہسٹری", "سجل أصناف العميل"),
  phrase("Salesperson Performance", "سیلز پرسن کارکردگی", "أداء مندوب المبيعات"),
  phrase("Customer Statement", "گاہک اسٹیٹمنٹ", "كشف حساب العميل"),
  phrase("Purchase & Supplier", "خریداری و سپلائر", "المشتريات والموردون"),
  phrase("Purchase Register", "پرچیز رجسٹر", "سجل المشتريات"),
  phrase("Supplier Aging", "سپلائر ایجنگ", "أعمار ديون الموردين"),
  phrase("Supplier Item History", "سپلائر آئٹم ہسٹری", "سجل أصناف المورد"),
  phrase("Inventory Reports", "اسٹاک رپورٹس", "تقارير المخزون"),
  phrase("Stock Valuation", "اسٹاک ویلیو", "تقييم المخزون"),
  phrase("Stock Aging", "اسٹاک ایجنگ", "أعمار المخزون"),
  phrase("Steel Stock Control", "اسٹیل اسٹاک کنٹرول", "التحكم في مخزون الحديد"),
  phrase("Customer Profitability", "گاہک منافع", "ربحية العملاء"),
  phrase("Item Profitability", "آئٹم منافع", "ربحية الأصناف"),
  phrase("Salesperson Profitability", "سیلز پرسن منافع", "ربحية مندوب المبيعات"),
  phrase("Customer Collection Performance", "گاہک وصولی کارکردگی", "أداء تحصيل العملاء"),
  phrase("Supplier Performance", "سپلائر کارکردگی", "أداء الموردين"),
  phrase("Purchase Price Variance", "پرچیز ریٹ فرق", "انحراف سعر الشراء"),
  phrase("Inventory Aging / Slow Moving", "اسٹاک ایجنگ / سست رفتار", "أعمار المخزون / بطيء الحركة"),
  phrase("Inventory Turnover", "اسٹاک ٹرن اوور", "دوران المخزون"),
  phrase("Stock Exceptions", "اسٹاک مسائل", "استثناءات المخزون"),
  phrase("Business Unit Performance", "بزنس یونٹ کارکردگی", "أداء وحدة الأعمال"),
  phrase("Monthly Business Performance / MIS", "ماہانہ کاروباری کارکردگی / MIS", "الأداء الشهري للأعمال / MIS"),
  phrase("Control & Reconciliation", "کنٹرول و ریکنسیلی ایشن", "الرقابة والتسويات"),
  phrase("Returns Register", "ریٹرنز رجسٹر", "سجل المرتجعات"),
  phrase("AR / AP Reconciliation", "اے آر / اے پی ریکنسیلی ایشن", "تسوية العملاء / الموردين"),
  phrase("Exceptions", "ایکسیپشنز", "الاستثناءات"),
  phrase("Service Charges", "سروس چارجز", "رسوم الخدمات"),
  phrase("Operations", "آپریشنز", "العمليات"),
  phrase("Gate Pass Report", "گیٹ پاس رپورٹ", "تقرير تصريح البوابة"),
  phrase("Owner Control", "مالک کنٹرول", "تحكم المالك"),
  phrase("Settings", "سیٹنگز", "الإعدادات"),
  phrase("Company", "کمپنی", "الشركة"),
  phrase("Company Settings", "کمپنی سیٹنگز", "إعدادات الشركة"),
  phrase("Tax Settings", "ٹیکس سیٹنگز", "إعدادات الضريبة"),
  phrase("Document & Print", "ڈاکومنٹ و پرنٹ", "المستندات والطباعة"),
  phrase("Document & Print Settings", "ڈاکومنٹ و پرنٹ سیٹنگز", "إعدادات المستندات والطباعة"),
  phrase("Order Book Settings", "آرڈر بک سیٹنگز", "إعدادات سجل الطلبات"),
  phrase("Language Settings", "زبان کی سیٹنگز", "إعدادات اللغة"),
  phrase("Screen Language", "اسکرین زبان", "لغة الشاشة"),
  phrase("Document Language", "دستاویز کی زبان", "لغة المستند"),
  phrase("Single Language", "ایک زبان", "لغة واحدة"),
  phrase("Bilingual", "دو زبانیں", "ثنائي اللغة"),
  phrase("Primary Language", "بنیادی زبان", "اللغة الأساسية"),
  phrase("Secondary Language", "ثانوی زبان", "اللغة الثانوية"),
  phrase("English", "انگریزی", "الإنجليزية"),
  phrase("Urdu", "اردو", "الأردية"),
  phrase("Arabic", "عربی", "العربية"),
  phrase("Back", "واپس", "رجوع"),
  phrase("Sign out", "لاگ آؤٹ", "تسجيل الخروج"),
  phrase("Active Company", "فعال کمپنی", "الشركة النشطة"),
  phrase("Refresh", "تازہ کریں", "تحديث"),
  phrase("Reset", "ری سیٹ", "إعادة ضبط"),
  phrase("Search", "تلاش", "بحث"),
  phrase("Save", "محفوظ کریں", "حفظ"),
  phrase("Save Settings", "سیٹنگز محفوظ کریں", "حفظ الإعدادات"),
  phrase("Loading…", "لوڈ ہو رہا ہے…", "جارٍ التحميل…"),
  phrase("Loading...", "لوڈ ہو رہا ہے...", "جارٍ التحميل..."),
  phrase("Saving...", "محفوظ ہو رہا ہے...", "جارٍ الحفظ..."),
  phrase("No data found", "کوئی ڈیٹا نہیں ملا", "لم يتم العثور على بيانات"),
  phrase("No records found", "کوئی ریکارڈ نہیں ملا", "لم يتم العثور على سجلات"),
  phrase("No result found", "کوئی نتیجہ نہیں ملا", "لم يتم العثور على نتيجة"),
  phrase("Are you sure?", "کیا آپ کو یقین ہے؟", "هل أنت متأكد؟"),
  phrase("Add", "شامل کریں", "إضافة"),
  phrase("Edit", "ترمیم", "تعديل"),
  phrase("Delete", "حذف کریں", "حذف"),
  phrase("Cancel", "منسوخ", "إلغاء"),
  phrase("Close", "بند کریں", "إغلاق"),
  phrase("Create", "بنائیں", "إنشاء"),
  phrase("Update", "اپ ڈیٹ", "تحديث"),
  phrase("Apply", "لاگو کریں", "تطبيق"),
  phrase("Clear", "صاف کریں", "مسح"),
  phrase("Export", "ایکسپورٹ", "تصدير"),
  phrase("Print", "پرنٹ", "طباعة"),
  phrase("Print Preview", "پرنٹ پیش نظارہ", "معاينة الطباعة"),
  phrase("New", "نیا", "جديد"),
  phrase("View", "دیکھیں", "عرض"),
  phrase("Details", "تفصیلات", "التفاصيل"),
  phrase("Actions", "کارروائیاں", "الإجراءات"),
  phrase("Status", "حالت", "الحالة"),
  phrase("Draft", "مسودہ", "مسودة"),
  phrase("Posted", "پوسٹ شدہ", "مرحّل"),
  phrase("Pending", "زیر التوا", "قيد الانتظار"),
  phrase("Approved", "منظور شدہ", "معتمد"),
  phrase("Rejected", "مسترد", "مرفوض"),
  phrase("Completed", "مکمل", "مكتمل"),
  phrase("Closed", "بند", "مغلق"),
  phrase("Active", "فعال", "نشط"),
  phrase("Inactive", "غیر فعال", "غير نشط"),
  phrase("Date", "تاریخ", "التاريخ"),
  phrase("From Date", "تاریخ سے", "من تاريخ"),
  phrase("To Date", "تاریخ تک", "إلى تاريخ"),
  phrase("Reference", "حوالہ", "المرجع"),
  phrase("Description", "تفصیل", "الوصف"),
  phrase("Notes", "نوٹس", "ملاحظات"),
  phrase("Amount", "رقم", "المبلغ"),
  phrase("Total", "کل", "الإجمالي"),
  phrase("Grand Total", "مجموعی کل", "الإجمالي العام"),
  phrase("Subtotal", "ذیلی کل", "المجموع الفرعي"),
  phrase("Tax", "ٹیکس", "الضريبة"),
  phrase("VAT", "وی اے ٹی", "ضريبة القيمة المضافة"),
  phrase("Discount", "رعایت", "الخصم"),
  phrase("Charges", "چارجز", "الرسوم"),
  phrase("Quantity", "مقدار", "الكمية"),
  phrase("Qty", "مقدار", "الكمية"),
  phrase("Rate", "ریٹ", "السعر"),
  phrase("Price", "قیمت", "السعر"),
  phrase("Cost", "لاگت", "التكلفة"),
  phrase("Unit", "اکائی", "الوحدة"),
  phrase("Name", "نام", "الاسم"),
  phrase("Code", "کوڈ", "الرمز"),
  phrase("Grade", "گریڈ", "الدرجة"),
  phrase("Size", "سائز", "المقاس"),
  phrase("Weight", "وزن", "الوزن"),
  phrase("Vehicle", "گاڑی", "المركبة"),
  phrase("Vehicle No", "گاڑی نمبر", "رقم المركبة"),
  phrase("Driver", "ڈرائیور", "السائق"),
  phrase("Salesperson", "سیلز پرسن", "مندوب المبيعات"),
  phrase("Payment", "ادائیگی", "الدفع"),
  phrase("Receipt", "وصولی", "الإيصال"),
  phrase("Payment Method", "ادائیگی کا طریقہ", "طريقة الدفع"),
  phrase("Cash", "نقد", "نقد"),
  phrase("Bank", "بینک", "البنك"),
  phrase("Credit", "کریڈٹ", "دائن"),
  phrase("Debit", "ڈیبٹ", "مدين"),
  phrase("Balance", "بیلنس", "الرصيد"),
  phrase("Opening Balance", "ابتدائی بیلنس", "الرصيد الافتتاحي"),
  phrase("Closing Balance", "اختتامی بیلنس", "الرصيد الختامي"),
  phrase("Outstanding", "بقایا", "المستحق"),
  phrase("Due Date", "واجب الادا تاریخ", "تاريخ الاستحقاق"),
  phrase("Invoice", "انوائس", "الفاتورة"),
  phrase("Invoice No", "انوائس نمبر", "رقم الفاتورة"),
  phrase("Order No", "آرڈر نمبر", "رقم الطلب"),
  phrase("Purchase Order", "پرچیز آرڈر", "أمر الشراء"),
  phrase("Account", "اکاؤنٹ", "الحساب"),
  phrase("Accounts", "اکاؤنٹس", "الحسابات"),
  phrase("Debit Balance", "ڈیبٹ بیلنس", "الرصيد المدين"),
  phrase("Credit Balance", "کریڈٹ بیلنس", "الرصيد الدائن"),
  phrase("Phone", "فون", "الهاتف"),
  phrase("Email", "ای میل", "البريد الإلكتروني"),
  phrase("Address", "پتہ", "العنوان"),
  phrase("Location", "مقام", "الموقع"),
  phrase("Branch", "برانچ", "الفرع"),
  phrase("Business Unit", "بزنس یونٹ", "وحدة الأعمال"),
  phrase("Search results", "تلاش کے نتائج", "نتائج البحث"),
  phrase("Show", "دکھائیں", "إظهار"),
  phrase("Hide", "چھپائیں", "إخفاء"),
  phrase("Show All", "سب دکھائیں", "إظهار الكل"),
  phrase("Customize", "ترتیب", "تخصيص"),
  phrase("Filters", "فلٹرز", "عوامل التصفية"),
  phrase("Filter", "فلٹر", "تصفية"),
  phrase("All", "سب", "الكل"),
  phrase("Yes", "ہاں", "نعم"),
  phrase("No", "نہیں", "لا"),
  phrase("Required", "ضروری", "مطلوب"),
  phrase("Optional", "اختیاری", "اختياري"),
  phrase("Page Size", "صفحہ سائز", "حجم الصفحة"),
  phrase("Orientation", "سمت", "الاتجاه"),
  phrase("Portrait", "عمودی", "عمودي"),
  phrase("Landscape", "افقی", "أفقي"),
  phrase("Logo", "لوگو", "الشعار"),
  phrase("Header", "ہیڈر", "الرأس"),
  phrase("Footer", "فوٹر", "التذييل"),
  phrase("Signature", "دستخط", "التوقيع"),
  phrase("Prepared By", "تیار کردہ", "أعده"),
  phrase("Checked By", "جانچ کردہ", "راجعه"),
  phrase("Approved By", "منظور کردہ", "اعتمده"),
]) as Record<string, Translation>;

const word = (en: string, ur: string, ar: string): [string, Translation] => [en, { ur, ar }];

const WORD_TRANSLATIONS = Object.fromEntries([
  word("add","شامل","إضافة"), word("edit","ترمیم","تعديل"), word("delete","حذف","حذف"), word("remove","ہٹائیں","إزالة"), word("save","محفوظ","حفظ"), word("cancel","منسوخ","إلغاء"), word("close","بند","إغلاق"), word("open","کھولیں","فتح"), word("create","بنائیں","إنشاء"), word("update","اپ ڈیٹ","تحديث"), word("apply","لاگو","تطبيق"), word("clear","صاف","مسح"), word("reset","ری سیٹ","إعادة ضبط"), word("refresh","تازہ کریں","تحديث"), word("search","تلاش","بحث"), word("select","منتخب","اختيار"), word("choose","منتخب کریں","اختيار"), word("view","دیکھیں","عرض"), word("details","تفصیلات","التفاصيل"), word("print","پرنٹ","طباعة"), word("preview","پیش نظارہ","معاينة"), word("export","ایکسپورٹ","تصدير"), word("download","ڈاؤن لوڈ","تنزيل"), word("upload","اپ لوڈ","رفع"), word("import","امپورٹ","استيراد"), word("duplicate","نقل","تكرار"), word("copy","کاپی","نسخ"), word("confirm","تصدیق","تأكيد"), word("approve","منظور","اعتماد"), word("post","پوسٹ","ترحيل"), word("reverse","واپس","عكس"), word("continue","جاری","متابعة"), word("submit","جمع","إرسال"),
  word("new","نیا","جديد"), word("all","سب","الكل"), word("active","فعال","نشط"), word("inactive","غیر فعال","غير نشط"), word("draft","مسودہ","مسودة"), word("posted","پوسٹ شدہ","مرحّل"), word("pending","زیر التوا","قيد الانتظار"), word("completed","مکمل","مكتمل"), word("closed","بند","مغلق"), word("cancelled","منسوخ","ملغى"), word("approved","منظور شدہ","معتمد"), word("rejected","مسترد","مرفوض"), word("status","حالت","الحالة"), word("type","قسم","النوع"), word("mode","موڈ","الوضع"), word("required","ضروری","مطلوب"), word("optional","اختیاری","اختياري"),
  word("name","نام","الاسم"), word("code","کوڈ","الرمز"), word("number","نمبر","الرقم"), word("date","تاریخ","التاريخ"), word("time","وقت","الوقت"), word("from","سے","من"), word("to","تک","إلى"), word("reference","حوالہ","المرجع"), word("description","تفصیل","الوصف"), word("note","نوٹ","ملاحظة"), word("notes","نوٹس","ملاحظات"), word("reason","وجہ","السبب"), word("remarks","ریمارکس","ملاحظات"),
  word("item","آئٹم","الصنف"), word("items","آئٹمز","الأصناف"), word("customer","گاہک","العميل"), word("customers","گاہک","العملاء"), word("supplier","سپلائر","المورد"), word("suppliers","سپلائرز","الموردون"), word("employee","ملازم","الموظف"), word("employees","ملازمین","الموظفون"), word("warehouse","ویئرہاؤس","المستودع"), word("warehouses","ویئرہاؤسز","المستودعات"), word("godown","گودام","المخزن"), word("godowns","گودام","المخازن"), word("branch","برانچ","الفرع"), word("company","کمپنی","الشركة"), word("business","کاروبار","الأعمال"), word("unit","اکائی","الوحدة"), word("location","مقام","الموقع"), word("category","کیٹیگری","الفئة"), word("grade","گریڈ","الدرجة"), word("size","سائز","المقاس"),
  word("sales","سیلز","المبيعات"), word("sale","فروخت","بيع"), word("purchase","خریداری","الشراء"), word("purchases","خریداریاں","المشتريات"), word("invoice","انوائس","فاتورة"), word("invoices","انوائسز","فواتير"), word("order","آرڈر","طلب"), word("orders","آرڈرز","طلبات"), word("consolidated","مشترکہ","مجمعة"), word("return","واپسی","مرتجع"), word("returns","واپسیاں","مرتجعات"), word("charge","چارج","رسم"), word("charges","چارجز","رسوم"),
  word("stock","اسٹاک","المخزون"), word("inventory","اسٹاک","المخزون"), word("movement","موومنٹ","حركة"), word("movements","موومنٹس","حركات"), word("quantity","مقدار","الكمية"), word("qty","مقدار","الكمية"), word("rate","ریٹ","السعر"), word("price","قیمت","السعر"), word("cost","لاگت","التكلفة"), word("value","مالیت","القيمة"), word("weight","وزن","الوزن"), word("opening","ابتدائی","افتتاحي"), word("closing","اختتامی","ختامي"), word("current","موجودہ","الحالي"), word("available","دستیاب","متاح"), word("transfer","منتقلی","تحويل"), word("adjustment","ایڈجسٹمنٹ","تسوية"),
  word("production","پیداوار","الإنتاج"), word("furnace","فرنس","الفرن"), word("mill","مل","الدرفلة"), word("work","کام","عمل"), word("cutting","کٹنگ","القطع"), word("loading","لوڈنگ","التحميل"), word("unloading","ان لوڈنگ","التفريغ"), word("gate","گیٹ","البوابة"), word("pass","پاس","تصريح"), word("vehicle","گاڑی","المركبة"), word("driver","ڈرائیور","السائق"), word("tare","خالی وزن","الوزن الفارغ"), word("gross","مجموعی","الإجمالي"), word("net","خالص","الصافي"),
  word("accounting","اکاؤنٹنگ","المحاسبة"), word("account","اکاؤنٹ","الحساب"), word("accounts","اکاؤنٹس","الحسابات"), word("journal","جرنل","اليومية"), word("entry","اندراج","قيد"), word("entries","اندراجات","قيود"), word("ledger","لیجر","دفتر الأستاذ"), word("ledgers","لیجرز","دفاتر الأستاذ"), word("debit","ڈیبٹ","مدين"), word("credit","کریڈٹ","دائن"), word("cash","نقد","نقد"), word("bank","بینک","البنك"), word("payment","ادائیگی","الدفع"), word("payments","ادائیگیاں","المدفوعات"), word("receipt","وصولی","الإيصال"), word("receipts","وصولیاں","الإيصالات"), word("balance","بیلنس","الرصيد"), word("balances","بیلنس","الأرصدة"), word("amount","رقم","المبلغ"), word("total","کل","الإجمالي"), word("subtotal","ذیلی کل","المجموع الفرعي"), word("outstanding","بقایا","المستحق"), word("receivable","قابل وصول","مستحق القبض"), word("receivables","قابل وصول","الذمم المدينة"), word("payable","قابل ادائیگی","مستحق الدفع"), word("payables","قابل ادائیگی","الذمم الدائنة"), word("profit","منافع","الربح"), word("loss","نقصان","الخسارة"), word("margin","مارجن","الهامش"), word("revenue","آمدنی","الإيراد"), word("expense","خرچ","المصروف"), word("expenses","اخراجات","المصروفات"), word("tax","ٹیکس","الضريبة"), word("vat","وی اے ٹی","ضريبة القيمة المضافة"), word("discount","رعایت","الخصم"), word("mapping","میپنگ","الربط"), word("reconciliation","ریکَنسیلی ایشن","التسوية"), word("period","پیریڈ","الفترة"), word("year","سال","السنة"), word("audit","آڈٹ","التدقيق"), word("trail","ٹریل","السجل"),
  word("report","رپورٹ","تقرير"), word("reports","رپورٹس","التقارير"), word("summary","خلاصہ","ملخص"), word("performance","کارکردگی","الأداء"), word("aging","ایجنگ","الأعمار"), word("history","ہسٹری","السجل"), word("profitability","منافع","الربحية"), word("collection","وصولی","التحصيل"), word("turnover","ٹرن اوور","الدوران"), word("valuation","مالیت","التقييم"), word("exception","مسئلہ","استثناء"), word("exceptions","مسائل","الاستثناءات"), word("control","کنٹرول","الرقابة"), word("controls","کنٹرولز","الضوابط"), word("settings","سیٹنگز","الإعدادات"), word("setup","سیٹ اپ","الإعداد"), word("document","دستاویز","المستند"), word("documents","دستاویزات","المستندات"), word("language","زبان","اللغة"), word("screen","اسکرین","الشاشة"), word("primary","بنیادی","أساسية"), word("secondary","ثانوی","ثانوية"), word("single","ایک","واحدة"), word("bilingual","دو زبانیں","ثنائي اللغة"), word("logo","لوگو","الشعار"), word("header","ہیڈر","الرأس"), word("footer","فوٹر","التذييل"), word("page","صفحہ","الصفحة"), word("pages","صفحات","الصفحات"), word("orientation","سمت","الاتجاه"), word("portrait","عمودی","عمودي"), word("landscape","افقی","أفقي"), word("signature","دستخط","التوقيع"), word("signatures","دستخط","التوقيعات"),
  word("filter","فلٹر","تصفية"), word("filters","فلٹرز","عوامل التصفية"), word("show","دکھائیں","إظهار"), word("hide","چھپائیں","إخفاء"), word("selected","منتخب","محدد"), word("visible","ظاہر","ظاهر"), word("hidden","چھپا","مخفي"), word("column","کالم","عمود"), word("columns","کالمز","أعمدة"), word("row","قطار","صف"), word("rows","قطاریں","صفوف"), word("result","نتیجہ","نتيجة"), word("results","نتائج","نتائج"), word("found","ملا","موجود"), word("loading","لوڈنگ","تحميل"), word("saving","محفوظ","حفظ"), word("live","لائیو","مباشر"), word("data","ڈیٹا","بيانات"), word("information","معلومات","معلومات"), word("alert","الرٹ","تنبيه"), word("alerts","الرٹس","تنبيهات"), word("quick","فوری","سريع"), word("links","روابط","روابط"),
  word("phone","فون","الهاتف"), word("email","ای میل","البريد الإلكتروني"), word("address","پتہ","العنوان"), word("website","ویب سائٹ","الموقع الإلكتروني"), word("currency","کرنسی","العملة"), word("salesperson","سیلز پرسن","مندوب المبيعات"), word("method","طریقہ","الطريقة"), word("prepared","تیار","أعد"), word("checked","جانچ","راجع"), word("by","بذریعہ","بواسطة"), word("with","کے ساتھ","مع"), word("without","کے بغیر","بدون"), word("and","اور","و"), word("or","یا","أو"), word("only","صرف","فقط"), word("this","یہ","هذا"), word("month","مہینہ","الشهر"), word("months","مہینے","أشهر"), word("today","آج","اليوم"), word("previous","پچھلا","السابق"), word("next","اگلا","التالي"), word("first","پہلا","الأول"), word("last","آخری","الأخير"),
]) as Record<string, Translation>;

const PHRASE_REPLACEMENTS: Array<[string, Translation]> = [
  phrase("click to view details", "تفصیلات دیکھنے کے لیے کلک کریں", "انقر لعرض التفاصيل"),
  phrase("posted documents", "پوسٹ شدہ دستاویزات", "المستندات المرحلة"),
  phrase("current stock quantity", "موجودہ اسٹاک مقدار", "كمية المخزون الحالية"),
  phrase("stock items need attention", "اسٹاک آئٹمز توجہ چاہتے ہیں", "أصناف المخزون تحتاج إلى مراجعة"),
  phrase("work orders pending", "ورک آرڈرز زیر التوا", "أوامر العمل قيد الانتظار"),
  phrase("posted ledger balance", "پوسٹ شدہ لیجر بیلنس", "رصيد دفتر الأستاذ المرحّل"),
  phrase("mapped cash account", "میپ شدہ کیش اکاؤنٹ", "حساب النقد المرتبط"),
  phrase("mapped bank account", "میپ شدہ بینک اکاؤنٹ", "حساب البنك المرتبط"),
  phrase("auto refreshes every minute", "ہر منٹ خودکار تازہ ہوتا ہے", "يتم التحديث تلقائياً كل دقيقة"),
  phrase("no balances for this period", "اس مدت کے لیے کوئی بیلنس نہیں", "لا توجد أرصدة لهذه الفترة"),
  phrase("from date cannot be after to date", "شروع کی تاریخ اختتامی تاریخ کے بعد نہیں ہو سکتی", "لا يمكن أن يكون تاريخ البداية بعد تاريخ النهاية"),
  phrase("unable to load", "لوڈ نہیں ہو سکا", "تعذر التحميل"),
];

const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const TRANSLATABLE_ATTRIBUTES = ["placeholder", "title", "aria-label"] as const;
const GENERIC_UI_TAGS = new Set(["BUTTON", "LABEL", "H1", "H2", "H3", "H4", "H5", "H6", "TH", "OPTION", "LEGEND", "SUMMARY"]);
const UI_CLASS_HINT = /(btn|button|label|title|heading|menu|nav|tab|badge|pill|filter|toolbar|action|error|warning|alert|hint|help|subtitle)/i;

function sanitizePair(mode:LanguageMode,primary:string|null|undefined,secondary:string|null|undefined){
  const safePrimary=isSupportedRuntimeLanguage(primary)?primary:"en";
  const safeSecondary=isSupportedRuntimeLanguage(secondary)&&secondary!==safePrimary?secondary:null;
  return {mode:mode==="bilingual"&&safeSecondary?"bilingual" as LanguageMode:"single" as LanguageMode,primary:safePrimary,secondary:safeSecondary};
}

async function loadRuntimeLanguage(): Promise<RuntimeLanguage> {
  const [companyResult,userResult]=await Promise.all([
    supabase.from("company_settings").select("screen_language_mode,screen_primary_language,screen_secondary_language,document_language_mode,document_primary_language,document_secondary_language").maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if(companyResult.error)throw companyResult.error;
  const companyScreen=sanitizePair((companyResult.data?.screen_language_mode||"single") as LanguageMode,companyResult.data?.screen_primary_language,companyResult.data?.screen_secondary_language);
  const document=sanitizePair((companyResult.data?.document_language_mode||"single") as LanguageMode,companyResult.data?.document_primary_language,companyResult.data?.document_secondary_language);
  let screen=companyScreen;
  const user=userResult.data.user;
  if(user){
    const preference=await supabase.from("user_language_preferences").select("use_company_default,screen_language_mode,primary_language,secondary_language").eq("user_id",user.id).maybeSingle();
    if(!preference.error&&preference.data&&preference.data.use_company_default===false){
      screen=sanitizePair((preference.data.screen_language_mode||"single") as LanguageMode,preference.data.primary_language,preference.data.secondary_language);
    }
  }
  return {mode:screen.mode,primary:screen.primary,secondary:screen.secondary,documentMode:document.mode,documentPrimary:document.primary,documentSecondary:document.secondary};
}

function applyDocumentLanguage(language: RuntimeLanguage) {
  const primary = languageByCode(language.primary);
  document.documentElement.lang = language.primary || "en";
  document.documentElement.dir = language.mode === "single" && primary.direction === "rtl" ? "rtl" : "ltr";
  document.documentElement.dataset.languageMode = language.mode;
  document.documentElement.dataset.primaryLanguage = language.primary;
  if (language.secondary) document.documentElement.dataset.secondaryLanguage = language.secondary;
  else delete document.documentElement.dataset.secondaryLanguage;
  document.documentElement.dataset.documentLanguageMode = language.documentMode;
  document.documentElement.dataset.documentPrimaryLanguage = language.documentPrimary;
  if (language.documentSecondary) document.documentElement.dataset.documentSecondaryLanguage = language.documentSecondary;
  else delete document.documentElement.dataset.documentSecondaryLanguage;
}

function hasRtlScript(value: string) { return /[\u0600-\u06FF]/.test(value); }
function hasLatinLetters(value: string) { return /[A-Za-z]/.test(value); }
function normalizePhrase(value: string) { return value.trim().replace(/\s+/g, " "); }

function splitLegacyLabel(value: string) {
  const parts = value.trim().split("/").map((part) => normalizePhrase(part)).filter(Boolean);
  const english = parts.find((part) => hasLatinLetters(part) && !hasRtlScript(part)) || normalizePhrase(value);
  const urdu = parts.find((part) => hasRtlScript(part)) || null;
  return { english, urdu, isLegacyBilingual: parts.length > 1 && Boolean(urdu) };
}

function translateWords(value: string, languageCode: UiLanguage) {
  if (languageCode === "en" || !hasLatinLetters(value)) return value;
  let output = value;
  for (const [source, translation] of PHRASE_REPLACEMENTS) {
    const translated = translation[languageCode];
    if (!translated) continue;
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(escaped, "gi"), translated);
  }
  return output.replace(/[A-Za-z]+(?:'[A-Za-z]+)?/g, (token) => WORD_TRANSLATIONS[token.toLowerCase()]?.[languageCode] || token);
}

function translateExact(english: string, languageCode: UiLanguage, embeddedUrdu: string | null, allowGeneric: boolean) {
  if (languageCode === "en") return english;
  const exact = UI_TRANSLATIONS[normalizePhrase(english)]?.[languageCode];
  if (exact) return exact;
  if (languageCode === "ur" && embeddedUrdu) return embeddedUrdu;
  return allowGeneric ? translateWords(english, languageCode) : english;
}

function isGenericUiText(node: Text) {
  const parent = node.parentElement;
  if (!parent) return false;
  if (parent.closest("[data-i18n-skip='true']")) return false;
  if (parent.closest("input, textarea, script, style, code, pre")) return false;
  if (GENERIC_UI_TAGS.has(parent.tagName)) return true;
  if (parent.closest("button, label, nav, [role='button'], [role='menuitem'], [role='tab'], [role='alert'], [role='dialog'] h1, [role='dialog'] h2, [role='dialog'] h3")) return true;
  return UI_CLASS_HINT.test(parent.className || "");
}

function selectLanguageText(value: string, language: RuntimeLanguage, allowGeneric = false) {
  if (!value.trim()) return value;
  const leading = value.match(/^\s*/)?.[0] || "";
  const trailing = value.match(/\s*$/)?.[0] || "";
  const { english, urdu, isLegacyBilingual } = splitLegacyLabel(value);
  const known = Boolean(UI_TRANSLATIONS[normalizePhrase(english)]);
  if (!isLegacyBilingual && !known && !allowGeneric) return value;
  const requested = language.mode === "bilingual" && language.secondary ? [language.primary, language.secondary] : [language.primary];
  const supported = requested.filter((code): code is UiLanguage => code === "en" || code === "ur" || code === "ar");
  const safeRequested: UiLanguage[] = supported.length ? supported : ["en"];
  const rendered = safeRequested.map((code) => translateExact(english, code, urdu, allowGeneric || known || isLegacyBilingual)).filter((part, index, all) => part && all.indexOf(part) === index);
  return `${leading}${rendered.join(" / ")}${trailing}`;
}

function processTextNode(node: Text, language: RuntimeLanguage) {
  const current = node.nodeValue || "";
  if (!current.trim()) return;
  const previousSource = originalText.get(node);
  if (!previousSource) originalText.set(node, current);
  const source = originalText.get(node) || current;
  const expected = selectLanguageText(source, language, isGenericUiText(node));
  if (previousSource && current !== source && current !== expected) {
    originalText.set(node, current);
    const next = selectLanguageText(current, language, isGenericUiText(node));
    if (node.nodeValue !== next) node.nodeValue = next;
    return;
  }
  if (node.nodeValue !== expected) node.nodeValue = expected;
}

function processElementAttributes(element: Element, language: RuntimeLanguage) {
  if (element.closest("[data-i18n-skip='true']")) return;
  let originals = originalAttributes.get(element);
  if (!originals) { originals = new Map<string, string>(); originalAttributes.set(element, originals); }
  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    const current = element.getAttribute(attribute);
    if (!current) continue;
    const stored = originals.get(attribute);
    const expected = stored ? selectLanguageText(stored, language, true) : "";
    if (!stored || (current !== stored && current !== expected)) originals.set(attribute, current);
    const source = originals.get(attribute) || current;
    const next = selectLanguageText(source, language, true);
    if (current !== next) element.setAttribute(attribute, next);
  }
  if (language.mode === "single" && (language.primary === "ur" || language.primary === "ar")) {
    if (element.matches("button, label, h1, h2, h3, h4, h5, h6, th, option, [role='button'], [role='menuitem'], [role='tab']")) element.setAttribute("dir", "rtl");
  } else if (element.hasAttribute("dir") && element.matches("button, label, h1, h2, h3, h4, h5, h6, th, option, [role='button'], [role='menuitem'], [role='tab']")) {
    element.removeAttribute("dir");
  }
}

function translateTree(root: Node, language: RuntimeLanguage) {
  if (root.nodeType === Node.TEXT_NODE) { processTextNode(root as Text, language); return; }
  if (root.nodeType === Node.ELEMENT_NODE) processElementAttributes(root as Element, language);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === Node.TEXT_NODE) processTextNode(node as Text, language);
    else if (node.nodeType === Node.ELEMENT_NODE) processElementAttributes(node as Element, language);
  }
}

export default function LanguageRuntime() {
  useEffect(() => {
    let active = true;
    let language: RuntimeLanguage = ENGLISH_ONLY;
    let frame = 0;
    let applying = false;
    const apply = () => {
      if (!active) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        applying = true;
        applyDocumentLanguage(language);
        translateTree(document.body, language);
        queueMicrotask(() => { applying = false; });
      });
    };
    const refresh = async () => {
      try { language = await loadRuntimeLanguage(); }
      catch { language = ENGLISH_ONLY; }
      apply();
    };
    const observer = new MutationObserver((mutations) => {
      if (!active || applying) return;
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => { if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE) translateTree(node, language); });
        if (mutation.type === "characterData" && mutation.target.nodeType === Node.TEXT_NODE) processTextNode(mutation.target as Text, language);
        if (mutation.type === "attributes" && mutation.target.nodeType === Node.ELEMENT_NODE) processElementAttributes(mutation.target as Element, language);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    void refresh();
    const handleChange = () => void refresh();
    window.addEventListener("navilo-language-changed", handleChange);
    window.addEventListener("navilo-workspace-changed", handleChange);
    return () => {
      active = false;
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("navilo-language-changed", handleChange);
      window.removeEventListener("navilo-workspace-changed", handleChange);
    };
  }, []);
  return null;
}
