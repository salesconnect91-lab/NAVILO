import * as Lucide from "lucide-react";
import { startTransition, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { useFeatureAccess } from "@/auth/FeatureAccess";
import { hasPermission, roleLabel, type ModuleKey, type PermissionMatrix } from "@/auth/permissions";
import { FEATURE_BY_KEY } from "@/config/featureRegistry";
import { usePlatformBranding } from "@/lib/platformBranding";
import { supabase } from "@/lib/supabase";
import UniversalDataTools from "@/components/UniversalDataTools";
import NeusRouteSurface from "@/components/NeusRouteSurface";

import { shellLabel, matches, title, type NavNode } from "@/config/navigation";
import { WorkspaceCatalogProvider, useWorkspaceCatalog } from "./workspace/WorkspaceCatalog";
import CompanySwitcher from "./CompanySwitcher";
import BusinessUnitSwitcher from "./BusinessUnitSwitcher";
import WorkspaceTools from "./workspace/WorkspaceTools";

export default function Layout({children}:{children:ReactNode}){return <WorkspaceCatalogProvider><WorkspaceLayout>{children}</WorkspaceLayout></WorkspaceCatalogProvider>}

function WorkspaceLayout({children}:{children:ReactNode}){
  const{user,signOut,isPlatformOwner,activeCompany,activeBusinessUnit}=useAuth();
  const{isFeatureEnabled}=useFeatureAccess();
  const{branding}=usePlatformBranding();
  const location=useLocation(),navigate=useNavigate();
  const mobileMenuButton=useRef<HTMLButtonElement>(null);
  const role=activeBusinessUnit?.membership_role??activeCompany?.membership_role;
  const permissions=(activeBusinessUnit?.permissions??activeCompany?.permissions) as PermissionMatrix|undefined;
  const mods=activeBusinessUnit?.enabled_modules??[];
  const enabledModulesKey=mods.join("|");
  const[collapsed,setCollapsed]=useState(()=>localStorage.getItem("navilo-sidebar-collapsed")==="true"),[mobileOpen,setMobileOpen]=useState(false),[open,setOpen]=useState<Record<string,boolean>>({});
  const[companySidebarBrand,setCompanySidebarBrand]=useState<{name:string;logoUrl:string}>({name:"",logoUrl:""});
  useEffect(()=>{localStorage.setItem("navilo-sidebar-collapsed",String(collapsed));},[collapsed]);
  useEffect(()=>{
    if(!mobileOpen)return;
    const panel=document.getElementById("navilo-sidebar");
    const surface=document.getElementById("navilo-main-content")?.parentElement;
    const wasInert=surface?.inert??false;
    if(surface)surface.inert=true;
    const focusable=()=>Array.from(panel?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])')??[]);
    focusable()[0]?.focus();
    const closeOnEscape=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){setMobileOpen(false);mobileMenuButton.current?.focus();}
      if(event.key==="Tab"){const items=focusable(),first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
    };
    window.addEventListener("keydown",closeOnEscape);
    return ()=>{window.removeEventListener("keydown",closeOnEscape);if(surface)surface.inert=wasInert};
  },[mobileOpen]);
  useEffect(()=>{localStorage.setItem("navilo-theme","light");document.documentElement.dataset.theme="light";document.documentElement.classList.remove("dark");},[]);
  const { navigation: visible } = useWorkspaceCatalog();
  const pageTitle=location.pathname.startsWith("/workspace/") ? ({reports:"Reports Center",imports:"Import Center",favorites:"Favorites",recent:"Recent Pages",functions:"All Functions"}[location.pathname.split("/")[2]]??"Workspace") : title(location.pathname);
  const ownerWorkspace=location.pathname.startsWith("/owner");
  const standaloneTransportMobile=location.pathname==="/transport/mobile";
  const showSidebarBrand=branding.show_branding&&branding.show_in_sidebar;
  useEffect(()=>{
    if(ownerWorkspace||!activeCompany?.company_id){setCompanySidebarBrand({name:"",logoUrl:""});return;}
    let cancelled=false;
    void supabase.from("company_settings").select("company_name,logo_url").maybeSingle().then(({data})=>{
      if(cancelled)return;
      setCompanySidebarBrand({name:String(data?.company_name||activeCompany.company_name||""),logoUrl:String(data?.logo_url||"")});
    });
    return()=>{cancelled=true;};
  },[ownerWorkspace,activeCompany?.company_id,activeCompany?.company_name]);
  useEffect(()=>{document.title=branding.show_branding&&branding.erp_name?`${pageTitle} · ${branding.erp_name}`:pageTitle},[pageTitle,branding.show_branding,branding.erp_name]);
  const render=(n:NavNode,d=0):ReactNode=>{
    const active=matches(n,location.pathname+location.search),has=Boolean(n.children?.length),expanded=open[n.key]??active,Icon=n.icon;
    if(has)return <div key={n.key}><button type="button" title={collapsed?shellLabel(n.label):undefined} aria-label={shellLabel(n.label)} aria-expanded={expanded&&(!collapsed||mobileOpen)} onClick={()=>{if(collapsed&&!mobileOpen){setCollapsed(false);setOpen(v=>({...v,[n.key]:true}));}else setOpen(v=>({...v,[n.key]:!expanded}));}} className={`navilo-nav-group flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors duration-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 ${d===0?"text-[13px] font-bold":"text-[12.5px] font-semibold"} ${active?"is-active bg-white/[0.10] text-white":"text-slate-400 hover:bg-white/[0.06] hover:text-slate-100"}`}>{Icon&&<Icon className="h-4 w-4 shrink-0"/>}<span className={`min-w-0 flex-1 truncate ${collapsed?"lg:hidden":""}`}>{shellLabel(n.label)}</span><Lucide.ChevronDown className={`h-3.5 w-3.5 shrink-0 ${collapsed?"lg:hidden":""} ${expanded?"rotate-180":""}`}/></button>{expanded&&(!collapsed||mobileOpen)&&<div className={`${d===0?"ml-4":"ml-3"} mt-1 border-l border-white/10 pl-2`}>{n.children?.map(c=>render(c,d+1))}</div>}</div>;
    if(!n.to)return null;
    return <NavLink key={n.key} to={n.to} end={n.end} aria-current={n.to.includes("?")?(active?"page":false):undefined} title={collapsed?shellLabel(n.label):undefined} aria-label={shellLabel(n.label)} onClick={()=>{if(mobileOpen)setMobileOpen(false); startTransition(()=>navigate(n.to!));}} className={({isActive})=>`navilo-nav-link flex min-h-8 items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] font-semibold transition-colors duration-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 ${(n.to?.includes("?")?active:isActive)?"is-active bg-blue-600 text-white shadow-sm shadow-blue-950/20":"text-slate-400 hover:bg-white/[0.06] hover:text-slate-100"}`}>{Icon&&<Icon className="h-4 w-4 shrink-0"/>}<span className={`truncate ${collapsed?"lg:hidden":""}`}>{shellLabel(n.label)}</span></NavLink>;
  };
  const side=collapsed?"lg:w-[56px]":"lg:w-[216px]",offset=collapsed?"lg:ml-[56px]":"lg:ml-[216px]";
  if(standaloneTransportMobile)return <div className="min-h-dvh bg-slate-100 text-slate-900">
    <main id="navilo-main-content" data-neus-route={location.pathname} data-i18n-skip="true" className="min-h-dvh w-full p-0">{children}</main>
  </div>;
  return <div className="erp-shell navilo-modern min-h-screen bg-[#f6f7f9] text-slate-900">
    {mobileOpen&&<button type="button" aria-label="Close navigation" onClick={()=>setMobileOpen(false)} className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"/>}
    <aside id="navilo-sidebar" aria-label="Primary navigation" className={`navilo-sidebar fixed inset-y-0 left-0 z-50 flex w-[252px] flex-col border-r border-slate-800/80 bg-slate-950 text-slate-300 shadow-2xl shadow-slate-950/10 transition-all duration-200 ${side} ${mobileOpen?"translate-x-0":"invisible -translate-x-full lg:visible lg:translate-x-0"}`}>
      <div className="flex h-16 items-center border-b border-white/10 px-3">{showSidebarBrand&&branding.logo_url?<img src={branding.logo_url} alt={branding.erp_name||"ERP"} className="h-11 w-11 rounded-xl object-contain"/>:!ownerWorkspace&&companySidebarBrand.logoUrl?<img src={companySidebarBrand.logoUrl} alt={companySidebarBrand.name||activeCompany?.company_name||"Company"} className="h-11 w-11 rounded-xl bg-white object-contain p-0.5"/>:<div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.05]"><Lucide.LayoutGrid className="h-5 w-5 text-slate-500"/></div>}<div className={`ml-2 min-w-0 ${collapsed?"lg:hidden":""}`}>{showSidebarBrand&&branding.erp_name?<><div className="truncate text-[14px] font-black text-white">{branding.erp_name}</div>{branding.show_tagline&&branding.tagline&&<div className="truncate text-[11px] text-slate-500">{branding.tagline}</div>}</>:!ownerWorkspace?<><div className="truncate text-[14px] font-black text-white">{companySidebarBrand.name||activeCompany?.company_name||"Company Workspace"}</div><div className="truncate text-[11px] text-slate-500">Company Workspace</div></>:<div className="text-[13px] font-bold text-slate-400">ERP Workspace</div>}</div><button type="button" aria-label="Close navigation" onClick={()=>setMobileOpen(false)} className="ml-auto rounded-md p-2 text-slate-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 lg:hidden"><Lucide.X className="h-5 w-5"/></button></div>
      <nav aria-label="Modules" className="flex-1 overflow-y-auto px-2 py-3"><div className="space-y-1">{visible.map(n=>render(n))}</div></nav>
      <div className="border-t border-white/10 p-2"><div className={`mb-2 rounded-md bg-white/[0.03] px-2 py-2 ${collapsed?"lg:hidden":""}`}><div className="text-[11px] uppercase text-slate-600">Active Company</div><div className="truncate text-[12px] font-bold text-slate-300">{location.pathname.startsWith("/owner")?"Owner Workspace":activeCompany?.company_name??"No company"}</div><div className="text-[11px] text-slate-500">{user?.email??"Signed in"} · {isPlatformOwner?"Platform Owner":roleLabel(role)}</div></div><button type="button" aria-label="Sign out" onClick={async()=>{await signOut();navigate("/login")}} className="flex h-9 w-full items-center justify-center gap-2 rounded-md text-[12px] text-slate-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"><Lucide.LogOut className="h-4 w-4"/><span className={collapsed?"lg:hidden":""}>Sign out</span></button></div>
    </aside>
    <div className={`min-h-screen min-w-0 transition-all ${offset} ${location.pathname.startsWith("/transport")?"relative z-0":""}`} style={location.pathname.startsWith("/transport")?{width:"auto",maxWidth:"100%"}:undefined}>
      <header className="navilo-topbar sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="flex min-h-16 items-center gap-3 px-4 py-2 lg:px-5"><button ref={mobileMenuButton} type="button" aria-label="Open navigation" aria-controls="navilo-sidebar" aria-expanded={mobileOpen} onClick={()=>setMobileOpen(true)} className="rounded-md p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 lg:hidden"><Lucide.Menu/></button><button type="button" aria-label={collapsed?"Expand navigation":"Collapse navigation"} aria-controls="navilo-sidebar" aria-expanded={!collapsed} onClick={()=>setCollapsed(v=>!v)} className="hidden h-9 w-9 items-center justify-center rounded-md border focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 lg:flex"><Lucide.PanelLeftClose className={`h-4 w-4 ${collapsed?"rotate-180":""}`}/></button>{location.pathname!=="/"&&<button onClick={()=>startTransition(()=>{if(location.pathname.startsWith("/transport"))navigate("/");else navigate(-1)})} className="hidden h-9 items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-3 text-[13px] font-black text-blue-800 sm:inline-flex"><Lucide.ArrowLeft className="h-4 w-4"/>Back</button>}<div className="min-w-0 flex-1"><div className="truncate text-[16px] font-black text-slate-950">{pageTitle}</div></div>{!ownerWorkspace&&<div className="workspace-context"><CompanySwitcher inline/><BusinessUnitSwitcher inline/></div>}<WorkspaceTools/>{!location.pathname.startsWith("/workspace/")&&<UniversalDataTools/>}<div className="workspace-company-label hidden text-right lg:block"><div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{location.pathname.startsWith("/owner")?"Platform Workspace":"Active Company"}</div><div className="max-w-[220px] truncate text-[12px] font-black text-slate-800">{location.pathname.startsWith("/owner")?(branding.show_branding&&branding.erp_name?`${branding.erp_name} Platform`:"Owner Platform"):activeCompany?.company_name??"No company selected"}</div></div></div></header>
      <main id="navilo-main-content" data-neus-route={location.pathname} data-i18n-skip={location.pathname.startsWith("/transport")?"true":undefined} style={location.pathname.startsWith("/transport")?{width:"100%",maxWidth:"none",marginInline:0,paddingInline:0}:undefined} className={location.pathname.startsWith("/transport")?"py-2":"px-3 py-4 sm:px-4 lg:px-5"}><NeusRouteSurface/>{children}</main>
    </div>
  </div>;
}
