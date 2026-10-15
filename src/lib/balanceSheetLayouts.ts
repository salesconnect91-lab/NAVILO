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
  kind: "section" | "group" | "subheading" | "detail" | "subtotal" | "total" | "check";
};

const groupOrder: Record<StatementSection["title"], string[]> = {
  Assets: ["Current Assets", "Non-Current Assets"],
  Liabilities: ["Current Liabilities", "Non-Current Liabilities"],
  Equity: ["Capital & Reserves"],
};

const accountType = { Assets: "asset", Liabilities: "liability", Equity: "equity" } as const;

/** Classify once, then group report presentation; no accounting balances are changed. */
export function classifiedBalanceSheetRows(
  sections: StatementSection[],
  view: BalanceSheetView,
  expandedGroups: Record<string, boolean> = {},
  difference = 0,
  previousDifference = 0,
): ClassifiedStatementRow[] {
  const rows: ClassifiedStatementRow[] = [];
  for (const section of sections) {
    const type = accountType[section.title];
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
      const expanded = view !== "summary" &&
        (view !== "custom" || expandedGroups[section.title+":"+head] !== false);
      if (expanded) {
        const current = new Map((group?.items ?? []).map(item => [item.name,item]));
        const prior = new Map((priorGroup?.items ?? []).map(item => [item.name,item]));
        const names = Array.from(new Set([...current.keys(), ...(view === "comparative" ? prior.keys() : [])]));
        const categories = new Map<string, {rank:number; names:string[]}>();
        for (const name of names) {
          const item = current.get(name) ?? prior.get(name);
          const {label,rank} = balanceSheetClassification(type,item?.detailType,name);
          const category = categories.get(label) ?? {rank,names:[]};
          category.rank = Math.min(category.rank,rank);
          category.names.push(name);
          categories.set(label,category);
        }
        const sortedCategories = [...categories.entries()].sort((a,b) =>
          a[1].rank-b[1].rank || a[0].localeCompare(b[0],"en",{numeric:true}));
        for (const [label,category] of sortedCategories) {
          rows.push({section:section.title,account:label,classification:label,
            current:null,previous:null,kind:"subheading"});
          let categoryCurrent=0;
          let categoryPrevious=0;
          for (const name of category.names.sort((a,b)=>a.localeCompare(b,"en",{numeric:true}))) {
            const item=current.get(name);
            const prev=prior.get(name);
            const amount=item?.amount ?? 0;
            const before=prev?.amount ?? 0;
            categoryCurrent+=amount;
            categoryPrevious+=before;
            rows.push({section:section.title,account:name,classification:label,
              current:amount,previous:view==="comparative"?before:null,kind:"detail"});
          }
          rows.push({section:section.title,account:"Subtotal "+label,classification:label,
            current:categoryCurrent,previous:view==="comparative"?categoryPrevious:null,
            kind:"subtotal"});
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
  const comparative = view === "comparative";
  const columns = ["Section","Account",
    comparative ? "As of "+currentDate : "Amount",...(comparative ? ["As of "+previousDate] : [])];
  return {
    columns,
    rows:rows.filter(row=>row.kind!=="section").map(row=>[
      row.section,row.account,row.current ?? "",...(comparative ? [row.previous ?? ""] : [])
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
