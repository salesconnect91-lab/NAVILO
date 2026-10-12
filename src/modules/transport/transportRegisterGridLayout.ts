/**
 * Trip Register column layouts contain presentation preferences only.
 * Keep saved profiles bounded and forward-compatible with newly added columns.
 */
export type TransportRegisterGridLayout={
  order:string[];
  hidden:string[];
  widths:Record<string,number>;
};

export function normalizeTransportRegisterGridLayout(
  raw:unknown,
  availableKeys:readonly string[]
):TransportRegisterGridLayout{
  const valid=new Set(availableKeys);
  const source=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
  const cleanKeys=(value:unknown)=>{
    const seen=new Set<string>();
    return (Array.isArray(value)?value:[])
      .filter((key):key is string=>typeof key==="string"&&valid.has(key))
      .filter(key=>{if(seen.has(key))return false;seen.add(key);return true;});
  };
  const order=cleanKeys(source.order);
  for(const key of availableKeys)if(!order.includes(key))order.push(key);
  const hidden=cleanKeys(source.hidden);
  const widths:Record<string,number>={};
  if(source.widths&&typeof source.widths==="object"&&!Array.isArray(source.widths)){
    for(const [key,value] of Object.entries(source.widths)){
      if(valid.has(key)&&typeof value==="number"&&Number.isFinite(value)&&value>=52&&value<=1000){
        widths[key]=Math.round(value);
      }
    }
  }
  return {order,hidden,widths};
}
