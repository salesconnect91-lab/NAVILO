import {describe,expect,it} from 'vitest';
import {transportServicePrintDescription} from './transportServicePrintDescription';

describe('transportServicePrintDescription',()=>{
 it('keeps trip, date, and route while dropping repeated vehicle and driver detail from the invoice line',()=>{
  expect(transportServicePrintDescription('Transport service · 39 · 25-Oct-2026 · Riyadh → Dammam · Vehicle: ZZ-TEST-QA · Driver: QA Driver · Job/PO/DO: QA-PO · Supplier rent','transport'))
   .toBe('Trip 39 · 25-Oct-2026 · Riyadh → Dammam');
 });

 it('preserves descriptions that are not linked transport lines',()=>{
  expect(transportServicePrintDescription('Transport service · Trip 37','transport'))
   .toBe('Transport service · Trip 37');
  expect(transportServicePrintDescription('Manual delivery fee','transport_normal'))
   .toBe('Manual delivery fee');
 });
});
