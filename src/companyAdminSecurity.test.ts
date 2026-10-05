import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source=readFileSync(new URL('../supabase/functions/company-admin/index.ts',import.meta.url),'utf8').replace(/^import .*;\r?$/gm,'');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function endpoint(options:{shared?:number;platform?:boolean;status?:string;expires?:string;lookupError?:boolean;owner?:boolean}={}){
 const passwordWrite=vi.fn(async()=>({error:null}));
 const writes=vi.fn();
 const admin={auth:{getUser:async()=>({data:{user:{id:'actor'}}}),admin:{updateUserById:passwordWrite}},from:(table:string)=>{
  const filters:Record<string,string>={};let head=false;
  const result=()=>{
   if(table==='user_profiles')return {data:filters.id==='actor'?{is_active:true,platform_role:'user'}:{platform_role:options.platform?'super_admin':'user'},error:null};
   if(table==='companies')return {data:{status:options.status??'active',subscription_expires_at:options.expires??null},error:null};
   if(table==='company_memberships'&&head)return {count:options.shared??0,error:options.lookupError?{message:'Lookup unavailable'}:null};
   if(table==='company_memberships')return {data:filters.user_id==='actor'?{role:options.owner?'company_owner':'admin',is_active:true}:{role:'viewer',is_active:true},error:null};
   return {data:null,error:null};
  };
  const q:any={select:(_fields:string,opts:any)=>{head=!!opts?.head;return q},eq:(k:string,v:string)=>{filters[k]=v;return q},neq:()=>q,maybeSingle:async()=>result(),update:(patch:any)=>{writes(table,patch);return q},then:(resolve:any)=>Promise.resolve(result()).then(resolve)};
  return q;
 }};
 let handle:(request:Request)=>Promise<Response>;
 new Function('Deno','createClient',code)({env:{get:()=>''},serve:(fn:any)=>{handle=fn}},()=>admin);
 const call=async(action='reset_password')=>handle!(new Request('https://local.invalid/company-admin',{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({action,company_id:'company-a',user_id:'target',password:'synthetic-only-password',full_name:'Target'})}));
 return {call,passwordWrite,writes};
}
describe('company-admin server authorization',()=>{
 it('denies global password changes for a login belonging to another company',async()=>{const e=endpoint({shared:1});expect((await e.call()).status).toBe(403);expect(e.passwordWrite).not.toHaveBeenCalled()});
 it('denies tenant password reset of a Platform Owner even with a viewer membership',async()=>{const e=endpoint({platform:true,owner:true});expect((await e.call()).status).toBe(403);expect(e.passwordWrite).not.toHaveBeenCalled()});
 it('denies profile changes to a Platform Owner',async()=>{const e=endpoint({platform:true,owner:true});expect((await e.call('update_user')).status).toBe(403);expect(e.writes).not.toHaveBeenCalled()});
 it.each(['suspended','expired','closed'])('denies %s companies before service-role writes',async(status)=>{const e=endpoint({status});expect((await e.call()).status).toBe(403);expect(e.passwordWrite).not.toHaveBeenCalled()});
 it('denies expired subscriptions despite active company status',async()=>{const e=endpoint({expires:'2000-01-01T00:00:00Z'});expect((await e.call()).status).toBe(403);expect(e.passwordWrite).not.toHaveBeenCalled()});
 it('fails closed when shared-membership verification fails',async()=>{const e=endpoint({lookupError:true});expect((await e.call()).status).toBe(403);expect(e.passwordWrite).not.toHaveBeenCalled()});
 it('retains permitted dedicated company-user resets',async()=>{const e=endpoint();expect((await e.call()).status).toBe(200);expect(e.passwordWrite).toHaveBeenCalledTimes(1)});
});
