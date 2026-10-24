import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

if(process.env.NAVILO_NATIVE_REHEARSAL!=='1'||process.env.GITHUB_ACTIONS!=='true')
  throw new Error('Expense claim concurrency test is restricted to isolated GitHub PostgreSQL CI');
const driver=process.env.NAVILO_PG_DRIVER;
if(!driver||!path.isAbsolute(driver))throw new Error('Isolated PostgreSQL driver is required');
const pg=await import(pathToFileURL(driver).href);
const Client=pg.Client??pg.default.Client;
const make=()=>new Client({host:'127.0.0.1',port:6543,user:'postgres',password:'navilo-rehearsal-only',database:'navilo_transport_rehearsal'});
const a=make(),b=make();
await Promise.all([a.connect(),b.connect()]);
const tag=randomUUID().replaceAll('-','').slice(0,12);
const user=randomUUID();
let company,unit;
try{
  await a.query('begin');
  await a.query("insert into auth.users(id,role,email,created_at,updated_at) values($1,'authenticated',$2,now(),now())",[user,tag+'@navilo.test']);
  await a.query("insert into public.user_profiles(id,user_id,email,role,platform_role,is_active) values($1,$1,$2,'admin','user',true)",[user,tag+'@navilo.test']);
  const created=await a.query("insert into public.companies(name,code,status,base_currency_code,created_by) values($1,$2,'active','SAR',$3) returning id",['Expense claim concurrency rehearsal','EC'+tag,user]);
  company=created.rows[0].id;
  const business=await a.query("select id from public.business_units where company_id=$1 and is_default",[company]);
  if(!business.rowCount)throw new Error('Synthetic company did not create a default Business Unit');
  unit=business.rows[0].id;
  await a.query('commit');

  const reference='CONCURRENT-'+tag;
  const claimSql='select public.accounting_claim_expense_source_reference($1,$2,$3,$4,$5,null)';
  await a.query('begin');
  await a.query(claimSql,[company,unit,reference,'direct_cash_expense','direct_cash:first']);
  await b.query('begin');
  const second=b.query(claimSql,[company,unit,reference,'direct_cash_expense','direct_cash:second']);
  await new Promise(resolve=>setTimeout(resolve,75));
  await a.query('commit');
  let rejected=false;
  try{await second}catch(error){rejected=error.code==='23505'&&String(error.message).includes('already claimed');}
  await b.query('rollback');
  if(!rejected)throw new Error('Concurrent duplicate source reference was not rejected with a clear duplicate error');

  await b.query('begin');
  await b.query(claimSql,[company,unit,reference,'direct_cash_expense','direct_cash:first']);
  await b.query('commit');
  const count=await a.query('select count(*)::int as n from public.accounting_expense_source_claims where company_id=$1 and business_unit_id=$2 and source_reference=lower($3)',[company,unit,reference]);
  if(count.rows[0].n!==1)throw new Error('Concurrent retry did not leave exactly one normalized source claim');
  console.log('PASS concurrent expense identity claim: one winner, duplicate blocked, same-source retry idempotent');
}catch(error){
  try{await a.query('rollback')}catch{}
  try{await b.query('rollback')}catch{}
  throw error;
}finally{
  await Promise.all([a.end(),b.end()]);
}
