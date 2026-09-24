import SearchableSelect from "@/components/SearchableSelect";
import { useCallback, useEffect, useState } from "react";
import { Globe2, ImagePlus, Languages, Loader2, Save, Trash2 } from "lucide-react";
import { PageHeader, ErrorBanner } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { JURISDICTIONS, getJurisdictionProfile } from "@/lib/jurisdictionConfig";
import {
  GLOBAL_LANGUAGE_CATALOG,
  isAllowedBilingualPair,
  languageDisplayLabel,
  type LanguageMode,
  type NaviloLanguage,
} from "@/lib/languageConfig";
import { useCompanyLanguages } from "@/hooks/useCompanyLanguages";

export default function CompanySettings() {
  const {languages:enabledLanguages,enabledCodes,loading:languageEntitlementsLoading}=useCompanyLanguages();
  const [name,setName]=useState("Steel Mill ERP");
  const [currency,setCurrency]=useState("PKR");
  const [countryCode,setCountryCode]=useState("");
  const [address,setAddress]=useState("");
  const [phone,setPhone]=useState("");
  const [email,setEmail]=useState("");
  const [website,setWebsite]=useState("");
  const [ntn,setNtn]=useState("");
  const [strn,setStrn]=useState("");
  const [logoUrl,setLogoUrl]=useState("");
  const [screenMode,setScreenMode]=useState<LanguageMode>("single");
  const [screenPrimary,setScreenPrimary]=useState("en");
  const [screenSecondary,setScreenSecondary]=useState("ur");
  const [documentMode,setDocumentMode]=useState<LanguageMode>("single");
  const [documentPrimary,setDocumentPrimary]=useState("en");
  const [documentSecondary,setDocumentSecondary]=useState("ur");
  const [uploadingLogo,setUploadingLogo]=useState(false);
  const [backfilling,setBackfilling]=useState(false);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [languageSaving,setLanguageSaving]=useState(false);
  const [jurisdictionSaving,setJurisdictionSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [notice,setNotice]=useState("");
  const [error,setError]=useState<string|null>(null);

  const getCurrentCompanyId=useCallback(async()=>{
    const{data,error}=await supabase.rpc("current_company_id");
    if(error)throw error;
    if(!data)throw new Error("No active company selected.");
    return String(data);
  },[]);

  const load=useCallback(async()=>{
    setLoading(true);setError(null);
    const{data,error}=await supabase.from("company_settings").select("*").maybeSingle();
    if(error)setError(error.message);
    else if(data){
      setName(data.company_name||"Steel Mill ERP");
      setCurrency(data.currency||"PKR");
      setCountryCode(data.country_code||"");
      setAddress(data.address||"");setPhone(data.phone||"");setEmail(data.email||"");setWebsite(data.website||"");
      setNtn(data.ntn||"");setStrn(data.strn||"");setLogoUrl(data.logo_url||"");
      setScreenMode((data.screen_language_mode||"single") as LanguageMode);
      setScreenPrimary(data.screen_primary_language||"en");setScreenSecondary(data.screen_secondary_language||"ur");
      setDocumentMode((data.document_language_mode||"single") as LanguageMode);
      setDocumentPrimary(data.document_primary_language||"en");setDocumentSecondary(data.document_secondary_language||"ur");
    }
    setLoading(false);
  },[]);
  useEffect(()=>{void load();},[load]);

  const jurisdiction=getJurisdictionProfile(countryCode);
  const validPair=(mode:LanguageMode,primary:string,secondary:string)=>mode==="single"||isAllowedBilingualPair(primary,secondary);
  const changeCountry=(next:string)=>{
    const previous=getJurisdictionProfile(countryCode), nextProfile=getJurisdictionProfile(next);
    setCountryCode(next);
    if(!currency.trim()||currency===previous.currency)setCurrency(nextProfile.currency);
  };

  const applyJurisdiction=async()=>{
    if(!countryCode){setError("Country / jurisdiction is required.");return false;}
    setJurisdictionSaving(true);setError(null);setNotice("");
    try{
      const profile=getJurisdictionProfile(countryCode);
      const nextCurrency=currency.trim()||profile.currency;
      const{error}=await supabase.rpc("save_company_jurisdiction_settings",{p_country_code:countryCode,p_currency:nextCurrency});
      if(error)throw error;
      setCurrency(nextCurrency);
      window.dispatchEvent(new Event("navilo-jurisdiction-changed"));
      window.dispatchEvent(new Event("navilo-workspace-changed"));
      setSaved(true);
      setNotice(`${profile.name} jurisdiction applied. ${profile.taxRegisterLabel}, ${profile.authorityLabel} and ${nextCurrency} are now the active statutory profile.`);
      setTimeout(()=>setSaved(false),3000);
      return true;
    }catch(err:any){setError(err?.message||"Failed to apply country / jurisdiction.");return false;}
    finally{setJurisdictionSaving(false);}
  };

  const saveLanguages=async()=>{
    if(!validPair(screenMode,screenPrimary,screenSecondary)||!validPair(documentMode,documentPrimary,documentSecondary)){
      setError("Bilingual mode requires two different supported languages.");return false;
    }
    setLanguageSaving(true);setError(null);setNotice("");
    try{
      const{error}=await supabase.rpc("save_company_language_settings",{
        p_screen_mode:screenMode,p_screen_primary:screenPrimary,p_screen_secondary:screenMode==="bilingual"?screenSecondary:null,
        p_document_mode:documentMode,p_document_primary:documentPrimary,p_document_secondary:documentMode==="bilingual"?documentSecondary:null,
      });
      if(error)throw error;
      window.dispatchEvent(new Event("navilo-language-changed"));window.dispatchEvent(new Event("navilo:language-changed"));
      setSaved(true);setNotice("Language settings saved and applied. Screen language updates immediately; Invoice / Print / PDF follows the document language setting.");
      setTimeout(()=>setSaved(false),3000);return true;
    }catch(err:any){setError(err?.message||"Failed to save language settings.");return false;}
    finally{setLanguageSaving(false);}
  };

  const handleSubmit=async(e:React.FormEvent)=>{
    e.preventDefault();setSaving(true);setSaved(false);setError(null);
    try{
      if(!countryCode)throw new Error("Country / jurisdiction is required.");
      const companyId=await getCurrentCompanyId();
      const{error:saveError}=await supabase.from("company_settings").update({
        company_name:name.trim(),country_code:countryCode,currency:currency.trim()||jurisdiction.currency,
        address:address.trim()||null,phone:phone.trim()||null,email:email.trim()||null,website:website.trim()||null,
        ntn:ntn.trim()||null,strn:strn.trim()||null,updated_at:new Date().toISOString(),
      }).eq("company_id",companyId);
      if(saveError)throw saveError;
      window.dispatchEvent(new Event("navilo-jurisdiction-changed"));
      setSaved(true);setNotice("Company profile saved successfully.");setTimeout(()=>setSaved(false),3000);
    }catch(err:any){setError(err?.message||"Failed to save company settings.");}
    finally{setSaving(false);}
  };

  const handleLogoUpload=async(file:File|null)=>{
    if(!file)return;
    if(!["image/png","image/jpeg","image/webp","image/svg+xml"].includes(file.type))return setError("Please upload PNG, JPG, WebP or SVG logo.");
    if(file.size>2*1024*1024)return setError("Logo file must be 2 MB or smaller.");
    setUploadingLogo(true);setError(null);
    try{
      const companyId=await getCurrentCompanyId(),extension=file.name.split(".").pop()?.toLowerCase()||"png",path=`${companyId}/logo.${extension}`;
      const{error:uploadError}=await supabase.storage.from("company-branding").upload(path,file,{upsert:true,contentType:file.type});if(uploadError)throw uploadError;
      const{data:{publicUrl}}=supabase.storage.from("company-branding").getPublicUrl(path),freshUrl=`${publicUrl}?v=${Date.now()}`;
      const{error:updateError}=await supabase.from("company_settings").update({logo_url:freshUrl,updated_at:new Date().toISOString()}).eq("company_id",companyId);if(updateError)throw updateError;
      setLogoUrl(freshUrl);
    }catch(err:any){setError(err?.message||"Logo upload failed.");}finally{setUploadingLogo(false);}
  };

  const handleRemoveLogo=async()=>{
    setUploadingLogo(true);setError(null);
    try{
      const companyId=await getCurrentCompanyId(),{data:files,error:listError}=await supabase.storage.from("company-branding").list(companyId);if(listError)throw listError;
      const paths=(files||[]).filter(f=>f.name.startsWith("logo.")).map(f=>`${companyId}/${f.name}`);
      if(paths.length){const{error}=await supabase.storage.from("company-branding").remove(paths);if(error)throw error;}
      const{error}=await supabase.from("company_settings").update({logo_url:null,updated_at:new Date().toISOString()}).eq("company_id",companyId);if(error)throw error;
      setLogoUrl("");
    }catch(err:any){setError(err?.message||"Failed to remove logo.");}finally{setUploadingLogo(false);}
  };

  const backfillUrdu=async()=>{
    setBackfilling(true);setError(null);setNotice("");
    const{data,error}=await supabase.rpc("backfill_company_urdu_names");setBackfilling(false);
    if(error)return setError(error.message);
    setNotice(`Urdu backfill completed: ${Number((data as any)?.updated_rows||0)} old master record(s) updated.`);
  };

  if(loading)return <div className="flex min-h-[300px] items-center justify-center"><Loader2 className="mr-2 h-5 w-5 animate-spin"/>Loading settings...</div>;

  return <div>
    <PageHeader title="Company Settings" subtitle="Company profile, country jurisdiction, global language, print and master-data tools"/>
    {error&&<div className="mt-4"><ErrorBanner message={error}/></div>}
    {saved&&<div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">Settings saved and applied successfully</div>}
    {notice&&<div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-700">{notice}</div>}
    <form onSubmit={handleSubmit} className="mt-4 max-w-5xl space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h2 className="font-bold">Company Branding</h2>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div className="flex h-24 w-36 items-center justify-center overflow-hidden rounded-lg border border-dashed bg-white">{logoUrl?<img src={logoUrl} alt="Company logo" className="max-h-20 max-w-[130px] object-contain"/>:<span className="text-xs text-slate-400">No Logo</span>}</div>
          <div className="flex gap-2"><label className="btn btn-secondary cursor-pointer">{uploadingLogo?<Loader2 className="h-4 w-4 animate-spin"/>:<ImagePlus className="h-4 w-4"/>}{logoUrl?"Change Logo":"Upload Logo"}<input type="file" className="hidden" accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={uploadingLogo} onChange={e=>{void handleLogoUpload(e.target.files?.[0]||null);e.currentTarget.value="";}}/></label>{logoUrl&&<button type="button" className="btn btn-danger" onClick={()=>void handleRemoveLogo()}><Trash2 className="h-4 w-4"/>Remove Logo</button>}</div>
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2 font-bold text-amber-900"><Globe2 size={18}/>Country & Statutory Jurisdiction</div>
        <p className="mt-1 text-xs text-amber-800">Select the company's legal country. NAVILO uses it for statutory tax terminology, authority labels, currency defaults and country-specific reports.</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <Field label="Country / Jurisdiction"><SearchableSelect className="input w-full" value={countryCode} onChange={e=>changeCountry(e.target.value)}><option value="">Select country...</option>{JURISDICTIONS.map(j=><option key={j.code} value={j.code}>{j.name}</option>)}</SearchableSelect></Field>
          <Field label="Active statutory profile"><div className="rounded-lg border bg-white px-3 py-2 text-sm"><div className="font-semibold">{countryCode?jurisdiction.name:"Not selected"}</div>{countryCode&&<div className="mt-1 text-xs text-slate-600">{jurisdiction.taxRegisterLabel} · {jurisdiction.authorityLabel} · {jurisdiction.taxIdLabels.join("")} · {jurisdiction.currency}</div>}</div></Field>
        </div>
        <button type="button" onClick={()=>void applyJurisdiction()} disabled={jurisdictionSaving||saving} className="btn btn-primary mt-3">{jurisdictionSaving?<Loader2 className="h-4 w-4 animate-spin"/>:<Globe2 className="h-4 w-4"/>}Apply Country & Jurisdiction</button>
      </section>

      <section className="rounded-xl border border-violet-200 bg-violet-50 p-4">
        <div className="flex items-center gap-2 font-bold text-violet-900"><Globe2 size={18}/>NAVILO Global Language Center</div>
        <p className="mt-1 text-xs text-violet-800">All supported NAVILO languages below are available for screen use and official document output. Country and language remain separate.</p>
        <div className="mt-3 flex flex-wrap gap-2">{GLOBAL_LANGUAGE_CATALOG.map(language=>{const enabled=enabledCodes.has(language.code);return <span key={language.code} className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${enabled?"border-emerald-300 bg-emerald-50 text-emerald-800":"border-slate-200 bg-slate-50 text-slate-500"}`}>{language.label}{language.label!==language.nativeLabel?` · ${language.nativeLabel}`:""} · {enabled?(language.status==="verified"?"ENABLED · VERIFIED":"ENABLED · TRANSLATION VERIFICATION PENDING"):"NOT ENABLED"}</span>})}</div>
        {languageEntitlementsLoading&&<p className="mt-2 text-xs text-slate-500">Checking company language entitlements…</p>}
      </section>

      <LanguagePanel title="Software / Screen / On-screen Reports" languages={enabledLanguages} mode={screenMode} setMode={setScreenMode} primary={screenPrimary} setPrimary={value=>{setScreenPrimary(value);if(screenMode==="bilingual"&&!isAllowedBilingualPair(value,screenSecondary))setScreenSecondary(enabledLanguages.find(x=>x.code!==value)?.code||value);}} secondary={screenSecondary} setSecondary={setScreenSecondary}/>
      <LanguagePanel title="Documents / Report Print / PDF / Export" languages={enabledLanguages} mode={documentMode} setMode={setDocumentMode} primary={documentPrimary} setPrimary={value=>{setDocumentPrimary(value);if(documentMode==="bilingual"&&!isAllowedBilingualPair(value,documentSecondary))setDocumentSecondary(enabledLanguages.find(x=>x.code!==value)?.code||value);}} secondary={documentSecondary} setSecondary={setDocumentSecondary}/>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><div className="font-bold">Company language settings are authoritative across the ERP.</div><div className="mt-1 text-xs">Single Language shows one selected language. Bilingual allows any two different supported languages. Screen language and official document/print language remain separate. Business data, amounts and document numbers are never automatically translated.</div><button type="button" onClick={()=>void saveLanguages()} disabled={languageSaving||saving} className="btn btn-primary mt-3">{languageSaving?<Loader2 className="h-4 w-4 animate-spin"/>:<Languages className="h-4 w-4"/>}Apply Language Settings</button></div>

      <section className="rounded-xl border border-slate-200 p-4"><h2 className="font-bold">Old Master Urdu Backfill</h2><p className="mt-1 text-xs text-slate-500">Existing manually edited Urdu is never overwritten.</p><button type="button" className="btn btn-secondary mt-3" disabled={backfilling} onClick={()=>void backfillUrdu()}>{backfilling?<Loader2 className="h-4 w-4 animate-spin"/>:<Languages className="h-4 w-4"/>}Fill Missing Urdu Names</button></section>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Company Name"><input className="input w-full" value={name} onChange={e=>setName(e.target.value)} required/></Field>
        <Field label="Default Currency"><input className="input w-full" value={currency} onChange={e=>setCurrency(e.target.value)} required/></Field>
        <Field label="Phone"><input className="input w-full" value={phone} onChange={e=>setPhone(e.target.value)}/></Field>
        <Field label="Email"><input type="email" className="input w-full" value={email} onChange={e=>setEmail(e.target.value)}/></Field>
        <Field label="Website"><input className="input w-full" value={website} onChange={e=>setWebsite(e.target.value)}/></Field>
        <Field label={countryCode==="PK"?"NTN":"Tax ID / Registration No."}><input className="input w-full" value={ntn} onChange={e=>setNtn(e.target.value)}/></Field>
        <Field label={countryCode==="PK"?"STRN":"Secondary Tax Registration"}><input className="input w-full" value={strn} onChange={e=>setStrn(e.target.value)}/></Field>
      </div>
      <Field label="Address"><textarea className="input w-full" rows={3} value={address} onChange={e=>setAddress(e.target.value)}/></Field>
      <div className="flex justify-end border-t pt-4"><button type="submit" disabled={saving||languageSaving||jurisdictionSaving} className="btn btn-primary">{saving?<Loader2 className="h-4 w-4 animate-spin"/>:<Save className="h-4 w-4"/>}Save Company Settings</button></div>
    </form>
  </div>;
}

function LanguagePanel({title,languages,mode,setMode,primary,setPrimary,secondary,setSecondary}:{title:string;languages:NaviloLanguage[];mode:LanguageMode;setMode:(v:LanguageMode)=>void;primary:string;setPrimary:(v:string)=>void;secondary:string;setSecondary:(v:string)=>void}){
  const safeLanguages=languages.length?languages:[GLOBAL_LANGUAGE_CATALOG[0]];
  const safePrimary=safeLanguages.some(x=>x.code===primary)?primary:safeLanguages[0].code;
  const secondaryOptions=safeLanguages.filter(language=>language.code!==safePrimary);
  const bilingualAvailable=secondaryOptions.length>0;
  const changeMode=(next:LanguageMode)=>{const safeMode=next==="bilingual"&&bilingualAvailable?next:"single";setMode(safeMode);if(safeMode==="bilingual"&&!secondaryOptions.some(x=>x.code===secondary))setSecondary(secondaryOptions[0].code);};
  return <section className="rounded-xl border border-blue-200 bg-blue-50 p-4"><div className="flex items-center gap-2 font-bold"><Languages size={18}/>{title}</div><div className="mt-3 grid gap-4 md:grid-cols-3"><Field label="Display Mode"><SearchableSelect className="input w-full" value={mode==="bilingual"&&bilingualAvailable?mode:"single"} onChange={e=>changeMode(e.target.value as LanguageMode)}><option value="single">Single Language</option><option value="bilingual" disabled={!bilingualAvailable}>Bilingual / Two Languages</option></SearchableSelect></Field><Field label="Primary Language"><LanguageSelect languages={safeLanguages} value={safePrimary} onChange={setPrimary}/></Field>{mode==="bilingual"&&bilingualAvailable&&<Field label="Secondary Language"><SearchableSelect className="input w-full" value={secondaryOptions.some(x=>x.code===secondary)?secondary:secondaryOptions[0].code} onChange={e=>setSecondary(e.target.value)}>{secondaryOptions.map(l=><option key={l.code} value={l.code}>{languageDisplayLabel(l.code)}</option>)}</SearchableSelect></Field>}</div>{!bilingualAvailable&&<p className="mt-2 text-xs font-medium text-amber-700">Bilingual mode becomes available after the Platform Owner enables a second verified language pack.</p>}<div className="mt-3 rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs text-slate-600"><span className="font-semibold text-slate-800">Live preview:</span> {mode==="single"||!bilingualAvailable?languageDisplayLabel(safePrimary):`${languageDisplayLabel(safePrimary)} + ${languageDisplayLabel(secondary)}`}</div></section>;
}
function LanguageSelect({languages,value,onChange}:{languages:NaviloLanguage[];value:string;onChange:(v:string)=>void}){return <SearchableSelect className="input w-full" value={value} onChange={e=>onChange(e.target.value)}>{languages.map(l=><option key={l.code} value={l.code}>{languageDisplayLabel(l.code)}</option>)}</SearchableSelect>}
function Field({label,children}:{label:string;children:React.ReactNode}){return <div><label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>{children}</div>}
