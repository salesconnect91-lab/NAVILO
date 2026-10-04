import {Component,type ErrorInfo,type ReactNode} from 'react';

export function isChunkLoadError(error:unknown):boolean {
  const message=error instanceof Error?error.message:String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .+ failed|Unable to preload CSS/i.test(message);
}

export default class ApplicationErrorBoundary extends Component<{children:ReactNode;onReload?:()=>void},{error:Error|null}> {
  state:{error:Error|null}={error:null};
  static getDerivedStateFromError(error:Error){return {error};}
  componentDidCatch(error:Error,info:ErrorInfo){console.error('[NAVILO screen error]',error,info.componentStack);}
  render(){
    if(!this.state.error)return this.props.children;
    const stale=isChunkLoadError(this.state.error);
    return <div role="alert" className="mx-auto my-8 max-w-lg rounded-lg border border-red-200 bg-white p-4 text-sm text-slate-800">
      <h1 className="font-semibold">{stale?'This screen needs a refresh':'This screen could not open'}</h1>
      <p className="mt-2">{stale?'A screen file could not load. Reload to get the current application version.':'An application error stopped this screen. Reload the page to try again.'}</p>
      <p className="mt-2 text-xs text-slate-500">Unsaved changes may be lost when you reload.</p>
      <button type="button" className="btn-primary mt-3" onClick={()=>this.props.onReload?this.props.onReload():window.location.reload()}>Reload page</button>
    </div>;
  }
}
