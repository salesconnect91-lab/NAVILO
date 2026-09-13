export type JurisdictionProfile = {
  code: string;
  name: string;
  currency: string;
  locale: string;
  taxLabel: string;
  inputTaxLabel: string;
  outputTaxLabel: string;
  taxRegisterLabel: string;
  authorityLabel: string;
  taxIdLabels: string[];
};

export const JURISDICTIONS: JurisdictionProfile[] = [
  { code:"PK", name:"Pakistan", currency:"PKR", locale:"en-PK", taxLabel:"Sales Tax", inputTaxLabel:"Input Sales Tax", outputTaxLabel:"Output Sales Tax", taxRegisterLabel:"Sales Tax Register", authorityLabel:"FBR", taxIdLabels:["NTN","STRN"] },
  { code:"IN", name:"India", currency:"INR", locale:"en-IN", taxLabel:"GST", inputTaxLabel:"Input GST", outputTaxLabel:"Output GST", taxRegisterLabel:"GST Register", authorityLabel:"GST / CBIC", taxIdLabels:["GSTIN","PAN"] },
  { code:"AE", name:"United Arab Emirates", currency:"AED", locale:"en-AE", taxLabel:"VAT", inputTaxLabel:"Input VAT", outputTaxLabel:"Output VAT", taxRegisterLabel:"VAT Register", authorityLabel:"FTA", taxIdLabels:["TRN"] },
  { code:"SA", name:"Saudi Arabia", currency:"SAR", locale:"en-SA", taxLabel:"VAT", inputTaxLabel:"Input VAT", outputTaxLabel:"Output VAT", taxRegisterLabel:"VAT Register", authorityLabel:"ZATCA", taxIdLabels:["VAT Registration Number"] },
  { code:"GB", name:"United Kingdom", currency:"GBP", locale:"en-GB", taxLabel:"VAT", inputTaxLabel:"Input VAT", outputTaxLabel:"Output VAT", taxRegisterLabel:"VAT Register", authorityLabel:"HMRC", taxIdLabels:["VAT Registration Number"] },
  { code:"US", name:"United States", currency:"USD", locale:"en-US", taxLabel:"Sales Tax", inputTaxLabel:"Recoverable Sales Tax", outputTaxLabel:"Sales Tax Collected", taxRegisterLabel:"Sales Tax Register", authorityLabel:"State / Local Tax Authority", taxIdLabels:["EIN","State Tax ID"] },
  { code:"CA", name:"Canada", currency:"CAD", locale:"en-CA", taxLabel:"GST/HST", inputTaxLabel:"Input Tax Credits", outputTaxLabel:"GST/HST Collected", taxRegisterLabel:"GST/HST Register", authorityLabel:"CRA", taxIdLabels:["Business Number"] },
  { code:"AU", name:"Australia", currency:"AUD", locale:"en-AU", taxLabel:"GST", inputTaxLabel:"GST Credits", outputTaxLabel:"GST Payable", taxRegisterLabel:"GST Register", authorityLabel:"ATO", taxIdLabels:["ABN"] },
  { code:"NZ", name:"New Zealand", currency:"NZD", locale:"en-NZ", taxLabel:"GST", inputTaxLabel:"Input GST", outputTaxLabel:"Output GST", taxRegisterLabel:"GST Register", authorityLabel:"IRD", taxIdLabels:["GST Number"] },
  { code:"DE", name:"Germany", currency:"EUR", locale:"de-DE", taxLabel:"VAT", inputTaxLabel:"Input VAT", outputTaxLabel:"Output VAT", taxRegisterLabel:"VAT Register", authorityLabel:"Tax Authority", taxIdLabels:["VAT ID"] },
  { code:"FR", name:"France", currency:"EUR", locale:"fr-FR", taxLabel:"VAT", inputTaxLabel:"Input VAT", outputTaxLabel:"Output VAT", taxRegisterLabel:"VAT Register", authorityLabel:"Tax Authority", taxIdLabels:["VAT Number"] },
];

const FALLBACK: JurisdictionProfile = { code:"XX", name:"Other / Global", currency:"USD", locale:"en-US", taxLabel:"Tax", inputTaxLabel:"Input Tax", outputTaxLabel:"Output Tax", taxRegisterLabel:"Tax Register", authorityLabel:"Tax Authority", taxIdLabels:["Tax Registration Number"] };

export function getJurisdictionProfile(code?: string | null) {
  return JURISDICTIONS.find((item)=>item.code===String(code||"").toUpperCase()) || FALLBACK;
}
