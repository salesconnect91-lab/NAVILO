import { balanceSheetClassification } from "./balanceSheetPresentation";

export type BalanceSheetView = "classified" | "summary" | "detailed" | "comparative" | "custom";
export type StatementItem = { name: string; amount: number; detailType?: string; parentHead?: string };
export type StatementGroup = { head: string; total: number; items: StatementItem[] };
export type StatementSection = {
  title: "Assets" | "Liabilities" | "Equity";
  groups: StatementGroup[];
  total: number;
  previousGroups?: StatementGroup[];
  previousTotal?: number;
};
export type ClassifiedStatementRow = {
  section: string;
  account: string;
  classification: string;
  current: number | null;
  previous: number | null;
  kind: "section" | "group" | "detail" | "subtotal" | "total" | "check";
};

const groupOrder: Record<StatementSection["title"], string[]> = {
  Assets: ["Current Assets", "Non-Current Assets"],
  Liabilities: ["Current Liabilities", "Non-Current Liabilities"],
  Equity: ["Capital & Reserves"],
};

const accountType = { Assets: "asset", Liabilities: "liability", Equity: "equity" } as const;

export function classifiedBalanceSheetRows(
  sections: StatementSection[],
  view: BalanceSheetView,
  expandedGroups: Record<string, boolean> = {},
  difference = 0,
  previousDifference = 0,
): ClassifiedStatementRow[] {
  const rows: ClassifiedStatementRow[] = [];
  for (const section of sections) {
    const byHead = new Map(section.groups.map(group => [group.head, group]));
    const priorByHead = new Map((section.previousGroups ?? []).map(group => [group.head, group]));
    const allHeads = Array.from(new Set([...byHead.keys(), ...(view === "comparative" ? priorByHead.keys() : [])]))
      .sort((a, b) => {
        const list = groupOrder[section.title];
        const ai = list.indexOf(a), bi = list.indexOf(b);
        return (ai < 0 ? list.length : ai) - (bi < 0 ? list.length : bi) || a.localeCompare(b);
      });
    rows.push({ section:section.title, account:section.title.toUpperCase(),classification:"",
      current:null,previous:null,kind:"section" });
    for (const head of allHeads) {
      const group = byHead.get(head);
      const priorGroup = priorByHead.get(head);
      rows.push({section:section.title,account:head,classification:"",current:null,previous:null,kind:"group"});
      const expanded = view !== "summary" && (view !== "custom" || expandedGroups[section.title+":"+head] !== false);
      if (expanded) {
        const current = new Map((group?.items ?? []).map(item => [item.name,item]));
        const prior = new Map((priorGroup?.items ?? []).map(item => [item.name,item]));
        const items = Array.from(new Set([...current.keys(), ...(view === "comparative" ? prior.keys() : [])]));
        for (const name of items) {
          const entry = current.get(name), prev = prior.get(name);
          rows.push({
            section:section.title, account:name,
            classification:balanceSheetClassification(accountType[section.title],entry?.detailType ?? prev?.detailType,name).label,
            current:entry?.amount ?? 0,
            previous:view === "comparative" ? (prev?.amount ?? 0) : null,
            kind:"detail",
          });
        }
      }
      rows.push({section:section.title,account:"Subtotal "+head,classification:"",
        current:group?.total ?? 0,
        previous:view === "comparative" ? (priorGroup?.total ?? 0) : null,
        kind:"subtotal"});
    }
    rows.push({section:"Total",account:"Total "+section.title,classification:"",
      current:section.total,previous:view === "comparative" ? (section.previousTotal ?? 0) : null,kind:"total"});
  }
  const totalAssets = sections.find(s=>s.title==="Assets")?.total ?? 0;
  const liabilities = sections.find(s=>s.title==="Liabilities")?.total ?? 0;
  const equity = sections.find(s=>s.title==="Equity")?.total ?? 0;
  rows.push({section:"Total",account:"Total Liabilities & Equity",classification:"",
    current:liabilities+equity,
    previous:view==="comparative" ?
      (sections.find(s=>s.title==="Liabilities")?.previousTotal ?? 0)+(sections.find(s=>s.title==="Equity")?.previousTotal ?? 0):null,kind:"total"});
  rows.push({section:"Check",account:"Accounting Equation Difference",classification:"",
    current:Number.isFinite(difference)?difference:totalAssets-liabilities-equity,
    previous:view==="comparative"?previousDifference:null,kind:"check"});
  return rows;
}

export function classifiedBalanceSheetExport(
  rows: ClassifiedStatementRow[],
  view: BalanceSheetView,
  currentDate: string,
  previousDate: string,
): {columns:string[];rows:(string|number)[][]} {
  const detailed = view === "detailed";
  const comparative = view === "comparative";
  const columns = ["Section","Account",...(detailed ? ["Classification"] : []),
    comparative ? "As of "+currentDate : "Amount",...(comparative ? ["As of "+previousDate] : [])];
  return {
    columns,
    rows:rows.filter(row=>row.kind!=="section").map(row=>[
      row.section,row.account,...(detailed ? [row.kind==="detail" ? row.classification : ""] : []),
      row.current ?? "",...(comparative ? [row.previous ?? ""] : [])
    ]),
  };
}

/** Priority: explicit account detail, then COA group ancestry, then optional head, then conservative fallback. */
export function coaBalanceSheetGroup(
  type:string,
  name:string,
  detailType?:string|null,
  parentHead?:string|null,
  ancestors:string[]=[],
):string {
  const norm=(s?:string|null)=>(s??"").toLowerCase().replace(/[^a-z0-9]/g,"");
  if(type==="equity")return "Capital & Reserves";
  const detail=norm(detailType);
  const heads=[...ancestors, ...(parentHead ? [parentHead] : [])].map(norm);
  const nonCurrent=(v:string)=>v.includes("noncurrent")||v.includes("fixedasset")||v.includes("longterm")||
    v.includes("machinery")||v.includes("equipment")||v.includes("propertyplant")||v.includes("building");
  const explicitlyCurrent=(v:string)=>v.includes("current")&&!v.includes("noncurrent");
  if(nonCurrent(detail))return type==="asset"?"Non-Current Assets":"Non-Current Liabilities";
  if(explicitlyCurrent(detail)||["accountspayable","accountsreceivable","bankaccount","cashonhand",
    "inventory","inputvat","outputvat","shorttermloan","retainedearnings"].includes(detail))
    return type==="asset"?"Current Assets":"Current Liabilities";
  if(heads.some(nonCurrent))return type==="asset"?"Non-Current Assets":"Non-Current Liabilities";
  if(heads.some(explicitlyCurrent))return type==="asset"?"Current Assets":"Current Liabilities";
  if(nonCurrent(norm(name)))return type==="asset"?"Non-Current Assets":"Non-Current Liabilities";
  return type==="asset"?"Current Assets":"Current Liabilities";
}
