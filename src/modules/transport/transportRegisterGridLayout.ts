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

/**
 * Fill unused register viewport width without exposing hidden columns.
 * Explicitly resized columns keep their saved pixel widths; remaining
 * width goes to flexible visible columns. Overflow is preserved if
 * configured minimum widths already exceed the viewport.
 */
export function fitTransportRegisterColumnWidths(
  visibleKeys:readonly string[],
  naturalWidth:(key:string)=>number,
  savedWidths:Readonly<Record<string,number>>,
  viewportWidth:number
):Record<string,number>{
  const result:Record<string,number>={};
  for(const key of visibleKeys)result[key]=Math.max(1,Math.round(naturalWidth(key)));
  const contentWidth=visibleKeys.reduce((sum,key)=>sum+result[key],0);
  const available=Number.isFinite(viewportWidth)?Math.max(0,Math.floor(viewportWidth)):0;
  const extra=Math.max(0,available-contentWidth);
  if(!extra||!visibleKeys.length)return result;
  const flexible=visibleKeys.filter(key=>!Object.prototype.hasOwnProperty.call(savedWidths,key));
  const grow=flexible.length?flexible:visibleKeys;
  const totalWeight=grow.reduce((sum,key)=>sum+result[key],0);
  let remaining=extra;
  grow.forEach((key,index)=>{
    const additional=index===grow.length-1?remaining:Math.floor(extra*result[key]/totalWeight);
    result[key]+=additional;
    remaining-=additional;
  });
  return result;
}
