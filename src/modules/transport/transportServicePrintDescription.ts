import {recordDisplayText} from '@/lib/recordDisplayText';

/** Keep linked trip invoices readable in print while retaining the trip reference. */
export function transportServicePrintDescription(description: string, sourceModule?: string) {
  const text = recordDisplayText(description);
  if (sourceModule !== 'transport') return text;

  const match = text.match(/^Transport service\s*·\s*([^·]+)\s*·\s*([^·]+)\s*·\s*([^·]+)(?:\s*·|$)/);
  if (!match) return text;

  const [, tripNo, date, route] = match;
  return `Trip ${tripNo.trim()} · ${date.trim()} · ${route.trim()}`;
}
