export function sourceEnglish(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const parts = normalized.split(/\s+\/\s+/).map(part => part.trim()).filter(Boolean);
  return parts.find(part => /[A-Za-z]/.test(part) && !/[\u0600-\u06FF]/.test(part)) || normalized;
}
