import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { isSupportedRuntimeLanguage, languageByCode, type LanguageMode, type RuntimeLanguageCode } from "@/lib/languageConfig";
import { translateGlobalUi } from "@/lib/globalTranslations";
import { sourceEnglish } from "@/lib/uiLanguageSource";

type RuntimeLanguage={mode:LanguageMode;primary:RuntimeLanguageCode;secondary:RuntimeLanguageCode|null;documentMode:LanguageMode;documentPrimary:RuntimeLanguageCode;documentSecondary:RuntimeLanguageCode|null};
const ENGLISH_ONLY:RuntimeLanguage={mode:"single",primary:"en",secondary:null,documentMode:"single",documentPrimary:"en",documentSecondary:null};
const originals=new WeakMap<Text,string>();
const renderedText=new WeakMap<Text,string>();
const attributes=new WeakMap<Element,Map<string,string>>();
const renderedAttributes=new WeakMap<Element,Map<string,string>>();
const TRANSLATABLE_ATTRIBUTES=["placeholder","title","aria-label"] as const;
const GENERIC_TAGS=new Set(["BUTTON","LABEL","H1","H2","H3","H4","H5","H6","TH","OPTION","LEGEND","SUMMARY"]);
const UI_HINT=/(btn|button|label|title|heading|menu|nav|tab|badge|pill|filter|toolbar|action|error|warning|alert|hint|help|subtitle|summary)/i;
const RTL_LANGUAGES=new Set<RuntimeLanguageCode>(["ur","ar","fa"]);

function sanitize(mode:LanguageMode,primary?:string|null,secondary?:string|null){
  const p:RuntimeLanguageCode=isSupportedRuntimeLanguage(primary)?primary:"en";
  const s:RuntimeLanguageCode|null=isSupportedRuntimeLanguage(secondary)&&secondary!==p?secondary:null;
  return {mode:mode==="bilingual"&&s?"bilingual" as LanguageMode:"single" as LanguageMode,primary:p,secondary:s};
}

async function loadLanguage():Promise<RuntimeLanguage>{
  const [company,userResult]=await Promise.all([
    supabase.from("company_settings").select("screen_language_mode,screen_primary_language,screen_secondary_language,document_language_mode,document_primary_language,document_secondary_language").maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if(company.error)throw company.error;
  let screen=sanitize((company.data?.screen_language_mode||"single") as LanguageMode,company.data?.screen_primary_language,company.data?.screen_secondary_language);
  const document=sanitize((company.data?.document_language_mode||"single") as LanguageMode,company.data?.document_primary_language,company.data?.document_secondary_language);
  const user=userResult.data.user;
  if(user){
    const pref=await supabase.from("user_language_preferences").select("use_company_default,screen_language_mode,primary_language,secondary_language").eq("user_id",user.id).maybeSingle();
    if(!pref.error&&pref.data&&pref.data.use_company_default===false){
      screen=sanitize((pref.data.screen_language_mode||"single") as LanguageMode,pref.data.primary_language,pref.data.secondary_language);
    }
  }
  return {mode:screen.mode,primary:screen.primary,secondary:screen.secondary,documentMode:document.mode,documentPrimary:document.primary,documentSecondary:document.secondary};
}

function applyRoot(language:RuntimeLanguage){
  const primary=languageByCode(language.primary);
  document.documentElement.lang=language.primary;
  document.documentElement.dir=language.mode==="single"&&primary.direction==="rtl"?"rtl":"ltr";
  document.documentElement.dataset.languageMode=language.mode;
  document.documentElement.dataset.primaryLanguage=language.primary;
  if(language.secondary)document.documentElement.dataset.secondaryLanguage=language.secondary;else delete document.documentElement.dataset.secondaryLanguage;
  document.documentElement.dataset.documentLanguageMode=language.documentMode;
  document.documentElement.dataset.documentPrimaryLanguage=language.documentPrimary;
  if(language.documentSecondary)document.documentElement.dataset.documentSecondaryLanguage=language.documentSecondary;else delete document.documentElement.dataset.documentSecondaryLanguage;
}

function normalize(value:string){return value.trim().replace(/\s+/g," ");}
function hasLatin(value:string){return /[A-Za-z]/.test(value);}
function hasRtl(value:string){return /[\u0600-\u06FF]/.test(value);}
function isUiText(node:Text){
  const parent=node.parentElement;
  if(!parent||parent.closest("[data-i18n-skip='true'],[data-business-data],input,textarea,script,style,code,pre"))return false;
  if(GENERIC_TAGS.has(parent.tagName))return true;
  if(parent.closest("button,label,nav,[role='button'],[role='menuitem'],[role='tab'],[role='alert']"))return true;
  return UI_HINT.test(parent.className||"");
}
function localize(value:string,language:RuntimeLanguage,force=false){
  if(!value.trim())return value;
  const leading=value.match(/^\s*/)?.[0]||"",trailing=value.match(/\s*$/)?.[0]||"";
  const source=sourceEnglish(value);
  if(!force&&!hasLatin(source))return value;
  const requested:RuntimeLanguageCode[]=language.mode==="bilingual"&&language.secondary?[language.primary,language.secondary]:[language.primary];
  const parts=requested.map(code=>code==="en"?source:translateGlobalUi(source,code)).filter((part,index,all)=>part&&all.indexOf(part)===index);
  return `${leading}${parts.join(" / ")}${trailing}`;
}
function processText(node:Text,language:RuntimeLanguage){
  const current=node.nodeValue||"";
  if(!current.trim())return;
  const lastRendered=renderedText.get(node);
  if(!originals.has(node)||(lastRendered!==undefined&&current!==lastRendered))originals.set(node,current);
  const source=originals.get(node)||current;
  const expected=localize(source,language,isUiText(node));
  renderedText.set(node,expected);
  if(node.nodeValue!==expected)node.nodeValue=expected;
}
function processAttributes(element:Element,language:RuntimeLanguage){
  if(element.closest("[data-i18n-skip='true'],[data-business-data]"))return;
  let map=attributes.get(element);if(!map){map=new Map();attributes.set(element,map);}
  let rendered=renderedAttributes.get(element);if(!rendered){rendered=new Map();renderedAttributes.set(element,rendered);}
  for(const name of TRANSLATABLE_ATTRIBUTES){
    const current=element.getAttribute(name);if(!current)continue;
    const lastRendered=rendered.get(name);
    if(!map.has(name)||(lastRendered!==undefined&&current!==lastRendered))map.set(name,current);
    const next=localize(map.get(name)||current,language,true);
    rendered.set(name,next);
    if(current!==next)element.setAttribute(name,next);
  }
  if(language.mode==="single"&&RTL_LANGUAGES.has(language.primary)&&element.matches("button,label,h1,h2,h3,h4,h5,h6,th,option,[role='button'],[role='menuitem'],[role='tab']"))element.setAttribute("dir","rtl");
  else if(element.hasAttribute("dir")&&element.matches("button,label,h1,h2,h3,h4,h5,h6,th,option,[role='button'],[role='menuitem'],[role='tab']"))element.removeAttribute("dir");
}
function translateTree(root:Node,language:RuntimeLanguage){
  if(root.nodeType===Node.TEXT_NODE){processText(root as Text,language);return;}
  if(root.nodeType===Node.ELEMENT_NODE)processAttributes(root as Element,language);
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
  while(walker.nextNode()){
    const node=walker.currentNode;
    if(node.nodeType===Node.TEXT_NODE)processText(node as Text,language);else if(node.nodeType===Node.ELEMENT_NODE)processAttributes(node as Element,language);
  }
}

export default function GlobalLanguageRuntime(){
  useEffect(()=>{
    let active=true,language:RuntimeLanguage=ENGLISH_ONLY,frame=0,applying=false;
    let titleSource=document.title,titleRendered=document.title;
    const apply=()=>{if(!active)return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{applying=true;applyRoot(language);translateTree(document.body,language);if(document.title!==titleRendered)titleSource=document.title;titleRendered=localize(titleSource,language,true);if(document.title!==titleRendered)document.title=titleRendered;queueMicrotask(()=>{applying=false;});});};
    const refresh=async()=>{try{language=await loadLanguage();}catch{language=ENGLISH_ONLY;}apply();};
    const observer=new MutationObserver(mutations=>{if(!active)return;for(const mutation of mutations){const titleMutation=mutation.target.parentElement?.tagName==="TITLE"||mutation.target.nodeName==="TITLE";if(applying&&!titleMutation)continue;mutation.addedNodes.forEach(node=>{if(node.nodeType===Node.TEXT_NODE||node.nodeType===Node.ELEMENT_NODE)translateTree(node,language);});if(mutation.type==="characterData"&&mutation.target.nodeType===Node.TEXT_NODE)processText(mutation.target as Text,language);if(mutation.type==="attributes"&&mutation.target.nodeType===Node.ELEMENT_NODE)processAttributes(mutation.target as Element,language);}});
    // Observe the document root so route-driven <title> changes are localized
    // as well as visible body content.
    observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:[...TRANSLATABLE_ATTRIBUTES]});
    void refresh();
    const changed=()=>void refresh();
    window.addEventListener("navilo-language-changed",changed);window.addEventListener("navilo:language-changed",changed);window.addEventListener("navilo-workspace-changed",changed);
    return()=>{active=false;observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener("navilo-language-changed",changed);window.removeEventListener("navilo:language-changed",changed);window.removeEventListener("navilo-workspace-changed",changed);};
  },[]);
  return null;
}
