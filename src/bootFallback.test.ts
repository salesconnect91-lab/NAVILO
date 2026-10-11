// @vitest-environment jsdom
import {afterEach,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function bootMonitor(){
  const html=readFileSync('index.html','utf8');
  const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  if(!script)throw new Error('Boot monitor missing');
  const timers:Array<{callback:()=>void;delay:number}>=[];
  const listeners=new Map<string,()=>void>();
  runInNewContext(script,{document,window:{
    addEventListener:(name:string,callback:()=>void)=>listeners.set(name,callback),
    setTimeout:(callback:()=>void,delay:number)=>timers.push({callback,delay}),
  }});
  return {error:()=>listeners.get('error')?.(),run:(delay:number)=>timers.filter(timer=>timer.delay===delay).forEach(timer=>timer.callback())};
}
afterEach(()=>{document.body.innerHTML='';});
describe('HTML startup monitor',()=>{
  it('preserves a mounted app after errors from clicks or failed resources',()=>{
    document.body.innerHTML='<div id="root" data-navilo-react-mounted="true"><button>Transport</button></div>';
    const monitor=bootMonitor();
    monitor.error();monitor.run(0);monitor.error();monitor.run(0);monitor.run(14000);
    expect(document.querySelector('#root')?.textContent).toBe('Transport');
  });
  it('leaves an empty mounted React surface under React control',()=>{
    document.body.innerHTML='<div id="root" data-navilo-react-mounted="true"></div>';
    const monitor=bootMonitor();monitor.error();monitor.run(0);monitor.run(14000);
    expect(document.querySelector('#root')?.innerHTML).toBe('');
  });
  it('still shows the failure message when the entry script did not mount',()=>{
    document.body.innerHTML='<div id="root"><div id="navilo-boot-fallback">Loading NAVILO…</div></div>';
    const monitor=bootMonitor();monitor.error();monitor.run(0);
    expect(document.querySelector('#root')?.textContent).toContain('NAVILO could not start');
  });
  it('still offers reload when startup never completes',()=>{
    document.body.innerHTML='<div id="root"><div id="navilo-boot-fallback">Loading NAVILO…</div></div>';
    const monitor=bootMonitor();monitor.run(14000);
    expect(document.querySelector('button')?.textContent).toBe('Reload NAVILO');
  });
});
