import { translateGlobalUi } from "./globalTranslations";
import type { RuntimeLanguageCode } from "./languageConfig";

export function translateUiTemplate(
  template: string,
  values: Record<string, string | number>,
  language: RuntimeLanguageCode,
) {
  const translated = translateGlobalUi(template, language);
  return translated.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}
