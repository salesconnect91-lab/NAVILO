import { Routes, Route } from "react-router-dom";
import WorkOrderList from "./WorkOrderList";
import WorkOrderDetail from "./WorkOrderDetail";
import FurnaceYield from "./FurnaceYield";
import ManufacturingCore from "./ManufacturingCore";

export default function Production() {
  return (
    <div className="space-y-4">
      <Routes>
        <Route path="/" element={<WorkOrderList />} />
        <Route path="/yields" element={<FurnaceYield />} />
        <Route path="/core" element={<ManufacturingCore />} />
        <Route path="/:id" element={<WorkOrderDetail />} />
      </Routes>
    </div>
  );
}
