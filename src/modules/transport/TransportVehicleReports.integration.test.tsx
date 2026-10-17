// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {TransportVehicleOperationalReport as TransportVehicleReports} from './TransportVehicleReports';

const mock=vi.hoisted(()=>({
  active:{company_id:'tw',company_name:'Twakkal Al Khaleej',business_unit_id:'tw-bu'},
  queries:[] as Array<{table:string;company:string;unit:string}>,
  requests:[] as Array<{name:string;account:string;kind:string}>,
  report:null as any,
  allowSupplier:true,
  tripCountOverride:null as number | null,
}));
const companies=[
  {company_id:'tw',company_name:'Twakkal Al Khaleej',business_unit_id:'tw-bu',owner:'TWAKKAL'},
  {company_id:'or',company_name:'Orbit - Usman Sajjad',business_unit_id:'or-bu',owner:'ORBIT'},
  {company_id:'go',company_name:'GONDAL TRANSPORT',business_unit_id:'go-bu',owner:'GONDAL'},
];
const ownOwner=(id:string)=>companies.find(company=>company.company_id===id)?.owner??'UNKNOWN';
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({
  activeCompany:{company_id:mock.active.company_id,company_name:mock.active.company_name},
  activeBusinessUnit:{business_unit_id:mock.active.business_unit_id,business_unit_name:'Transport'},
})}));
vi.mock('@/lib/supabase',()=>({supabase:{
  from:(table:string)=>{
    const filters:Record<string,string>={};
    const q:any={
      select:()=>q,order:()=>q,
      eq:(key:string,value:string)=>{filters[key]=value;return q;},
      ilike:()=>q,
      range:async()=>{
        const company=filters.company_id??'';
        mock.queries.push({table,company,unit:filters.business_unit_id??''});
        const data=table==='transport_vehicles'
          ? [
            {id:company+'-own',vehicle_no:company+'-PLATE',owner_type:'company'},
            {id:company+'-hired',vehicle_no:company+'-HIRE',owner_type:'supplier'},
          ]
          : [{vehicle_id:company+'-own',owner_name_snapshot:ownOwner(company)}];
        return {data,error:null};
      },
    };
    return q;
  },
  rpc:async(name:string,args:any)=>{
    if (name==='transport_financial_read_allowed')
      return {data:args?.p_side==='customer' || mock.allowSupplier,error:null};
    mock.requests.push({name,account:String(args?.p_filters?.account),kind:String(args?.p_filters?.accountKind)});
    const id=String(args?.p_filters?.account??'').split('-')[0];
    const rows=args?.p_filters?.account===id+'-own'?[
      {id:id+'-t',trip_date:'2026-10-01',trip_no:'OWN-'+id,owner_name:ownOwner(id),
       billed_customer_net:1000,billed_supplier_net:200,customer_received_gross:500},
      {id:id+'-s',trip_date:'2026-10-02',trip_no:'SUPPLIER-'+id,owner_name:'Supplier LLC',
       ownership_class:'supplier',billed_customer_net:5000,billed_supplier_net:4000},
    ]:[{id:id+'-h',trip_date:'2026-10-01',trip_no:'HIRE-'+id,owner_name:'Supplier LLC',
       ownership_class:'supplier',billed_customer_net:300,billed_supplier_net:250}];
    return {data:{rows,count:mock.tripCountOverride ?? rows.length},error:null};
  },
}}));
vi.mock('./ConfigurableReport',()=>({default:({report}:any)=>{
  mock.report=report;
  return <div data-testid="vehicle-report-preview">{report.title}</div>;
}}));
vi.mock('@/components/NaviloDateInput',()=>({default:({value,onChange,...props}:any)=>
  <input aria-label="Trip date" type="date" value={value} onChange={event=>onChange(event.target.value)} {...props} />
}));
beforeEach(()=>{
  mock.active={company_id:'tw',company_name:'Twakkal Al Khaleej',business_unit_id:'tw-bu'};
  mock.queries=[];mock.requests=[];mock.report=null;mock.allowSupplier=true;mock.tripCountOverride=null;
});
afterEach(cleanup);
async function selectVehicle(id:string){
  await waitFor(()=>expect(screen.getByRole('option',{name:id+'-PLATE'})).toBeTruthy());
  fireEvent.change(screen.getByRole('combobox',{name:'Vehicle for report'}),{target:{value:id+'-own'}});
  await screen.findByTestId('vehicle-report-preview');
  await waitFor(()=>expect(mock.report.rows.some((row:any[])=>row[1]==='OWN-'+id)).toBe(true));
}

describe('Transport vehicle report UI: common behavior in all companies',()=>{
  it.each(companies)('scopes $company_name vehicle list and linked Trip ledger',async company=>{
    mock.active={company_id:company.company_id,company_name:company.company_name,business_unit_id:company.business_unit_id};
    render(<TransportVehicleReports/>);
    await selectVehicle(company.company_id);
    expect(mock.queries.length).toBeGreaterThan(0);
    expect(mock.queries.every(q=>q.company===company.company_id&&q.unit===company.business_unit_id)).toBe(true);
    expect(mock.requests).toContainEqual({
      name:'transport_trip_report',account:company.company_id+'-own',kind:'vehicle',
    });
    expect(mock.report.rows).toHaveLength(2); // one own Trip + total; supplier Trip excluded
    expect(mock.report.rows[0][1]).toBe('OWN-'+company.company_id);
    expect(mock.report.rows.some((r:any[])=>r[1]==='SUPPLIER-'+company.company_id)).toBe(false);
    expect(mock.report.rows.at(-1)[8]).toBe(1000); // revenue, excludes supplier Trip
    expect(mock.report.description).toContain(company.company_name);
  });
  it('all-vehicles view shows hired operations without changing company identity',async()=>{
    render(<TransportVehicleReports/>);
    await selectVehicle('tw');
    fireEvent.change(screen.getByRole('combobox',{name:'Vehicle scope'}),{target:{value:'all'}});
    await selectVehicle('tw');
    await waitFor(()=>expect(mock.report.rows.some((row:any[])=>row[1]==='SUPPLIER-tw')).toBe(true));
    expect(mock.report.rows.at(-1)[8]).toBe(6000);
    expect(mock.queries.every(q=>q.company==='tw')).toBe(true);
  });
  it.each([50001,10])('never renders partial vehicle profit when the server count is %i',async count=>{
    mock.tripCountOverride=count;
    render(<TransportVehicleReports/>);
    await waitFor(()=>expect(screen.getByRole('option',{name:'tw-PLATE'})).toBeTruthy());
    fireEvent.change(screen.getByRole('combobox',{name:'Vehicle for report'}),{target:{value:'tw-own'}});
    const alert=await screen.findByRole('alert');
    expect(alert.textContent).toMatch(count>50000?/Narrow the Trip date range/:/incomplete Trips/);
    expect(screen.queryByTestId('vehicle-report-preview')).toBeNull();
    expect(mock.report).toBeNull();
  });
  it('never presents false vehicle profit when Supplier financial access is denied',async()=>{
    mock.allowSupplier=false;
    render(<TransportVehicleReports/>);
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('both Customer and Supplier');
    expect(screen.queryByRole('combobox',{name:'Vehicle for report'})).toBeNull();
    expect(mock.requests.filter(r=>r.name==='transport_trip_report')).toHaveLength(0);
    expect(mock.queries).toHaveLength(0);
  });
  it('switches workspaces without keeping the earlier company vehicle selection',async()=>{
    const view=render(<TransportVehicleReports/>);
    await selectVehicle('tw');
    mock.active={company_id:'or',company_name:'Orbit - Usman Sajjad',business_unit_id:'or-bu'};
    view.rerender(<TransportVehicleReports/>);
    await waitFor(()=>expect(screen.getByRole('option',{name:'or-PLATE'})).toBeTruthy());
    expect((screen.getByRole('combobox',{name:'Vehicle for report'}) as HTMLSelectElement).value).toBe('');
    expect(screen.queryByRole('option',{name:'tw-PLATE'})).toBeNull();
    await selectVehicle('or');
    expect(mock.report.description).toContain('Orbit - Usman Sajjad');
    expect(mock.report.rows.some((r:any[])=>r[1]==='OWN-tw')).toBe(false);
    expect(mock.queries.some(q=>q.company==='or'&&q.unit==='or-bu')).toBe(true);
  });
});
