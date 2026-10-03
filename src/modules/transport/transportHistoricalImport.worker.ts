import {parseHistoricalWorkbook} from './transportHistoricalImport';
self.onmessage=event=>{try{self.postMessage({rows:parseHistoricalWorkbook(event.data)});}catch(e){self.postMessage({error:e instanceof Error?e.message:'Unable to read historical workbook'});}};
