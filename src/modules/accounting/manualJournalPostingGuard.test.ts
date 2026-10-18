import {describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';

describe('Isolated PostgreSQL manual Journal non-billing posting guard',()=>{
  it('rejects direct income/expense/VAT and keeps legitimate document journals postable',async()=>{
    const db=await PGlite.create();
    const cid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const acc={
      bank:'00000000-0000-0000-0000-000000000001',
      income:'00000000-0000-0000-0000-000000000002',
      expense:'00000000-0000-0000-0000-000000000003',
      vat:'00000000-0000-0000-0000-000000000004'
    };
    let seq=0;
    const uuid=()=>`bbbbbbbb-bbbb-bbbb-bbbb-${String(++seq).padStart(12,'0')}`;
    try{
      await db.exec(`
        create table public.journal_entries(
          id uuid primary key,company_id uuid not null,status text not null,trans_type text,
          source_module text,source_document_type text,source_document_id uuid,
          reversal_of_entry_id uuid
        );
        create table public.chart_of_accounts(
          id uuid primary key,company_id uuid not null,type text not null,code text,name text
        );
        create table public.journal_lines(
          entry_id uuid not null,company_id uuid not null,account_id uuid not null
        );
        create table public.account_mappings(
          company_id uuid not null,account_id uuid not null,mapping_key text
        );
        insert into public.chart_of_accounts values
        ('${acc.bank}','${cid}','asset','1110','Bank'),
        ('${acc.income}','${cid}','revenue','4100','Sales Revenue'),
        ('${acc.expense}','${cid}','expense','6100','Rent'),
        ('${acc.vat}','${cid}','asset','9999','Tax Control');
        insert into public.account_mappings values ('${cid}','${acc.vat}','input_vat');
      `);
      const migration=fs.readFileSync('supabase/migrations/20261018230500_guard_manual_journal_nonbilling_post.sql','utf8');
      await db.exec(migration);
      const post=async(accountId:string,source=false,reversal=false)=>{
        const id=uuid();
        const sourceId=source?uuid():null;
        await db.query(
          'insert into public.journal_entries(id,company_id,status,source_module,source_document_type,source_document_id,reversal_of_entry_id) values ($1,$2,$3,$4,$5,$6,$7)',
          [id,cid,'draft',source?'purchase':null,source?'purchase_invoice':null,sourceId,reversal?uuid():null]);
        await db.query('insert into public.journal_lines(entry_id,company_id,account_id) values($1,$2,$3)',[id,cid,accountId]);
        await db.query("update public.journal_entries set status='posted' where id=$1",[id]);
        return id;
      };
      await expect(post(acc.bank)).resolves.toBeTruthy();
      await expect(post(acc.income)).rejects.toThrow(/Manual journals cannot post Income/);
      await expect(post(acc.expense)).rejects.toThrow(/Manual journals cannot post Income/);
      await expect(post(acc.vat)).rejects.toThrow(/Manual journals cannot post Income/);
      await expect(post(acc.income,true)).resolves.toBeTruthy();
      await expect(post(acc.expense,true)).resolves.toBeTruthy();
      await expect(post(acc.vat,true)).resolves.toBeTruthy();
      await expect(post(acc.expense,false,true)).resolves.toBeTruthy();

      // The Data API authenticated role cannot impersonate a source document.
      await db.exec('create role authenticated; grant insert on public.journal_entries to authenticated; set role authenticated;');
      const forgedId=uuid();
      try {
        await expect(db.query(
          'insert into public.journal_entries(id,company_id,status,source_module,source_document_type,source_document_id) values ($1,$2,$3,$4,$5,$6)',
          [forgedId,cid,'draft','sales','sales_invoice',uuid()]
        )).rejects.toThrow(/Source-document references cannot be supplied/);
      } finally { await db.exec('reset role'); }
    }finally{await db.close();}
  });
});
