import {useEffect,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
export function useTransportOutputPermissions(module='transport'){
 const {activeCompany,activeBusinessUnit}=useAuth();const company=activeCompany?.company_id;
 const [allowed,setAllowed]=useState({print:false,export:false});
 useEffect(()=>{let live=true;setAllowed({print:false,export:false});if(!company)return;
 void Promise.all(['print','export'].map(action=>supabase.rpc('has_module_permission',{p_company_id:company,p_module:module,p_action:action}))).then(([print,output])=>{if(live)setAllowed({print:!print.error&&print.data===true,export:!output.error&&output.data===true})}).catch(()=>{if(live)setAllowed({print:false,export:false})});return()=>{live=false};
 },[company,activeBusinessUnit?.business_unit_id,module]);return allowed;
}
