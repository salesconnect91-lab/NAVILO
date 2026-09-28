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

function TransportMasterOnly({kind}:{kind:"vehicles"|"drivers"}) {
  const { activeCompany, activeBusinessUnit } = useAuth();
  const companyAllowed = activeCompany?.enabled_modules?.includes("transport") ?? false;
  const unitAllowed = activeBusinessUnit?.enabled_modules?.includes("transport") ?? false;
  const transportUnit = activeBusinessUnit?.business_unit_type === "transport";
  return companyAllowed && unitAllowed && transportUnit ? <TransportMaster kind={kind} /> : <Navigate to="/master-data" replace />;
}

export default function MasterData() {
  return (
    <div className="space-y-5 pb-12 max-w-7xl mx-auto font-sans" data-navilo-master-standard="true">
      <Routes>
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
        <Route path="/transporters" element={<Transporters />} />
        <Route path="/vehicles" element={<TransportMasterOnly kind="vehicles" />} />
        <Route path="/drivers" element={<TransportMasterOnly kind="drivers" />} />
      </Routes>
    </div>
  );
}
