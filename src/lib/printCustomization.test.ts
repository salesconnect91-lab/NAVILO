// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {customizePrintHtml,printTableSelections} from './printCustomization';
const parse=(html:string)=>new DOMParser().parseFromString(html,'text/html');

describe('print column customization',()=>{
  it('selects columns independently for every table and keeps full rows, amounts and notes',()=>{
    const html='<h1>Statement</h1><p>October 2026</p><table><thead><tr><th>Date</th><th>Description</th><th>Debit</th><th>Credit</th></tr></thead><tbody><tr><td>01-Oct</td><td>Waiting charges</td><td>400</td><td>0</td></tr><tr><td>02-Oct</td><td>Payment</td><td>0</td><td>100</td></tr></tbody><tfoot><tr><td colspan="2">Total</td><td>400</td><td>100</td></tr></tfoot></table><table><thead><tr><th>Account</th><th>Balance</th></tr></thead><tbody><tr><td>Usman</td><td>300</td></tr></tbody></table><p>Approved note</p>';
    const selections=printTableSelections(html);selections[0].columns[0].selected=false;
    const doc=parse(customizePrintHtml(html,selections));const tables=doc.querySelectorAll('table');
    expect(tables[0].tHead!.textContent).toBe('DescriptionDebitCredit');expect(tables[0].tBodies[0].rows).toHaveLength(2);
    expect(tables[0].tFoot!.rows[0].cells[0].colSpan).toBe(1);expect(tables[0].tFoot!.textContent).toBe('Total400100');
    expect(tables[1].textContent).toContain('Usman300');expect(doc.body.textContent).toContain('Approved note');
    expect(parse(customizePrintHtml(html,printTableSelections(html))).querySelectorAll('th')).toHaveLength(6);
  });
  it('projects grouped headings, row spans, totals and empty states without shifting columns',()=>{
    const html='<table><colgroup><col width="80"><col><col></colgroup><thead><tr><th rowspan="2">Party</th><th colspan="2">Movement</th></tr><tr><th>Debit</th><th>Credit</th></tr></thead><tbody><tr><td rowspan="2">Orbit</td><td>12</td><td>3</td></tr><tr><td>14</td><td>5</td></tr><tr><td colspan="3">No more entries</td></tr></tbody><tfoot><tr><td>Total</td><td>26</td><td>8</td></tr></tfoot></table>';
    const selections=printTableSelections(html);expect(selections[0].columns.map(c=>c.label)).toEqual(['Party','Movement / Debit','Movement / Credit']);
    selections[0].columns[1].selected=false;
    const table=parse(customizePrintHtml(html,selections)).querySelector('table')!;
    expect(table.tHead!.textContent).toBe('PartyMovementCredit');expect(table.tHead!.rows[0].cells[1].colSpan).toBe(1);
    expect(table.tBodies[0].rows[0].textContent).toBe('Orbit3');expect(table.tBodies[0].rows[1].textContent).toBe('5');
    expect(table.tBodies[0].rows[2].cells[0].colSpan).toBe(2);expect(table.tFoot!.textContent).toBe('Total8');expect(table.querySelector('colgroup')).toBeNull();
  });
  it('respects initially hidden columns and refuses an empty selection',()=>{
    const html='<table><thead><tr><th>Account</th><th style="display:none">Internal ID</th></tr></thead><tbody><tr><td>Bank</td><td>abc</td></tr></tbody></table>';
    const selections=printTableSelections(html);expect(selections[0].columns[1].selected).toBe(false);
    expect(parse(customizePrintHtml(html,selections)).querySelector('table')!.textContent).toBe('AccountBank');
    selections[0].columns[0].selected=false;
    expect(parse(customizePrintHtml(html,selections)).querySelectorAll('th')).toHaveLength(2);
  });
});
