import TransportVehicleAccountingReport from './TransportVehicleAccountingReport';
import SearchableSelect from '@/components/SearchableSelect';
import {useEffect, useMemo, useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import NaviloDateInput from '@/components/NaviloDateInput';
import {formatNaviloDate} from '@/lib/naviloDate';
import ConfigurableReport from './ConfigurableReport';
import type {ReportTable} from './transportPartyExport';
import {isCompanyFleetTrip, normalizeOwner} from './transportVehicleReportScope';

type Vehicle = {id: string; vehicle_no: string; owner_type?: string | null; ownership_type?: string | null};
type FinancialTrip = Record<string, any>;
type ReportMode = 'ledger' | 'profit';
type FleetScope = 'owned' | 'all';
const number = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value: number) => value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const contribution = (trip: FinancialTrip) =>
  number(trip.billed_customer_net) - number(trip.billed_supplier_net) -
  number(trip.driver_accrued) - number(trip.other_cost_net);

/**
 * A trip-date operational statement, not a substitute for the dated GL P&L.
 * Imported source values and unposted commercial rates are intentionally not
 * added to posted sales or purchases. The backend scopes each request by the
 * authenticated company, business unit, branch and finance permissions.
 */
export default function TransportVehicleReports(){
 const [basis,setBasis]=useState<'accounting'|'trips'>('accounting');
 return <div className="space-y-2"><div className="flex gap-2"><button className={basis==='accounting'?'btn-primary':'btn'} onClick={()=>setBasis('accounting')}>Posted Vehicle Ledger &amp; P&amp;L</button><button className={basis==='trips'?'btn-primary':'btn'} onClick={()=>setBasis('trips')}>Trip Operations</button></div>{basis==='accounting'?<TransportVehicleAccountingReport/>:<TransportVehicleOperationalReport/>}</div>;
}
export function TransportVehicleOperationalReport() {
  const {activeCompany, activeBusinessUnit} = useAuth();
  const companyId = activeCompany?.company_id;
  const businessUnitId = activeBusinessUnit?.business_unit_id;
  const companyName = activeCompany?.company_name ?? '';
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesError, setVehiclesError] = useState('');
  const [unmappedCompanyTrips, setUnmappedCompanyTrips] = useState(0);
  const [fleetScope, setFleetScope] = useState<FleetScope>('owned');
  const [ownedVehicleIds, setOwnedVehicleIds] = useState<Set<string>>(new Set());
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mode, setMode] = useState<ReportMode>('ledger');
  const [rawRows, setRows] = useState<FinancialTrip[]>([]);
  // Fleet scope is presentation-only: switching it must not rerun the expensive report RPC.
  const rows = useMemo(() => fleetScope === 'owned'
    ? rawRows.filter(trip => isCompanyFleetTrip(trip.owner_name, trip.ownership_class, companyName))
    : rawRows, [rawRows, fleetScope, companyName]);
  // Distinguish a verified empty vehicle report from one not yet loaded.
  // Never flash zero totals before async rows arrive or after a failed read.
  const [loadedSelectionKey, setLoadedSelectionKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [financialAccess, setFinancialAccess] = useState<'checking'|'allowed'|'denied'>('checking');
  const selectionKey = JSON.stringify([companyId, businessUnitId, vehicleId, from, to, financialAccess]);

  useEffect(() => {
    let cancelled = false;
    setFinancialAccess('checking');
    setError('');
    if (!companyId || !businessUnitId) {
      setFinancialAccess('denied');
      return;
    }
    void (async () => {
      try {
        // A P&L cannot be calculated with either side silently masked by the
        // canonical financial RPC. Require both view grants before reporting.
        const [customer, supplier] = await Promise.all([
          supabase.rpc('transport_financial_read_allowed', {p_side:'customer'}),
          supabase.rpc('transport_financial_read_allowed', {p_side:'supplier'}),
        ]);
        if (customer.error) throw customer.error;
        if (supplier.error) throw supplier.error;
        if (!cancelled) setFinancialAccess(customer.data === true && supplier.data === true ? 'allowed' : 'denied');
      } catch (reason) {
        if (!cancelled) {
          setFinancialAccess('denied');
          setError(reason instanceof Error ? reason.message : 'Unable to verify financial permissions.');
        }
      }
    })();
    return () => {cancelled = true;};
  }, [companyId, businessUnitId]);

  useEffect(() => {
    let disposed = false;
    setVehicles([]);
    setVehicleId('');
    setVehiclesError('');
    setUnmappedCompanyTrips(0);
    setOwnedVehicleIds(new Set());
    if (!companyId || !businessUnitId || financialAccess !== 'allowed') return;
    void (async () => {
      try {
        const all: Vehicle[] = [];
        for (let offset = 0; offset < 10000; offset += 500) {
          const result = await supabase.from('transport_vehicles')
            .select('id,vehicle_no,owner_type,ownership_type').eq('company_id', companyId)
            .eq('business_unit_id', businessUnitId)
            .order('vehicle_no', {ascending: true}).range(offset, offset + 499);
          if (result.error) throw result.error;
          const batch = (result.data ?? []) as Vehicle[];
          all.push(...batch);
          if (batch.length < 500) break;
        }
        // Recover imported company-owned vehicle IDs when older Trips have no
        // ownership-history row. Only use the logged-in company's own data.
        const ownedIds = new Set(all.filter(vehicle =>
          ['company', 'company_owned', 'owned', 'self'].includes(vehicle.owner_type ?? '') ||
          ['company', 'company_owned', 'owned', 'self'].includes(vehicle.ownership_type ?? '')
        ).map(vehicle => vehicle.id));
        let unassigned = 0;
        const firstName = normalizeOwner(companyName).split(' ')[0];
        if (firstName && firstName.length >= 5 && !['transport', 'company', 'saudi', 'rental'].includes(firstName)) {
          for (let offset = 0; offset < 50000; offset += 500) {
            const result = await supabase.from('transport_trips')
              .select('vehicle_id,owner_name_snapshot')
              .eq('company_id', companyId).eq('business_unit_id', businessUnitId)
              .ilike('owner_name_snapshot', firstName + '%')
              .order('id', {ascending: true}).range(offset, offset + 499);
            if (result.error) throw result.error;
            const batch = result.data ?? [];
            for (const trip of batch) {
              if (!isCompanyFleetTrip(trip.owner_name_snapshot, null, companyName)) continue;
              if (trip.vehicle_id) ownedIds.add(trip.vehicle_id);
              else unassigned++;
            }
            if (batch.length < 500) break;
          }
        }
        if (!disposed) {
          setVehicles(all);
          setOwnedVehicleIds(ownedIds);
          setUnmappedCompanyTrips(unassigned);
        }
      } catch (reason) {
        if (!disposed) setVehiclesError(reason instanceof Error ? reason.message : 'Unable to load vehicles.');
      }
    })();
    return () => {disposed = true;};
  }, [companyId, businessUnitId, companyName, financialAccess]);

  useEffect(() => {
    let disposed = false;
    setRows([]);
    setError('');
    setLoadedSelectionKey('');
    if (!vehicleId || !companyId || !businessUnitId || financialAccess !== 'allowed') {
      setLoading(false);
      return;
    }
    if (from && to && from > to) {
      setError('From date must be on or before To date.');
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const all: FinancialTrip[] = [];
        const maxReportRows = 50000;
        let expectedCount: number | null = null;
        const filters = {from, to, search: '', posting: 'all', account: vehicleId, accountKind: 'vehicle'};
        for (let offset = 0; offset < maxReportRows; offset += 500) {
          const {data, error: requestError} = await supabase.rpc('transport_trip_report', {
            p_side: 'customer', p_limit: 500, p_offset: offset, p_filters: filters,
          });
          if (requestError) throw requestError;
          const result = data as {rows?: FinancialTrip[]; count?: number} | null;
          const count = Number(result?.count);
          if (!Number.isSafeInteger(count) || count < 0) {
            throw new Error('Vehicle report returned an invalid Trip count. Retry the report.');
          }
          if (expectedCount === null) {
            expectedCount = count;
            if (count > maxReportRows) {
              throw new Error('Vehicle has more than 50,000 Trips. Narrow the Trip date range to avoid incomplete totals.');
            }
          } else if (count !== expectedCount) {
            throw new Error('Vehicle Trips changed during report loading. Reopen the report for consistent totals.');
          }
          const batch = result?.rows ?? [];
          all.push(...batch);
          if (batch.length < 500 || all.length >= count) break;
        }
        if (all.length !== expectedCount) {
          throw new Error('Vehicle report returned incomplete Trips. Reopen the report; totals were not displayed.');
        }
        // Company fleet excludes supplier/partner Trips sharing the plate.
        // "All vehicles" includes them for operational profitability analysis.
        if (!disposed) {
          setRows(all);
          setLoadedSelectionKey(selectionKey);
        }
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : 'Unable to read vehicle trips.');
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {disposed = true;};
  }, [vehicleId, companyId, businessUnitId, from, to, financialAccess, selectionKey]);

  const matching = useMemo(() => {
    const search = vehicleSearch.trim().toLowerCase();
    const eligible = fleetScope === 'owned' ? vehicles.filter(vehicle => ownedVehicleIds.has(vehicle.id)) : vehicles;
    const found = search ? eligible.filter(vehicle => vehicle.vehicle_no.toLowerCase().includes(search)) : eligible;
    const limited = found.slice(0, 100);
    const selected = vehicles.find(vehicle => vehicle.id === vehicleId);
    if (selected && !limited.some(vehicle => vehicle.id === selected.id)) return [selected, ...limited];
    return limited;
  }, [vehicles, vehicleSearch, vehicleId, fleetScope, ownedVehicleIds]);

  const selectedVehicle = vehicles.find(vehicle => vehicle.id === vehicleId);
  const chronological = useMemo(() => [...rows].sort((a, b) =>
    String(a.trip_date ?? '').localeCompare(String(b.trip_date ?? '')) ||
    String(a.trip_no ?? '').localeCompare(String(b.trip_no ?? ''))), [rows]);

  const totals = useMemo(() => chronological.reduce((total, trip) => {
    total.revenue += number(trip.billed_customer_net);
    total.supplier += number(trip.billed_supplier_net);
    total.driver += number(trip.driver_accrued);
    total.other += number(trip.other_cost_net);
    total.received += number(trip.customer_received_gross);
    total.paid += number(trip.supplier_paid_gross ?? trip.payment_amount);
    total.sourceCustomer += number(trip.source_customer_net);
    total.sourceSupplier += number(trip.source_supplier_net);
    total.agreedCustomer += number(trip.customer_rate);
    total.agreedSupplier += number(trip.agreed_supplier_rent);
    return total;
  }, {
    revenue: 0, supplier: 0, driver: 0, other: 0, received: 0, paid: 0,
    sourceCustomer: 0, sourceSupplier: 0, agreedCustomer: 0, agreedSupplier: 0,
  }), [chronological]);
  const cost = totals.supplier + totals.driver + totals.other;
  const profit = totals.revenue - cost;
  const margin = totals.revenue ? profit / totals.revenue * 100 : 0;
  const reportDescription =
    `${activeCompany?.company_name ?? ''} / ${activeBusinessUnit?.business_unit_name ?? ''} · ${selectedVehicle?.vehicle_no ?? 'Vehicle'} · ${fleetScope === 'owned' ? 'Company fleet Trips only' : 'All vehicle Trips'} · Trip dates ${from ? formatNaviloDate(from) : 'Beginning'} to ${to ? formatNaviloDate(to) : 'All'} · ${rows.length} Trips. Operational trip-date basis; not the dated General Ledger P&L. Source-import amounts and unposted agreed rates are excluded from linked revenue/cost; VAT is excluded.`;

  const ledger: ReportTable = useMemo(() => {
    let running = 0;
    const lines = chronological.map(trip => {
      const net = contribution(trip);
      running += net;
      return [
        formatNaviloDate(trip.trip_date), trip.trip_no ?? '', trip.customer_name ?? '',
        trip.owner_name ?? '', trip.ownership_class ?? 'Unattributed',
        `${trip.from_location ?? ''} → ${trip.to_location ?? ''}`,
        trip.customer_invoice_ref ?? '', trip.supplier_invoice_ref ?? '',
        number(trip.billed_customer_net), number(trip.billed_supplier_net),
        number(trip.driver_accrued), number(trip.other_cost_net), net, running,
        number(trip.customer_received_gross), number(trip.supplier_paid_gross ?? trip.payment_amount),
        number(trip.source_customer_net), number(trip.source_supplier_net),
      ];
    });
    return {
      title: `Vehicle Trip Ledger · ${selectedVehicle?.vehicle_no ?? ''}`,
      description: reportDescription + ' Running contribution begins at zero for the selected date range; it is not an AR, AP or cash balance.',
      columns: [
        'Trip Date', 'Trip No', 'Customer', 'Supplier / Owner', 'Ownership at Trip',
        'Route', 'Customer Invoice', 'Supplier Invoice', 'Linked Revenue Net',
        'Linked Supplier Cost Net', 'Driver Accrued', 'Other Posted Cost Net',
        'Trip Contribution', 'Running Contribution', 'Customer Received Gross',
        'Supplier Paid Gross', 'Imported Customer Net (memo)', 'Imported Supplier Net (memo)',
      ],
      rows: [
        ...lines,
        ['TOTAL', ...Array(7).fill(''), totals.revenue, totals.supplier, totals.driver,
          totals.other, profit, profit, totals.received, totals.paid,
          totals.sourceCustomer, totals.sourceSupplier],
      ],
    };
  }, [chronological, selectedVehicle?.vehicle_no, reportDescription, totals, profit]);

  const pnl: ReportTable = useMemo(() => ({
    title: `Vehicle Operating Profit & Loss · ${selectedVehicle?.vehicle_no ?? ''}`,
    description: reportDescription + ' Income and cost are from linked financial evidence; driver accrued is an operating cost. This is not a statutory accounting statement.',
    columns: ['Particulars', 'Amount (SAR)'],
    rows: [
      ['Linked customer revenue (net of VAT)', totals.revenue],
      ['Supplier rental / purchase cost (net)', -totals.supplier],
      ['Driver accrued cost', -totals.driver],
      ['Other posted trip expenses (net)', -totals.other],
      ['Total operating expenses', -cost],
      ['NET OPERATING CONTRIBUTION', profit],
      ['Operating margin (%)', Number(margin.toFixed(2))],
      ['Memo: imported customer source net (not posted)', totals.sourceCustomer],
      ['Memo: imported supplier source net (not posted)', totals.sourceSupplier],
      ['Memo: agreed customer rates (not posted)', totals.agreedCustomer],
      ['Memo: agreed supplier rents (not posted)', totals.agreedSupplier],
    ],
  }), [selectedVehicle?.vehicle_no, reportDescription, totals, cost, profit, margin]);

  return <section className="space-y-3">
    <h2 className="text-lg font-semibold">Vehicle Ledger &amp; P&amp;L</h2>
    {financialAccess === 'checking' && <p role="status">Checking Customer and Supplier financial permissions…</p>}
    {financialAccess === 'denied' && <p role="alert">Vehicle P&amp;L requires both Customer and Supplier financial view permissions. Incomplete cost or revenue is not shown as profit.</p>}
    {financialAccess !== 'allowed' ? null : <>
    <p className="text-xs text-slate-600">
      Reports follow the selected Transport Company / Business Unit. Company fleet
      excludes supplier- and partner-owned Trips, including those sharing the same
      plate. Switch to All vehicles when you need to analyze hired vehicles.
      Unposted/imported source amounts are shown separately.
    </p>
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs">Vehicle scope
        <SearchableSelect nativeCompatibility aria-label="Vehicle scope" className="input block" value={fleetScope}
          onChange={event => {setFleetScope(event.target.value as FleetScope); setVehicleId('');}}>
          <option value="owned">Company fleet</option>
          <option value="all">All vehicles (incl. hired)</option>
        </SearchableSelect>
      </label>
      <label className="text-xs">Find vehicle / plate
        <input aria-label="Find vehicle" className="input block min-w-44" value={vehicleSearch}
          onChange={event => setVehicleSearch(event.target.value)} placeholder="Search plate number" />
      </label>
      <label className="text-xs">Vehicle
        <SearchableSelect nativeCompatibility aria-label="Vehicle for report" className="input block min-w-52" value={vehicleId}
          onChange={event => setVehicleId(event.target.value)}>
          <option value="">Select vehicle</option>
          {matching.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicle_no}</option>)}
        </SearchableSelect>
      </label>
      <label className="text-xs">From Trip Date
        <NaviloDateInput className="input block" value={from} onChange={event => setFrom(event.target.value)} />
      </label>
      <label className="text-xs">To Trip Date
        <NaviloDateInput className="input block" value={to} onChange={event => setTo(event.target.value)} />
      </label>
    </div>
    {vehiclesError && <p role="alert" className="text-red-700">{vehiclesError}</p>}
    <p className="text-xs text-slate-600">{fleetScope === 'owned' ? ownedVehicleIds.size : vehicles.length} vehicles in the selected scope. {unmappedCompanyTrips} matched company-owner Trips have no mapped vehicle and are excluded from individual vehicle totals. No ownership Master values were changed. Clear dates to include all Trip dates.</p>
    {vehicleId && <>
      {loading || (loadedSelectionKey !== selectionKey && !error)
        ? <p role="status">Loading linked vehicle trips for the report…</p> :
        error ? <p role="alert" className="text-red-700">{error}</p> :
        <>
          <div className="flex flex-wrap gap-3 text-xs">
            <span>Trips: <strong>{rows.length}</strong></span>
            <span>Revenue: <strong>{money(totals.revenue)}</strong></span>
            <span>Cost: <strong>{money(cost)}</strong></span>
            <span>Contribution: <strong>{money(profit)}</strong></span>
            <span>Margin: <strong>{margin.toFixed(2)}%</strong></span>
          </div>
          {(totals.sourceCustomer !== 0 || totals.sourceSupplier !== 0) &&
            <p className="text-xs text-amber-800">Imported source figures exist but have not been added to posted revenue or cost. Missing posted vehicle movements must be reconciled before treating this as a complete accounting P&amp;L.</p>}
          <div className="flex gap-2">
            <button className={mode === 'ledger' ? 'btn-primary' : 'btn'} onClick={() => setMode('ledger')}>Vehicle Trip Ledger</button>
            <button className={mode === 'profit' ? 'btn-primary' : 'btn'} onClick={() => setMode('profit')}>Vehicle P&amp;L</button>
          </div>
          <ConfigurableReport key={mode} report={mode === 'ledger' ? ledger : pnl}
            preferenceKey={`${companyId}:${businessUnitId}:vehicle:${mode}`} />
          <p className="text-xs text-slate-600">Print, PDF and Excel contain the selected vehicle's complete filtered statement. This operational report is separate from the canonical General Ledger and statutory accounting Profit &amp; Loss.</p>
        </>}
    </>}
    </>}
  </section>;
}
