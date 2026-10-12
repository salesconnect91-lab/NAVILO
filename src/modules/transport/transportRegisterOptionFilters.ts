/**
 * Column options depend on all OTHER active filters, never the selection of
 * the very column being edited or the grid's sort/page position.
 * This also keeps the request payload below the PostgREST RPC filter limit.
 */
export function registerOptionFilters<T extends {columns?:Record<string,string[]>}>(filters:T, activeColumn:string|null):T {
  const columns:Record<string,string[]>={};
  for(const [key,values] of Object.entries(filters.columns??{})){
    if(key!==activeColumn&&values.length)columns[key]=values;
  }
  return {...filters,columns};
}
