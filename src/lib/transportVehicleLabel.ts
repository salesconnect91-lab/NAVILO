/** Presentation only. Never persist a decorated plate in the vehicle identity or trip filters. */
export function vehicleDisplayLabel(plate: string | null | undefined, truckType?: string | null): string {
  const number = String(plate ?? '').trim();
  const type = String(truckType ?? '').trim();
  if (!number) return '';
  if (!type || type === '—') return number;
  // Preserve already-decorated labels when called by report/selection renderers.
  if (number.toLocaleLowerCase().endsWith(' · '+type.toLocaleLowerCase())) return number;
  return number+' · '+type;
}
