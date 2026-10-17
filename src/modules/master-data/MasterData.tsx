import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import Items from "./Items";
import Categories from "./Categories";
import Customers from "./Customers";
import Suppliers from "./Suppliers";
import Warehouses from "./Warehouses";
import Uom from "./Uom";
import Transporters from "./Transporters";
import Employees from "./Employees";
import MasterRecordDetail from "./MasterRecordDetail";
import TransportMaster from "./TransportMaster";
import TransportFoundationMaster from "./TransportFoundationMaster";
import TransportVehicleOwnership from "./TransportVehicleOwnership";
import { isDedicatedTransportContext } from "@/lib/transportMasterContext";
import type { ReactNode } from "react";

function TransportMasterOnly({children}:{children:ReactNode}) {
  const { activeCompany, activeBusinessUnit } = useAuth();
  return isDedicatedTransportContext(activeCompany, activeBusinessUnit) ? children : <Navigate to="/master-data" replace />;
}

export default function MasterData() {
  const { activeCompany, activeBusinessUnit } = useAuth();
  const scopeKey = `${activeCompany?.company_id}:${activeBusinessUnit?.business_unit_id}`;
  return (
    <div className="space-y-5 pb-12 max-w-7xl mx-auto font-sans" data-navilo-master-standard="true">
      <Routes key={scopeKey}>
        <Route path="/" element={<Items />} />
        <Route path="/items/:id" element={<MasterRecordDetail entity="item" />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<MasterRecordDetail entity="customer" />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/suppliers/:id" element={<MasterRecordDetail entity="supplier" />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/warehouses" element={<Warehouses />} />
        <Route path="/uom" element={<Uom />} />
        <Route path="/transporters" element={isDedicatedTransportContext(activeCompany, activeBusinessUnit) ? <Navigate to="/master-data/vehicles" replace /> : <Transporters />} />
        <Route path="/vehicles" element={<TransportMasterOnly><TransportMaster kind="vehicles" /></TransportMasterOnly>} />
        <Route path="/drivers" element={<TransportMasterOnly><TransportMaster kind="drivers" /></TransportMasterOnly>} />
        <Route path="/truck-types" element={<TransportMasterOnly><TransportFoundationMaster kind="truck_types" /></TransportMasterOnly>} />
        <Route path="/transport-locations" element={<TransportMasterOnly><TransportFoundationMaster kind="locations" /></TransportMasterOnly>} />
        <Route path="/vehicle-expense-types" element={<TransportMasterOnly><TransportFoundationMaster kind="vehicle_expense_types" /></TransportMasterOnly>} />
        <Route path="/vehicle-ownership" element={<TransportMasterOnly><TransportVehicleOwnership /></TransportMasterOnly>} />
      </Routes>
    </div>
  );
}
