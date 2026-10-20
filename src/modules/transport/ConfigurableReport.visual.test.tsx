// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";

vi.mock("@/auth/AuthContext",()=>({
  useAuth:()=>({activeCompany:{company_id:"company-1",company_name:"Synthetic Co"},
    activeBusinessUnit:{business_unit_id:"bu-1",business_unit_name:"Transport"}})
}));
vi.mock("./useTransportOutputPermissions",()=>({
  useTransportOutputPermissions:()=>({print:true,export:true})
}));
import ConfigurableReport from "./ConfigurableReport";

const report={title:"Synthetic trip report",description:"Sample statement",
  columns:["Trip","Amount"],rows:[["TR-1",100],["TR-2",200]]};

beforeEach(()=>localStorage.clear());
afterEach(()=>cleanup());

describe("shared configurable report headers",()=>{
  it("resizes report headers by keyboard and saves widths without touching source totals",()=>{
    const first=render(<ConfigurableReport report={report} preferenceKey="test-resize"/>);
    const handle=screen.getByRole("separator",{name:"Resize Trip column"});
    fireEvent.keyDown(handle,{key:"ArrowRight"});
    const header=handle.closest("th")!;
    expect(header.style.width).toBe("176px");
    expect(JSON.parse(localStorage.getItem("transport-report:test-resize")||"{}").widths.Trip).toBe(176);
    expect(screen.getByText("100.00")).toBeTruthy();
    expect(screen.getByText("200.00")).toBeTruthy();
    first.unmount();
    render(<ConfigurableReport report={report} preferenceKey="test-resize"/>);
    expect(screen.getByRole("columnheader",{name:/Trip/}).style.width).toBe("176px");
    expect(report.rows).toEqual([["TR-1",100],["TR-2",200]]);
  });
});
