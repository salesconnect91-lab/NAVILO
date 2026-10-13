/** Display normal document labels while preserving immutable accounting evidence. */
export function recordDisplayText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\bHistorical Register\b/gi, 'Register')
    .replace(/\bHistorical Trip\b/gi, 'Trip')
    .replace(/\bHistorical supplier rent\b/gi, 'Supplier rent')
    .replace(/\bHistorical settled balance transfer\b/gi, 'Settled balance transfer')
    .replace(/\bHistorical opening conversion\b/gi, 'Opening balance transfer')
    .replace(/\bHistorically settled\b/gi, 'Previously settled')
    .replace(/\bHistorical settled\b/gi, 'Previously settled')
    .replace(/transport_historical_clearing/g, 'Balance transfer')
    .replace(/historical_register/g, 'Register');
}
