import { Routes, Route } from "react-router-dom";
import Items from "./Items";
import Categories from "./Categories";
import Customers from "./Customers";
import Suppliers from "./Suppliers";
import Warehouses from "./Warehouses";
import Uom from "./Uom";
import Transporters from "./Transporters";
import Employees from "./Employees";
import MasterRecordDetail from "./MasterRecordDetail";

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
      </Routes>
    </div>
  );
}
