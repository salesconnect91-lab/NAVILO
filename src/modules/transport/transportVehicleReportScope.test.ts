import {describe,expect,it} from 'vitest';
import {isCompanyFleetTrip,normalizeOwner} from './transportVehicleReportScope';

const companies=[
  {name:'Twakkal Al Khaleej', own:'TWAKKAL'},
  {name:'Orbit - Usman Sajjad', own:'ORBIT'},
  {name:'GONDAL TRANSPORT', own:'GONDAL'},
];
describe('shared Transport company-fleet reporting',()=>{
  it.each(companies)('recognizes $name own fleet without a tenant ID',({name,own})=>{
    expect(isCompanyFleetTrip(own,null,name)).toBe(true);
    expect(isCompanyFleetTrip(name,null,name)).toBe(true);
    expect(isCompanyFleetTrip('SELF',null,name)).toBe(true);
    expect(isCompanyFleetTrip('', 'company',name)).toBe(true);
  });
  it.each(companies)('keeps $name supplier/partner trips out of company fleet',({name})=>{
    expect(isCompanyFleetTrip('Supplier A','company',name)).toBe(false);
    expect(isCompanyFleetTrip('Partner A','company',name)).toBe(false);
    expect(isCompanyFleetTrip('', 'supplier',name)).toBe(false);
    expect(isCompanyFleetTrip('SELF','partner',name)).toBe(false);
    expect(isCompanyFleetTrip('',null,name)).toBe(false);
  });
  it('never attributes one Transport company trip to another company',()=>{
    for(const company of companies){
      for(const other of companies.filter(c=>c.name!==company.name)){
        expect(isCompanyFleetTrip(other.own,null,company.name)).toBe(false);
        expect(isCompanyFleetTrip(other.name,null,company.name)).toBe(false);
      }
    }
  });
  it('supports normalized names but rejects ambiguous generic name prefixes',()=>{
    expect(normalizeOwner('  Orbit - Usman  Sajjad  ')).toBe('orbit usman sajjad');
    expect(isCompanyFleetTrip('TRANSPORT',null,'Transport Service LLC')).toBe(false);
    expect(isCompanyFleetTrip('SAUDI',null,'Saudi Company')).toBe(false);
  });
});
