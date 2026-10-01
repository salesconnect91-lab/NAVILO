export function sourceEnglish(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  // Slashes within one English label are content, not a bilingual separator.
  if (!/[\u0600-\u06FF]/.test(normalized)) return normalized;
  const parts = normalized.split(/\s+\/\s+/).map(part => part.trim()).filter(Boolean);
  return parts.find(part => /[A-Za-z]/.test(part) && !/[\u0600-\u06FF]/.test(part)) || normalized;
}
