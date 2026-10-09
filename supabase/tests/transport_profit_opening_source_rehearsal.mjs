// Isolated PostgreSQL source/approval tests. Canonical post is a balanced-ledger stub;
// full canonical posting is separately covered by replay_transport_isolated.mjs.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const [c,b,u,loc,gl,retained,rule,p1,p2]=[1,2,3,4,5,6,7,8,9].map(id);
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key);insert into auth.users values('${u}');
set test.company='${c}';set test.unit='${b}';set test.actor='${u}';set test.allowed='true';
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor'),'')::uuid$$;
create function current_company_id() returns uuid language sql stable as $$select current_setting('test.company')::uuid$$;
create function current_business_unit_id() returns uuid language sql stable as $$select current_setting('test.unit')::uuid$$;
create function current_operating_location_id() returns uuid language sql stable as $$select '${loc}'::uuid$$;
create function legacy_data_user_id() returns uuid language sql stable as $$select auth.uid()$$;
create function has_module_permission(uuid,text,text) returns boolean language sql stable as $$select current_setting('test.allowed')::boolean$$;
create function is_platform_owner() returns boolean language sql stable as $$select true$$;
create table companies(id uuid primary key,base_currency_code text);
create table business_units(id uuid primary key,company_id uuid,is_active boolean,unit_type text);
create table company_memberships(company_id uuid,user_id uuid,is_active boolean,role text);
create table business_unit_memberships(company_id uuid,business_unit_id uuid,user_id uuid,is_active boolean,role text);
create table chart_of_accounts(id uuid primary key,company_id uuid,name text,code text,type text,detail_type text,is_active boolean,is_group boolean,allow_manual_entries boolean);
create table transport_profit_distribution_rules(id uuid primary key,company_id uuid,business_unit_id uuid,method text,status text,effective_from date,shares jsonb);
create table transport_profit_distribution_rule_partners(rule_id uuid,company_id uuid,business_unit_id uuid,account_id uuid,partner_name_snapshot text,partner_key text,percentage numeric);
create table journal_entries(id uuid primary key,user_id uuid,company_id uuid,business_unit_id uuid,operating_location_id uuid,entry_no text,entry_date date,description text,status text,payment_mode text,trans_type text,created_by uuid,source_module text,source_document_type text,source_document_id uuid,currency_code text,exchange_rate numeric,fiscal_year_closure_id uuid);
create table journal_lines(id uuid primary key default gen_random_uuid(),entry_id uuid,user_id uuid,company_id uuid,business_unit_id uuid,operating_location_id uuid,account text,account_id uuid,debit numeric,credit numeric);
create table accounting_periods(company_id uuid,status text,period_start date,period_end date);
create table transport_vehicle_historical_profits(company_id uuid,business_unit_id uuid,month date,net_profit numeric,source_journal_line_id uuid);
create function post_journal_entry(p_id uuid) returns jsonb language plpgsql as $$begin
 if (select sum(debit-credit) from journal_lines where entry_id=p_id)<>0 then raise exception 'unbalanced';end if;
 update journal_entries set status='posted' where id=p_id and status='draft';
 return jsonb_build_object('status','posted');end$$;
insert into companies values('${c}','SAR');insert into business_units values('${b}','${c}',true,'transport');
insert into chart_of_accounts values
('${gl}','${c}','August Undistributed Profit','3001','equity','owners_equity',true,false,true),
('${retained}','${c}','Retained Earnings','3002','equity','owners_equity',true,false,true),
('${p1}','${c}','Partner A Current','3003','equity','owners_equity',true,false,true),
('${p2}','${c}','Partner B Current','3004','equity','owners_equity',true,false,true);
insert into transport_profit_distribution_rules values('${rule}','${c}','${b}','fixed_percentage','configured','2026-08-01','[]');
insert into transport_profit_distribution_rule_partners values
('${rule}','${c}','${b}','${p1}','Partner A','a',50),('${rule}','${c}','${b}','${p2}','Partner B','b',50);
insert into journal_entries(id,company_id,business_unit_id,entry_date,status,source_document_type) values('${id(10)}','${c}','${b}','2026-09-01','posted','cutover_opening_balances');
insert into journal_lines(id,entry_id,company_id,business_unit_id,account_id,debit,credit) values
('${id(11)}','${id(10)}','${c}','${b}','${gl}',0,100),('${id(12)}','${id(10)}','${c}','${b}','${gl}',20,0),('${id(13)}','${id(10)}','${c}','${b}','${gl}',0,10);
insert into transport_vehicle_historical_profits values('${c}','${b}','2026-08-01',100,'${id(11)}'),('${c}','${b}','2026-08-01',-20,'${id(12)}');`);
for(const filename of ['20261008204640_transport_profit_fixed_month_posting.sql','20261009001000_transport_profit_retained_earnings_balance_guard.sql',readdirSync(new URL('../migrations/',import.meta.url)).find(n=>n.endsWith('_transport_historical_profit_distribution_source.sql'))])
 await db.exec(readFileSync(new URL('../migrations/'+filename,import.meta.url),'utf8'));
let checks=0;
async function rejects(sql,pattern){await assert.rejects(db.query(sql),pattern);checks++;}
const source=await db.query("select * from transport_profit_month_source('2026-08-01')");assert.equal(Number(source.rows[0].net_profit),80);assert.equal(Number(source.rows[0].line_count),2);checks++;
const state=(await db.query("select transport_profit_month_status('2026-08-01') s")).rows[0].s;assert.equal(state.source_kind,'historical_opening');assert.equal(state.source_gl_account_id,gl);checks++;
await db.query("select transport_profit_month_save_draft('2026-08-01',70,0,'reviewed opening evidence')");
await rejects("select transport_profit_month_approve('2026-08-01')",/exact net/);
await db.query("select transport_profit_month_save_draft('2026-08-01',80,0,'reviewed opening evidence')");await db.query("select transport_profit_month_approve('2026-08-01')");
await db.exec(`update journal_lines set debit=100 where id='${id(11)}';`);
await rejects("select transport_profit_month_post('2026-08-01')",/source evidence/);
await db.exec(`update journal_lines set debit=0 where id='${id(11)}';insert into accounting_periods values('${c}','closed','2026-09-01','2026-09-30');`);
await rejects("select transport_profit_month_post('2026-08-01')",/period closed/i);
await db.exec('delete from accounting_periods');
await db.exec(`insert into journal_entries(id,company_id,business_unit_id,entry_date,status) values('${id(14)}','${c}','${b}','2026-09-01','posted');insert into journal_lines(entry_id,company_id,business_unit_id,account_id,debit,credit) values('${id(14)}','${c}','${b}','${gl}',50,0);`);
await rejects("select transport_profit_month_post('2026-08-01')",/source equity balance/);
await db.exec(`delete from journal_lines where entry_id='${id(14)}';delete from journal_entries where id='${id(14)}';`);
const posted=(await db.query("select transport_profit_month_post('2026-08-01') s")).rows[0].s;
const lines=await db.query('select account_id,debit,credit from journal_lines where entry_id=$1 order by debit desc',[posted.journal_entry_id]);
assert.equal(lines.rows[0].account_id,gl);assert.equal(Number(lines.rows[0].debit),80);assert.equal(lines.rows.length,3);assert.equal(Number(lines.rows[1].credit),40);checks++;
const day=(await db.query('select entry_date::text posting_day from journal_entries where id=$1',[posted.journal_entry_id])).rows[0].posting_day;assert.equal(day,'2026-09-01');checks++;
await rejects("select transport_profit_month_post('2026-08-01')",/Only approved/);
assert.equal(Number((await db.query('select sum(credit-debit) n from journal_lines where account_id=$1',[gl])).rows[0].n),10);checks++;
assert.equal(Number((await db.query("select sum(net_profit) n from transport_vehicle_historical_profits")).rows[0].n),80);checks++;
// The operating-month route retains its existing equity-balance safeguard.
await db.exec(`insert into chart_of_accounts values('${id(20)}','${c}','Transport Income','4001','income','sales',true,false,true),('${id(21)}','${c}','Fuel Expense','5001','expense','fuel',true,false,true);
insert into journal_entries(id,company_id,business_unit_id,entry_date,status) values('${id(22)}','${c}','${b}','2026-09-20','posted');
insert into journal_lines(entry_id,company_id,business_unit_id,account_id,debit,credit) values('${id(22)}','${c}','${b}','${id(20)}',0,100),('${id(22)}','${c}','${b}','${id(21)}',20,0);`);
assert.equal(Number((await db.query("select * from transport_profit_month_source('2026-09-01')")).rows[0].net_profit),80);checks++;
await db.query("select transport_profit_month_save_draft('2026-09-01',80,0,'reviewed September income expense')");await db.query("select transport_profit_month_approve('2026-09-01')");
await rejects("select transport_profit_month_post('2026-09-01')",/source equity balance/);
await db.exec("set test.company='00000000-0000-0000-0000-000000000099'");
await rejects("select * from transport_profit_month_source('2026-08-01')",/Active Transport business/);
await db.exec(`set test.company='${c}';set test.allowed='false'`);
await rejects("select transport_profit_month_source('2026-08-01')",/permissions required/);
assert.equal((await db.query("select has_function_privilege('authenticated','transport_profit_historical_source(date)','EXECUTE') allowed")).rows[0].allowed,false);checks++;
await db.close();console.log('PASS',checks,'isolated checks: source, loss offset, exact allocation, immutable evidence, posting date, closed period, insufficient balance, balanced partner credits, retry, preserved history, tenant scope and permissions.');
