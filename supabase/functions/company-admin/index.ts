import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const HEADERS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...HEADERS,"Content-Type":"application/json"}});
const STANDARD_ROLES=["admin","accounts","sales","purchase","store","production","transport","viewer"];
const MODULES=["dashboard","master","sales","purchase","inventory","production","transport","accounting","reports","settings"];
const ACTIONS=["view","create","edit","delete","post","print","export"];
const profileRole=(role:string)=>role==="accounts"?"accountant":role==="store"?"warehouse":role==="production"?"admin":role;

function sanitizePermissions(input:unknown){
  if(!input||typeof input!=="object"||Array.isArray(input))return {};
  const source=input as Record<string,unknown>;
  const output:Record<string,Record<string,boolean>>={};
  for(const module of MODULES){
    const raw=source[module];
    if(!raw||typeof raw!=="object"||Array.isArray(raw))continue;
    const clean:Record<string,boolean>={};
    for(const action of ACTIONS){
      const value=(raw as Record<string,unknown>)[action];
      if(typeof value==="boolean")clean[action]=value;
    }
    if(Object.keys(clean).length)output[module]=clean;
  }
  return output;
}

Deno.serve(async(request)=>{
  if(request.method==="OPTIONS")return new Response("ok",{headers:HEADERS});
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
  const token=(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  const {data:userData}=await admin.auth.getUser(token);
  if(!userData.user)return json({error:"Invalid session"},401);
  const actor=userData.user;
  const body=await request.json().catch(()=>({}));
  const action=String(body.action||"");
  const companyId=String(body.company_id||"");
  if(!companyId)return json({error:"Company is required"},400);

  const {data:actorProfile}=await admin.from("user_profiles").select("is_active,platform_role").eq("id",actor.id).maybeSingle();
  if(!actorProfile?.is_active)return json({error:"Inactive user profile"},403);
  const isPlatformOwner=actorProfile.platform_role==="super_admin";
  const {data:actorMembership}=await admin.from("company_memberships").select("role,is_active").eq("company_id",companyId).eq("user_id",actor.id).maybeSingle();
  const actorRole=isPlatformOwner?"platform_owner":String(actorMembership?.role||"");
  if(!isPlatformOwner&&(!actorMembership?.is_active||!["company_owner","admin"].includes(actorRole)))return json({error:"Company Owner or Administrator access required"},403);

  const canAssignRole=(role:string)=>{
    if(isPlatformOwner)return ["company_owner",...STANDARD_ROLES].includes(role);
    if(actorRole==="company_owner")return STANDARD_ROLES.includes(role);
    return STANDARD_ROLES.filter(r=>r!=="admin").includes(role);
  };
  const validateWorkspace=async(unitId:string|null,locationId:string|null)=>{
    if(!unitId)return {error:"Select an active business unit."};
    const {data:unit}=await admin.from("business_units").select("id").eq("id",unitId).eq("company_id",companyId).eq("is_active",true).maybeSingle();
    if(!unit)return {error:"Invalid or inactive business unit."};
    if(locationId){
      const {data:location}=await admin.from("operating_locations").select("id").eq("id",locationId).eq("company_id",companyId).eq("business_unit_id",unitId).eq("is_active",true).maybeSingle();
      if(!location)return {error:"Invalid or inactive branch for this business unit."};
    }
    return {error:null};
  };
  const assignWorkspace=async(userId:string,role:string,unitId:string,locationId:string|null)=>{
    await admin.from("business_unit_memberships").update({is_active:false,updated_at:new Date().toISOString()}).eq("company_id",companyId).eq("user_id",userId);
    await admin.from("operating_location_memberships").update({is_active:false,updated_at:new Date().toISOString()}).eq("company_id",companyId).eq("user_id",userId);
    let result=await admin.from("business_unit_memberships").upsert({company_id:companyId,business_unit_id:unitId,user_id:userId,role,is_active:true,updated_at:new Date().toISOString()},{onConflict:"business_unit_id,user_id"});
    if(result.error)throw result.error;
    if(locationId){
      result=await admin.from("operating_location_memberships").upsert({company_id:companyId,business_unit_id:unitId,operating_location_id:locationId,user_id:userId,role,is_active:true,updated_at:new Date().toISOString()},{onConflict:"operating_location_id,user_id"});
      if(result.error)throw result.error;
    }
    result=await admin.from("user_profiles").update({last_company_id:companyId,last_business_unit_id:unitId,locked_business_unit_id:unitId,locked_operating_location_id:locationId,updated_at:new Date().toISOString()}).eq("id",userId);
    if(result.error)throw result.error;
  };

  try{
    if(action==="list_access"){
      const [memberships,units,locations,limits]=await Promise.all([
        admin.from("company_memberships").select("id,user_id,role,is_active,permissions,created_at").eq("company_id",companyId).order("created_at"),
        admin.from("business_units").select("id,name,code,unit_type,is_active,is_default").eq("company_id",companyId).order("is_default",{ascending:false}).order("name"),
        admin.from("operating_locations").select("id,business_unit_id,name,code,location_type,is_active").eq("company_id",companyId).order("name"),
        admin.from("companies").select("max_users,max_business_units,max_branches,max_godowns").eq("id",companyId).single(),
      ]);
      const firstError=memberships.error||units.error||locations.error||limits.error;if(firstError)throw firstError;
      const ids=(memberships.data??[]).map((m:any)=>m.user_id);
      const profiles=ids.length?await admin.from("user_profiles").select("id,email,full_name,locked_business_unit_id,locked_operating_location_id").in("id",ids):{data:[],error:null};
      if(profiles.error)throw profiles.error;
      const profileMap=new Map((profiles.data??[]).map((p:any)=>[p.id,p]));
      const users=(memberships.data??[]).map((m:any)=>({membership_id:m.id,user_id:m.user_id,role:m.role,is_active:m.is_active,permissions:m.permissions||{},created_at:m.created_at,...(profileMap.get(m.user_id)||{})}));
      return json({users,units:units.data??[],locations:locations.data??[],limits:limits.data??{},actor_role:actorRole,is_platform_owner:isPlatformOwner});
    }

    if(action==="create_user"){
      const email=String(body.email||"").trim().toLowerCase();
      const password=String(body.password||"");
      const fullName=String(body.full_name||"").trim();
      const role=String(body.role||"viewer");
      const permissions=sanitizePermissions(body.permissions);
      const unitId=body.business_unit_id?String(body.business_unit_id):null;
      const locationId=body.operating_location_id?String(body.operating_location_id):null;
      if(!email||password.length<8)return json({error:"Email and minimum 8 character temporary password are required."},400);
      if(!canAssignRole(role)||role==="company_owner")return json({error:"You cannot assign this role."},403);
      const workspace=await validateWorkspace(unitId,locationId);if(workspace.error)return json({error:workspace.error},400);
      const [{data:limitData},{count}]=await Promise.all([
        admin.from("companies").select("max_users,max_business_units,max_branches,max_godowns").eq("id",companyId).single(),
        admin.from("company_memberships").select("id",{count:"exact",head:true}).eq("company_id",companyId).eq("is_active",true),
      ]);
      const maxUsers=Number((limitData as any)?.max_users||0)||null;
      if(maxUsers!==null&&(count||0)>=maxUsers)return json({error:`User limit reached (${maxUsers}). Ask the NAVILO Platform Owner to increase the allowance.`},409);
      const {data:created,error:createError}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:fullName}});
      if(createError||!created.user)return json({error:createError?.message||"Could not create login."},400);
      const userId=created.user.id;
      try{
        let result=await admin.from("user_profiles").upsert({id:userId,email,full_name:fullName||null,role:profileRole(role),platform_role:"user",is_active:true,last_company_id:companyId,last_business_unit_id:unitId,locked_business_unit_id:unitId,locked_operating_location_id:locationId,updated_at:new Date().toISOString()},{onConflict:"id"});
        if(result.error)throw result.error;
        result=await admin.from("company_memberships").upsert({company_id:companyId,user_id:userId,role,is_active:true,permissions,invited_by:actor.id,updated_at:new Date().toISOString()},{onConflict:"company_id,user_id"});
        if(result.error)throw result.error;
        await assignWorkspace(userId,role,unitId!,locationId);
        return json({success:true,user_id:userId});
      }catch(error){await admin.auth.admin.deleteUser(userId);throw error;}
    }

    if(action==="create_business_unit"){
      if(!isPlatformOwner&&actorRole!=="company_owner")return json({error:"Only the Company Owner can create a business unit."},403);
      const name=String(body.name||"").trim();
      const code=String(body.code||"").trim().toUpperCase();
      const unitType=String(body.unit_type||"custom");
      if(!name||!code)return json({error:"Business unit name and code are required."},400);
      if(!["steel","transport","retail","fuel","construction","custom"].includes(unitType))return json({error:"Invalid business type."},400);
      const [{data:company},{count},{data:duplicate}]=await Promise.all([
        admin.from("companies").select("max_business_units").eq("id",companyId).single(),
        admin.from("business_units").select("id",{count:"exact",head:true}).eq("company_id",companyId).eq("is_active",true),
        admin.from("business_units").select("id").eq("company_id",companyId).eq("code",code).maybeSingle(),
      ]);
      if(duplicate)return json({error:"This business unit code already exists."},409);
      const maxUnits=company?.max_business_units==null?null:Number(company.max_business_units);
      if(maxUnits!==null&&(count||0)>=maxUnits)return json({error:`Business unit limit reached (${maxUnits}). Ask the NAVILO Platform Owner to increase the allowance.`},409);
      const {data:unit,error:unitError}=await admin.from("business_units").insert({company_id:companyId,name,code,unit_type:unitType,is_active:true,is_default:false}).select("id").single();
      if(unitError||!unit)throw unitError||new Error("Business unit creation failed.");
      const {data:licensed,error:moduleError}=await admin.from("company_modules").select("module_key").eq("company_id",companyId).eq("enabled",true);
      if(moduleError){await admin.from("business_units").delete().eq("id",unit.id);throw moduleError;}
      const moduleKeys=[...new Set(["dashboard",...(licensed||[]).map((row:any)=>String(row.module_key))])];
      if(moduleKeys.length){const result=await admin.from("business_unit_modules").insert(moduleKeys.map(module_key=>({company_id:companyId,business_unit_id:unit.id,module_key,enabled:true})));if(result.error){await admin.from("business_units").delete().eq("id",unit.id);throw result.error;}}
      return json({success:true,business_unit_id:unit.id});
    }

    if(action==="update_business_unit"){
      if(!isPlatformOwner&&actorRole!=="company_owner")return json({error:"Only the Company Owner can change a business unit."},403);
      const unitId=String(body.business_unit_id||"");
      const {data:unit}=await admin.from("business_units").select("id,is_default,is_active").eq("id",unitId).eq("company_id",companyId).maybeSingle();
      if(!unit)return json({error:"Business unit not found."},404);
      const patch:Record<string,unknown>={updated_at:new Date().toISOString()};
      if(body.name!==undefined){const name=String(body.name||"").trim();if(!name)return json({error:"Business unit name is required."},400);patch.name=name;}
      if(body.code!==undefined){const code=String(body.code||"").trim().toUpperCase();if(!code)return json({error:"Business unit code is required."},400);patch.code=code;}
      if(body.is_active!==undefined){
        const active=!!body.is_active;
        if(!active&&unit.is_default)return json({error:"The default business unit cannot be disabled."},409);
        if(!active){const {count}=await admin.from("business_unit_memberships").select("id",{count:"exact",head:true}).eq("business_unit_id",unitId).eq("is_active",true);if((count||0)>0)return json({error:"Reassign active users before disabling this business unit."},409);}
        patch.is_active=active;
      }
      const {error}=await admin.from("business_units").update(patch).eq("id",unitId).eq("company_id",companyId);if(error)throw error;
      return json({success:true});
    }

    if(action==="update_user"){
      const userId=String(body.user_id||"");
      if(!userId)return json({error:"User is required."},400);
      const {data:target}=await admin.from("company_memberships").select("role,is_active").eq("company_id",companyId).eq("user_id",userId).maybeSingle();
      if(!target)return json({error:"User is not assigned to this company."},404);
      if(!isPlatformOwner){
        if(userId===actor.id&&(body.is_active===false||body.role!==undefined||body.permissions!==undefined))return json({error:"You cannot disable or change your own role or permissions."},403);
        if(actorRole==="admin"&&["company_owner","admin"].includes(target.role))return json({error:"Administrators cannot manage Company Owner or Administrator accounts."},403);
        if(target.role==="company_owner"&&(body.role!==undefined||body.permissions!==undefined||body.is_active!==undefined||body.business_unit_id!==undefined||body.operating_location_id!==undefined))return json({error:"Company Owner access is controlled by the NAVILO Platform Owner."},403);
        const {count:sharedCount}=await admin.from("company_memberships").select("id",{count:"exact",head:true}).eq("user_id",userId).eq("is_active",true);
        if((sharedCount||0)>1)return json({error:"This login is shared across companies and can only be changed by the NAVILO Platform Owner."},403);
      }
      const nextRole=body.role===undefined?String(target.role):String(body.role);
      if(body.role!==undefined&&!canAssignRole(nextRole))return json({error:"You cannot assign this role."},403);
      const fullName=body.full_name===undefined?undefined:String(body.full_name||"").trim();
      if(fullName!==undefined){
        const result=await admin.from("user_profiles").update({full_name:fullName||null,updated_at:new Date().toISOString()}).eq("id",userId);if(result.error)throw result.error;
        await admin.auth.admin.updateUserById(userId,{user_metadata:{full_name:fullName}});
      }
      const membershipPatch:any={updated_at:new Date().toISOString()};
      if(body.role!==undefined)membershipPatch.role=nextRole;
      if(body.permissions!==undefined)membershipPatch.permissions=sanitizePermissions(body.permissions);
      if(body.is_active!==undefined)membershipPatch.is_active=!!body.is_active;
      if(Object.keys(membershipPatch).length>1){const result=await admin.from("company_memberships").update(membershipPatch).eq("company_id",companyId).eq("user_id",userId);if(result.error)throw result.error;}
      if(body.is_active===false){
        await admin.from("business_unit_memberships").update({is_active:false,updated_at:new Date().toISOString()}).eq("company_id",companyId).eq("user_id",userId);
        await admin.from("operating_location_memberships").update({is_active:false,updated_at:new Date().toISOString()}).eq("company_id",companyId).eq("user_id",userId);
      }else if(body.business_unit_id!==undefined||body.operating_location_id!==undefined||body.role!==undefined){
        const {data:profile}=await admin.from("user_profiles").select("locked_business_unit_id,locked_operating_location_id").eq("id",userId).maybeSingle();
        const unitId=body.business_unit_id===undefined?(profile?.locked_business_unit_id?String(profile.locked_business_unit_id):null):(body.business_unit_id?String(body.business_unit_id):null);
        const locationId=body.operating_location_id===undefined?(profile?.locked_operating_location_id?String(profile.locked_operating_location_id):null):(body.operating_location_id?String(body.operating_location_id):null);
        const workspace=await validateWorkspace(unitId,locationId);if(workspace.error)return json({error:workspace.error},400);
        await assignWorkspace(userId,nextRole,unitId!,locationId);
      }
      return json({success:true});
    }

    if(action==="reset_password"){
      const userId=String(body.user_id||"");const password=String(body.password||"");
      if(password.length<8)return json({error:"Password must be at least 8 characters."},400);
      const {data:target}=await admin.from("company_memberships").select("role").eq("company_id",companyId).eq("user_id",userId).maybeSingle();
      if(!target)return json({error:"User is not assigned to this company."},404);
      if(!isPlatformOwner){
        if(actorRole==="admin"&&["company_owner","admin"].includes(target.role))return json({error:"Administrators cannot reset this account."},403);
        if(target.role==="company_owner"&&userId!==actor.id)return json({error:"Company Owner password is Platform Owner controlled."},403);
      }
      const {error}=await admin.auth.admin.updateUserById(userId,{password});if(error)throw error;
      return json({success:true});
    }

    return json({error:"Unknown action"},400);
  }catch(error){
    console.error("company-admin",action,error);
    return json({error:error instanceof Error?error.message:"Request failed"},500);
  }
});
