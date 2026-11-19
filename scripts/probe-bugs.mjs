import { spawn } from 'node:child_process';
import WebSocket from 'ws';
const BASE='http://127.0.0.1:4173', PORT=9401;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const chrome=spawn(process.env.CHROME_BIN||'chromium',['--headless=new','--no-sandbox','--disable-gpu',`--remote-debugging-port=${PORT}`,'--window-size=1280,900','about:blank'],{stdio:'ignore'});
let page;for(let i=0;i<80;i++){try{const l=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();page=l.find(t=>t.type==='page'&&t.webSocketDebuggerUrl);if(page)break;}catch{}await sleep(250);}
const ws=new WebSocket(page.webSocketDebuggerUrl,{perMessageDeflate:false,maxPayload:64*1024*1024});
await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
let id=0;const w=new Map();
const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;w.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
ws.on('message',(raw)=>{const m=JSON.parse(raw.toString());if(m.id&&w.has(m.id)){const{res,rej}=w.get(m.id);w.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}});
const ev=async(e)=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)return 'ERR '+(r.exceptionDetails.exception?.description||'').split('\n')[0];return r.result.value;};
await send('Page.enable');await send('Runtime.enable');

await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await send('Page.navigate',{url:`${BASE}/amigo/`}); await sleep(2500);
console.log('amigo@390', JSON.stringify(await ev(`(() => {
  const side=document.getElementById('side'); const b=side.getBoundingClientRect();
  const shell=document.querySelector('.shell');
  return {sideX:Math.round(b.left), sideW:Math.round(b.width), visible:b.left>-10,
    shellDisplay:getComputedStyle(shell).display, transform:getComputedStyle(side).transform,
    appW:Math.round(document.querySelector('.app').getBoundingClientRect().width)};
})()`)));

for (const path of ['/','/topics/']) {
  await send('Page.navigate',{url:`${BASE}${path}`}); await sleep(2000);
  console.log(path, JSON.stringify(await ev(`(() => {
    const btns=[...document.querySelectorAll('header button, header a')].map(n=>(n.getAttribute('aria-label')||n.title||n.textContent||'').trim().slice(0,18));
    const faint=[...document.querySelectorAll('button, .btn')].filter(n=>{
      const c=getComputedStyle(n); const m=c.color.match(/\\d+/g);
      if(!m) return false;
      const lum=(+m[0]*0.299 + +m[1]*0.587 + +m[2]*0.114);
      const bg=c.backgroundColor.match(/\\d+/g);
      const bl=bg? (+bg[0]*0.299 + +bg[1]*0.587 + +bg[2]*0.114):255;
      return Math.abs(lum-bl) < 40 && n.offsetParent;
    }).slice(0,4).map(n=>(n.textContent||n.getAttribute('aria-label')||'').trim().slice(0,22));
    return {headerControls:btns, lowContrast:faint};
  })()`)));
}
ws.close();chrome.kill();process.exit(0);
