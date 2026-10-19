// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import DashboardExpensesCard,{expenseChange,expenseMonth,expenseSlices} from "./DashboardExpensesCard";
import {supabase} from "@/lib/supabase";

vi.mock("@/lib/supabase",()=>({supabase:{rpc:vi.fn()}}));
vi.mock("recharts",()=>({
 ResponsiveContainer:({children}:any)=><div>{children}</div>,
 PieChart:({children}:any)=><div>{children}</div>,
 Pie:({children}:any)=><div>{children}</div>,
 Cell:()=>null,Tooltip:()=>null,
}));
afterEach(()=>{cleanup();vi.clearAllMocks()});

it("selects completed calendar month and preserves previous-month comparison",()=>{
 expect(expenseMonth("last",new Date(2026,9,19))).toBe("2026-09-01");
 expect(expenseMonth("current",new Date(2026,9,19))).toBe("2026-10-01");
 expect(expenseChange(399103.05,524875.92)).toEqual({label:"-24.0% vs previous month",increased:false});
});
it("groups top four positive Expense GL categories without inventing charges",()=>{
 const rows=[{name:"Fuel",amount:50,previous_amount:40,detail_type:"Transport"},
 {name:"Salaries",amount:30,previous_amount:25,detail_type:"Salaries"},
 {name:"Rent",amount:20,previous_amount:10,detail_type:"Rent"},
 {name:"Office",amount:10,previous_amount:7,detail_type:"Expenses"},
 {name:"Other",amount:5,previous_amount:2,detail_type:"Expenses"},
 {name:"Reversal",amount:-3,previous_amount:0,detail_type:"Expenses"}];
 expect(expenseSlices(rows)).toEqual([{name:"Fuel",value:50},{name:"Salaries",value:30},{name:"Rent",value:20},{name:"Office",value:10},{name:"Other expenses",value:5}]);
});
it("renders posted September expenses and loads another month on selection",async()=>{
 const payload={month:"2026-09-01",currency:"SAR",total:399103.05,previous_total:524875.92,basis:"posted_expense_gl_excluding_vat_control",
 categories:[{name:"Transport & Freight",detail_type:"Transport",amount:399103.05,previous_amount:524875.92}]};
 vi.mocked(supabase.rpc).mockImplementation((() => {
   const resolved=Promise.resolve({data:payload,error:null});
   return {abortSignal:()=>resolved} as never;
 }) as never);
 render(<DashboardExpensesCard companyId="twakkal" businessUnitId="transport" enabled/>);
 await waitFor(()=>expect(screen.getAllByText("SAR 399,103.05").length).toBeGreaterThanOrEqual(2));
 expect(screen.getByText("Transport & Freight")).toBeTruthy();
 expect(screen.getByText(/posted expense GL · VAT control excluded/i)).toBeTruthy();
 expect(supabase.rpc).toHaveBeenCalledWith("dashboard_expense_breakdown",{p_month:expenseMonth("last")});
 fireEvent.change(screen.getByLabelText("Expense comparison month"),{target:{value:"current"}});
 await waitFor(()=>expect(supabase.rpc).toHaveBeenCalledWith("dashboard_expense_breakdown",{p_month:expenseMonth("current")}));
});
it("does not request financial details before parent dashboard is ready",()=>{
 render(<DashboardExpensesCard companyId="twakkal" businessUnitId="transport" enabled={false}/>);
 expect(supabase.rpc).not.toHaveBeenCalled();
});
