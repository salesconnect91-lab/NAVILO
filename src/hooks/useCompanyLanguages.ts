import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { NAVILO_LANGUAGES, type NaviloLanguage } from "@/lib/languageConfig";

type Entitlement = { language_code: string; enabled: boolean; is_verified: boolean };

export function useCompanyLanguages() {
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("company_language_entitlements")
      .select("language_code,enabled,is_verified");
    setEntitlements((data ?? []) as Entitlement[]);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const enabledCodes = useMemo(() => {
    const codes = new Set<string>(["en"]);
    entitlements.forEach((row) => {
      if (row.enabled && row.is_verified) codes.add(row.language_code);
    });
    return codes;
  }, [entitlements]);

  const languages = useMemo<NaviloLanguage[]>(
    () => NAVILO_LANGUAGES.filter((language) => enabledCodes.has(language.code)),
    [enabledCodes],
  );

  return { languages, enabledCodes, loading, refresh };
}
