import {parseTripWorkbook} from './transportTripImport';
self.onmessage=(event:MessageEvent<ArrayBuffer>)=>{
 try{self.postMessage({rows:parseTripWorkbook(event.data)});}catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
