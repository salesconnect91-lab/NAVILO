const LATIN=/[A-Za-z]/;
const RTL=/[\u0600-\u06FF]/;
const UI_SELECTOR="button,label,h1,h2,h3,h4,h5,h6,th,legend,summary,[role='button'],[role='tab'],[role='menuitem'],[aria-label],[placeholder],[data-i18n-label],[data-document-label]";
const warned=new Set<string>();

function currentScreenRequirement(){
  const root=document.documentElement;
  const mode=root.dataset.languageMode==="bilingual"?"bilingual":"single";
  const primary=root.dataset.primaryLanguage||"en";
  const secondary=root.dataset.secondaryLanguage||"";
  return {mode,primary,secondary};
}

function currentDocumentRequirement(){
  const root=document.documentElement;
  const mode=root.dataset.documentLanguageMode==="bilingual"?"bilingual":"single";
  const primary=root.dataset.documentPrimaryLanguage||"en";
  const secondary=root.dataset.documentSecondaryLanguage||"";
  return {mode,primary,secondary};
}

function needsRtlLanguage(config:{mode:string;primary:string;secondary:string}){
  return config.primary==="ur"||config.primary==="ar"||config.secondary==="ur"||config.secondary==="ar";
}

function inspectElement(element:HTMLElement,documentScope=false){
  if(element.closest("[data-i18n-skip='true'],[data-business-data],input[type='hidden'],script,style,code,pre"))return;
  const value=(element.getAttribute("aria-label")||element.getAttribute("placeholder")||element.textContent||"").replace(/\s+/g," ").trim();
  if(!value||!LATIN.test(value))return;
  const config=documentScope?currentDocumentRequirement():currentScreenRequirement();
  const singleRtl=config.mode==="single"&&(config.primary==="ur"||config.primary==="ar");
  const bilingualRtl=config.mode==="bilingual"&&needsRtlLanguage(config);
  const missing=singleRtl?!RTL.test(value):bilingualRtl&&!RTL.test(value);
  if(!missing){delete element.dataset.i18nMissing;return;}
  element.dataset.i18nMissing="true";
  const key=`${documentScope?"document":"screen"}:${value}`;
  if(!warned.has(key)){
    warned.add(key);
    console.warn(`[NAVILO i18n] Missing ${documentScope?"document":"screen"} translation:`,value);
  }
}

function audit(){
  document.querySelectorAll<HTMLElement>(UI_SELECTOR).forEach((element)=>{
    const documentScope=Boolean(element.closest(".print-document,[data-document-language-root]"));
    inspectElement(element,documentScope);
  });
}

let timer=0;
function queue(){window.clearTimeout(timer);timer=window.setTimeout(audit,40);}
const observer=new MutationObserver(queue);
observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["data-language-mode","data-primary-language","data-secondary-language","data-document-language-mode","data-document-primary-language","data-document-secondary-language"]});
document.addEventListener("DOMContentLoaded",queue,{once:true});
window.addEventListener("navilo-language-changed",queue as EventListener);
window.addEventListener("navilo:language-changed",queue as EventListener);
queue();
