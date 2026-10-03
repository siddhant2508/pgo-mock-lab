/* PGO Mock Lab browser app. It only ever holds the question on screen; the answer key,
   the clock and the scoring live on the server. */
"use strict";
const GROUPS=[["Basic sciences",[0,1,2,5,6,7]],["Clinical sciences",[10,11,13]],["OT foundations",[3,4,8,9,12]],["OT in conditions",[14,15,17,18,19]],["Rehab, community & research",[16,20,21]]];
const L="ABCD", app=document.getElementById("app");
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const rs=p=>"₹"+(p/100).toLocaleString("en-IN");
function fmtT(ms){const s=Math.max(0,Math.ceil(ms/1000));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return `${h}:${String(m).padStart(2,"0")}:${String(x).padStart(2,"0")}`}
function fmtS(sec){sec=Math.round(sec);return sec<60?`${sec}s`:`${Math.floor(sec/60)}m ${String(sec%60).padStart(2,"0")}s`}
function maskEmail(e){const [u,d]=e.split("@");return (u||"").slice(0,2)+"•••@"+(d||"")}

let ME=null, SUBJ=[], MERIT={}, Q=[], N=0, T={title:"",mins:90}, DURATION=0;
let S={screen:"loading",name:"",email:"",msg:"",err:""};
let AT=null, qCache={}, tick=null, resendTimer=null;

/* ---------- talking to the server ---------- */
async function api(method,path,body){
  let r;
  try{r=await fetch(path,{method,headers:{"Content-Type":"application/json","X-Requested-With":"pgo"},credentials:"same-origin",body:body?JSON.stringify(body):undefined})}
  catch(e){throw new Error("No connection. Check your internet and try again.")}
  const data=await r.json().catch(()=>({}));
  if(r.status===401&&!path.startsWith("/api/auth/")){clearInterval(tick);ME=null;S={screen:"login",name:"",email:"",err:data.error||"Please sign in again."};render();throw new Error("signed-out")}
  if(!r.ok)throw new Error(data.error||"Something went wrong. Please try again.");
  return data;
}
function fail(e){if(e.message==="signed-out")return;S.err=e.message;render()}
async function loadMe(){ME=await api("GET","/api/me");SUBJ=ME.subjects;S.email=ME.email;S.name=ME.name}

function watermark(){
  const txt=`${S.name||"Candidate"} · ${maskEmail(S.email||"")}`;
  const col=getComputedStyle(document.documentElement).getPropertyValue("--ink").trim()||"#000";
  const svg=`<svg xmlns='http://www.w3.org/2000/svg' width='280' height='160'><text x='10' y='90' transform='rotate(-24 140 80)' font-family='monospace' font-size='14' fill='${col}'>${esc(txt)}</text></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}
function bar(title,back){return `<div class="topbar"><div class="in"><div class="brand">PGO Mock <i>Lab</i></div><div class="sec">${esc(title)}</div>${themeBtn()}${back?`<button class="btn ghost" data-act="home">My mocks</button>`:""}${ME&&ME.admin&&!back?`<button class="btn ghost" data-act="admin">Admin</button>`:""}<button class="btn ghost" data-act="signout">Sign out</button></div></div>`}
const THEMES=["sepia","light","dark","system"],TNAME={system:"System",light:"Light",dark:"Dark",sepia:"Sepia"};
function theme(){try{const t=localStorage.getItem("pgo-theme");return THEMES.includes(t)?t:"sepia"}catch(e){return"sepia"}}
function setTheme(t){try{localStorage.setItem("pgo-theme",t)}catch(e){}if(t==="system")document.documentElement.removeAttribute("data-theme");else document.documentElement.setAttribute("data-theme",t)}
const themeBtn=cls=>`<button class="btn ghost themebtn ${cls||""}" data-act="theme" aria-label="Change colour theme. Current: ${TNAME[theme()]}"><span class="tl">Theme: </span>${TNAME[theme()]}</button>`;
const CONTACT="pgomocklab@gmail.com";
const foot=()=>`<footer class="foot"><div class="footin"><div><b>PGO Mock <i>Lab</i></b><p>Occupational Therapy MCQ for CET practice.</p></div>
  <div><span class="eyebrow">Contact us</span><p>Email: <a href="mailto:${CONTACT}">${CONTACT}</a></p><p>We reply within 2 working days.</p></div>
  <div><span class="eyebrow">Payments</span><p>UPI, credit card, debit card, netbanking and wallets, processed securely by Razorpay.</p></div>
  </div><p class="footnote">© ${new Date().getFullYear()} PGO Mock Lab. Not affiliated with the State CET Cell, Maharashtra.</p></footer>`;
const METHODS=[["upi","UPI","Google Pay, PhonePe, Paytm, BHIM or any UPI app"],["credit","Credit card","Visa, Mastercard, RuPay, American Express"],["debit","Debit card","Visa, Mastercard, RuPay, Maestro"],["netbanking","Netbanking","All major Indian banks"],["wallet","Wallet","Paytm, PhonePe, Amazon Pay and others"]];
const errBox=()=>S.err?`<div class="err" role="alert">${esc(S.err)}</div>`:"";

/* ---------- login ---------- */
function vLogin(){return `${themeBtn("themefloat")}<div class="auth">
  <section class="authside"><div class="brand" style="font-size:22px">PGO Mock <i>Lab</i></div>
    <h1>Occupational Therapy MCQ for CET practice, with a scorecard that shows exactly where your marks go.</h1>
    <ul class="ticks"><li><span class="bub">A</span>Full 100-question mocks in the official CET subject pattern</li><li><span class="bub">B</span>Past-paper questions marked to the official answer keys, plus new practice questions</li><li><span class="bub">C</span>Subject-wise scorecard and rank against past merit lists</li></ul>
    <p class="small">Start with a free 15-question demo. Not affiliated with the State CET Cell, Maharashtra.</p></section>
  <section class="authform"><div class="authbox">
    <h2>Sign in or create an account</h2><p class="small">We'll email you a 6-digit code. No password to remember.</p>
    <form id="lf" novalidate><div class="field"><label for="em">Email address</label><input id="em" type="email" autocomplete="email" inputmode="email" placeholder="name@gmail.com" value="${esc(S.email||"")}"></div>
      ${errBox()}<button class="btn primary wide" type="submit" ${S.busy?"disabled":""}>${S.busy?"Sending…":"Send code"}</button></form>
    <p class="small" style="margin-top:18px">One account works on up to 2 devices at a time, for example your phone and your laptop. Signing in on a third device signs out the oldest one.</p>
  </div></section></div>${foot()}`}
function vOtp(){const s=Math.max(0,Math.ceil((S.resendAt-Date.now())/1000));return `${themeBtn("themefloat")}<div class="auth"><section class="authside"><div class="brand" style="font-size:22px">PGO Mock <i>Lab</i></div><h1>Check your inbox.</h1><p class="small">The code expires in 10 minutes. Look in Promotions or Spam if you can't find it.</p></section>
  <section class="authform"><div class="authbox">
    <h2>Enter the 6-digit code</h2><p class="small">Sent to <b>${esc(S.email)}</b> · <button class="link" data-act="change">Change email</button></p>
    ${S.devCode?`<div class="demo">Local test mode: no email was sent. Your code is <b class="mono">${esc(S.devCode)}</b></div>`:""}
    <form id="of" novalidate><div class="otp" role="group" aria-label="6-digit code">${[0,1,2,3,4,5].map(i=>`<input id="otp${i}" inputmode="numeric" autocomplete="${i?"off":"one-time-code"}" maxlength="1" aria-label="Digit ${i+1}">`).join("")}</div>
      ${errBox()}<button class="btn primary wide" type="submit">Verify and continue</button></form>
    <button class="btn ghost wide" id="rs" data-act="resend" ${s>0?"disabled":""} style="margin-top:10px">${s>0?`Resend code in ${s}s`:"Resend code"}</button>
  </div></section></div>`}
function vName(){return `${themeBtn("themefloat")}<div class="auth"><section class="authside"><div class="brand" style="font-size:22px">PGO Mock <i>Lab</i></div><h1>One last thing.</h1></section><section class="authform"><div class="authbox"><h2>What's your name?</h2><p class="small">It appears on your scorecard and as a watermark on your test.</p><form id="nf" novalidate><div class="field"><label for="nm">Full name</label><input id="nm" maxlength="40" autocomplete="name"></div>${errBox()}<button class="btn primary wide" type="submit">Continue</button></form></div></section></div>`}
async function sendCode(){
  const v=(document.getElementById("em")||{value:S.email}).value.trim().toLowerCase();S.email=v;
  if(!EMAIL_RE.test(v)){S.err="Enter a valid email address, like name@gmail.com.";render();return}
  S.busy=true;S.err="";render();
  try{const r=await api("POST","/api/auth/request",{email:v});S.devCode=r.devCode||"";S.resendAt=Date.now()+30000;S.screen="otp";S.busy=false;render();const f=document.getElementById("otp0");if(f)f.focus();
    clearInterval(resendTimer);resendTimer=setInterval(()=>{const b=document.getElementById("rs");if(!b){clearInterval(resendTimer);return}const s=Math.ceil((S.resendAt-Date.now())/1000);b.disabled=s>0;b.textContent=s>0?`Resend code in ${s}s`:"Resend code"},500)}
  catch(e){S.busy=false;fail(e)}
}
async function verify(){
  const code=[...document.querySelectorAll(".otp input")].map(i=>i.value).join("");
  if(!/^\d{6}$/.test(code)){S.err="Enter all 6 digits of the code.";render();return}
  try{await api("POST","/api/auth/verify",{email:S.email,code});S.err="";await loadMe();S.screen=ME.name?"home":"name";render()}catch(e){fail(e)}
}

/* ---------- dashboard ---------- */
function vHome(){
  const demo=ME.tests.find(t=>t.kind==="demo"),full=ME.tests.filter(t=>t.kind==="full"),p=ME.pricing;
  const when=ms=>new Date(ms).toLocaleDateString("en-IN",{day:"numeric",month:"short"});
  const actions=t=>t.openAttempt?`<div class="row"><button class="btn primary" data-act="resume" data-id="${t.openAttempt}">Resume test</button></div>`
    :t.last?`<div class="mrow" style="border:0"><span>Last score</span><b class="mono">${t.last.score}/${t.last.n} · ${when(t.last.when)}</b></div><div class="row"><button class="btn primary" data-act="score" data-id="${t.last.attemptId}">View scorecard</button><button class="btn" data-act="open" data-t="${t.id}">Retake</button></div>`
    :`<div class="row"><button class="btn primary" data-act="open" data-t="${t.id}">Start</button></div>`;
  const mock=(t,i)=>`<article class="mock ${t.owned?"":"locked"}"><div class="row" style="justify-content:space-between"><span class="eyebrow">Mock ${i+1}</span><span class="chip ${t.owned?"s":"m"}">${t.owned?"Unlocked":rs(p.single)}</span></div>
    <h3>Full mock ${i+1}</h3><p class="small">${t.n} questions · ${t.minutes} min · all 22 CET subjects</p>
    ${t.owned?actions(t):`<div class="row"><button class="btn" data-act="buy" data-item="${t.id}">Buy for ${rs(p.single)}</button></div>`}</article>`;
  const fullPrice=p.single*p.fullCount;
  return `${bar("My mocks",false)}<div class="wrap"><div class="rgrid">
    <div><div class="eyebrow">Welcome${S.name?", "+esc(S.name.split(" ")[0]):""}</div><h1 style="font-size:clamp(26px,3.6vw,36px);margin-top:6px">Your Occupational Therapy MCQ mocks</h1><p class="small">Signed in as ${esc(S.email)}</p></div>
    <div class="devnote" role="note"><b>Devices: ${ME.devices} of ${ME.maxDevices} in use.</b> Your account works on up to ${ME.maxDevices} devices at a time. Signing in on another device signs out the oldest one. Sharing your login will sign you out.</div>
    ${S.msg?`<div class="note" role="status">${esc(S.msg)}</div>`:""}${errBox()}
    <article class="mock" style="border:1.5px solid var(--pen)"><div class="row" style="justify-content:space-between"><span class="eyebrow">Free demo</span><span class="chip s">Free</span></div>
      <h3>Demo test · ${demo.n} questions · ${demo.minutes} min</h3><p class="small">Hand-picked harder questions from recent papers, with the full scorecard at the end.</p>${actions(demo)}</article>
    ${p.packNow>0?`<section class="bundle"><div><span class="eyebrow">${p.ownedFull?"Upgrade to the full pack":`Best value · save ${rs(fullPrice-p.pack)}`}</span><h2>All ${p.fullCount} full mock tests</h2><p class="small">${p.fullCount*100} different questions · official CET subject pattern · scorecard and answer review after each${p.ownedFull?" · you pay only the difference":""}</p></div><div class="row"><b class="mono" style="font-size:26px">${rs(p.packNow)}</b>${p.ownedFull?"":`<s class="small">${rs(fullPrice)}</s>`}<button class="btn primary" data-act="buy" data-item="pack">${p.ownedFull?"Upgrade":`Buy all ${p.fullCount} mocks`}</button></div></section>`:""}
    <div class="mocks">${full.map(mock).join("")}</div>
  </div></div>${foot()}`}
function vStart(){const t=S.sel;return `${bar(t.title,true)}<div class="wrap"><div class="sheet">
    <div class="eyebrow">Occupational Therapy MCQ for CET Practice · ${t.kind==="demo"?"Free demo":"Full mock"}</div><h1 style="font-size:clamp(28px,4vw,40px);margin:8px 0 10px">${esc(t.title)}</h1>
    <div class="facts"><div class="fact"><b>${t.n}</b> questions</div><div class="fact"><b>${t.minutes}</b> minutes</div><div class="fact"><b>+1</b> per correct</div><div class="fact"><b>0</b> negative marking</div></div>
    <ul class="rules"><li>The timer starts when you begin and keeps running even if you close the page. The test submits itself when time is up.</li><li>One question per screen. Move back and forth, change answers, mark for review.</li><li>There is no negative marking, so answer every question.</li><li>Your answers are saved as you go. Switching tabs is recorded.</li></ul>
    ${errBox()}<div class="row"><button class="btn primary" data-act="begin">Begin test</button><button class="btn" data-act="home">Not now</button></div></div></div>${foot()}`}

/* ---------- test ---------- */
async function enterAttempt(id){
  AT=await api("GET",`/api/attempts/${id}`);
  if(AT.submitted){return showResult(id)}
  qCache={};N=AT.n;S.ans=AT.ans;S.mark=AT.mark;S.seen=AT.seen;S.tabs=AT.tabs;S.offset=AT.serverNow-Date.now();S.endAt=AT.endsAt-S.offset;
  const first=S.ans.findIndex(a=>a===null);S.cur=first<0?0:first;S.confirm=false;S.pal=false;S.screen="test";S.err="";S.qStart=Date.now();
  await loadQ(S.cur);startTick();
}
async function loadQ(i){
  if(!qCache[i]){render();try{qCache[i]=await api("GET",`/api/attempts/${AT.id}/q/${i}`)}catch(e){return fail(e)}}
  S.seen[i]=true;render();
}
function spent(){const s=(Date.now()-S.qStart)/1000;S.qStart=Date.now();return Math.round(s*10)/10}
let chain=Promise.resolve();
function post(body){ // answers are sent in order; a failed save is retried
  chain=chain.then(async()=>{for(let k=0;k<3;k++){try{await api("POST",`/api/attempts/${AT.id}/answer`,body);S.saveErr=false;return}catch(e){if(e.message==="signed-out")return;if(/submitted|Time is up/.test(e.message)){return showResult(AT.id)}S.saveErr=true;await new Promise(r=>setTimeout(r,1500))}}render()});
  return chain;
}
function go(i){post({n:S.cur,seconds:spent()});S.cur=Math.max(0,Math.min(N-1,i));S.pal=false;loadQ(S.cur)}
function startTick(){clearInterval(tick);tick=setInterval(()=>{const t=document.getElementById("timer");if(!t||S.screen!=="test")return;const left=S.endAt-Date.now();if(left<=0){clearInterval(tick);submitTest();return}t.textContent=fmtT(left);t.classList.toggle("low",left<5*60*1000)},500)}
async function submitTest(){clearInterval(tick);try{post({n:S.cur,seconds:spent()});await chain;await api("POST",`/api/attempts/${AT.id}/submit`);await showResult(AT.id)}catch(e){fail(e)}}
function stateOf(i){if(S.mark[i])return"r";if(S.ans[i]!==null)return"a";if(S.seen[i])return"s";return""}
function vTest(){
  const i=S.cur,q=qCache[i],c={a:0,r:0,s:0,n:0};for(let k=0;k<N;k++){const st=stateOf(k);c[st||"n"]++}
  const subj=SUBJ[AT.subjectOf[i]];
  const pal=Array.from({length:N},(_,k)=>`<button class="pb ${stateOf(k)} ${k===i?"cur":""}" data-go="${k}" aria-label="Question ${k+1}">${k+1}</button>`).join("");
  return `<div class="topbar"><div class="in"><div class="brand">PGO Mock <i>Lab</i></div><div class="sec">${esc(subj)}</div>
    ${themeBtn()}<button class="btn ghost palbtn" data-act="pal">Questions</button><div class="timer mono" id="timer">${fmtT(S.endAt-Date.now())}</div></div></div>
  <div class="wrap" style="padding-top:0"><div class="test">
    <section class="qcard ${document.hidden?"blur":""}" id="qcard"><div class="wm" style="background-image:${watermark()}"></div>
      <div class="qhead"><div class="qnum">Question ${i+1}<small>of ${N}</small></div><span class="tag">${esc(subj)}</span></div>
      ${q?`<p class="qtext">${esc(q.text)}</p><div class="opts" role="radiogroup">${q.options.map((o,k)=>`<button class="opt ${S.ans[i]===k?"sel":""}" role="radio" aria-checked="${S.ans[i]===k}" data-opt="${k}"><span class="bub">${L[k]}</span><span>${esc(o)}</span></button>`).join("")}</div>`:`<p class="qtext" style="color:var(--muted)">Loading question…</p>`}
      <div class="actions"><button class="btn" data-act="prev" ${i===0?"disabled":""}>Previous</button><button class="btn ghost" data-act="clear" ${S.ans[i]===null?"disabled":""}>Clear</button><span class="grow"></span>
        <button class="btn" data-act="mark">${S.mark[i]?"Unmark":"Mark for review"}</button><button class="btn primary" data-act="next">${i===N-1?"Save":"Save & next"}</button></div>
      ${S.saveErr?`<div class="flag">Connection problem: your last answer may not be saved yet. Retrying…</div>`:""}${S.tabs?`<div class="flag">Tab switches recorded: ${S.tabs}</div>`:""}${errBox()}
    </section>
    <aside class="palette ${S.pal?"open":""}"><h3>${esc(S.name)}</h3>
      <div class="counts"><div><i class="dot a"></i>${c.a} answered</div><div><i class="dot r"></i>${c.r} for review</div><div><i class="dot s"></i>${c.s} skipped</div><div><i class="dot"></i>${c.n} not visited</div></div>
      <div class="grid">${pal}</div><button class="btn primary" style="width:100%" data-act="submit">Submit test</button></aside>
  </div></div>
  ${S.confirm?`<div class="modal"><div class="mbox" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">Submit your test?</h2>
    <div class="mrow"><span>Answered</span><b class="mono">${S.ans.filter(a=>a!==null).length}</b></div><div class="mrow"><span>Unanswered</span><b class="mono">${S.ans.filter(a=>a===null).length}</b></div><div class="mrow"><span>Time left</span><b class="mono">${fmtT(S.endAt-Date.now())}</b></div>
    <p style="color:var(--muted);font-size:14px">No negative marking: a guess on every blank question can only add marks. You can't change answers after submitting.</p>
    <div class="actions"><button class="btn" data-act="cancel">Keep working</button><button class="btn primary" data-act="final">Submit</button></div></div></div>`:""}`;
}

/* ---------- result ---------- */
async function showResult(id){
  clearInterval(tick);
  const r=await api("GET",`/api/attempts/${id}/result`);
  Q=r.rows.map(x=>({s:x.s,q:x.q,o:x.o,a:x.a,src:x.src,e:x.e}));N=Q.length;MERIT=r.merit;T={title:r.title,mins:r.minutes};DURATION=r.minutes*60000;
  S.perm=Q.map(()=>[0,1,2,3]);S.ans=r.rows.map(x=>x.ua);S.time=r.rows.map(x=>x.t);S.used=r.used;S.tabs=r.tabs;S.test=r.kind==="demo"?"demo":r.testId;
  S.filter="all";S.fsub="all";S.demo=false;S.screen="result";S.err="";
  try{await loadMe()}catch(e){}
  render();scrollTo(0,0);
}
function analyse(){
  const rows=Q.map((q,i)=>{const ci=S.perm[i].indexOf(q.a),ua=S.ans[i];const st=ua===null?"skip":ua===ci?"ok":"bad";return{q,i,ci,ua,st,t:S.time[i]}});
  const sub=SUBJ.map((name,s)=>{const r=rows.filter(x=>x.q.s===s);const ok=r.filter(x=>x.st==="ok").length,bad=r.filter(x=>x.st==="bad").length,sk=r.length-ok-bad;
    const t=r.reduce((a,x)=>a+x.t,0);const acc=r.length?ok/r.length:0;return{s,name,n:r.length,ok,bad,sk,lost:r.length-ok,acc,avg:r.length?t/r.length:0,tag:acc>=.75?"s":acc>=.5?"m":"w"}});
  const ok=rows.filter(x=>x.st==="ok").length,bad=rows.filter(x=>x.st==="bad").length,sk=N-ok-bad;
  return{rows,sub,ok,bad,sk};
}
function rankIn(score,list){const n=list.length;const r=list.filter(v=>v>score).length+1;return{r,n}}
function vResult(){
  const WM=watermark();const A=analyse(),{rows,sub,ok,bad,sk}=A;
  const att=ok+bad,acc=att?Math.round(ok/att*100):0,used=S.used||0;
  const circ=2*Math.PI*70,dash=circ*ok/N;const proj=Math.round(ok/N*100);
  const ranks=["2024","2022","2021"].map(y=>{const{r,n}=rankIn(proj,MERIT[y]);return`<div class="rk"><span>CET merit list ${y}</span><span><b>#${r}</b> <span style="color:var(--muted)">of ${n}</span></span></div>`}).join("");
  const top3=[...sub].sort((a,b)=>b.lost-a.lost||a.acc-b.acc).slice(0,3);
  const strong=sub.filter(x=>x.acc===1&&x.n>=3).map(x=>x.name);
  const rushed=rows.filter(x=>x.st==="bad"&&x.t<20).length;
  const stuck=rows.filter(x=>x.t>120);
  const ins=[];
  ins.push(`<div class="ins bad"><span class="eyebrow">Study first</span><p>${top3.map(x=>`<b>${esc(x.name)}</b> (${x.lost} lost)`).join(", ")}. These three cost you ${top3.reduce((a,x)=>a+x.lost,0)} marks.</p></div>`);
  if(sk) ins.push(`<div class="ins rev"><span class="eyebrow">Free marks left blank</span><p>You skipped ${sk} question${sk>1?"s":""}. With no negative marking, guessing would have added about ${Math.max(1,Math.round(sk/4))} mark${Math.round(sk/4)===1?"":"s"} on average.</p></div>`);
  if(rushed>=3) ins.push(`<div class="ins rev"><span class="eyebrow">Rushed answers</span><p>${rushed} wrong answers took under 20 seconds. Read the question stem fully, especially EXCEPT questions.</p></div>`);
  if(stuck.length) ins.push(`<div class="ins rev"><span class="eyebrow">Time sinks</span><p>${stuck.length} question${stuck.length>1?"s":""} took over 2 minutes (${stuck.filter(x=>x.st==="ok").length} of them correct). Mark and move on, then come back.</p></div>`);
  if(strong.length) ins.push(`<div class="ins ok"><span class="eyebrow">Full marks</span><p>${strong.map(esc).join(", ")}. Keep these warm with quick revision.</p></div>`);
  const maxLost=Math.max(1,...sub.map(x=>x.n));
  const lost=[...sub].filter(x=>x.lost>0).sort((a,b)=>b.lost-a.lost||b.n-a.n).map(x=>`<div class="lr"><span>${esc(x.name)}</span><div class="bar" title="${x.ok} correct, ${x.bad} wrong, ${x.sk} skipped of ${x.n}"><i style="width:${x.bad/maxLost*100}%;background:var(--bad)"></i><i style="width:${x.sk/maxLost*100}%;background:var(--skip)"></i><i style="width:${x.ok/maxLost*100}%;background:var(--ok-soft)"></i></div><span class="mono">−${x.lost}/${x.n}</span></div>`).join("");
  const label={s:"Strong",m:"Needs work",w:"Weak"};
  const table=GROUPS.map(([g,ids])=>{const gs=ids.map(i=>sub[i]).filter(x=>x.n);if(!gs.length)return"";const gn=gs.reduce((a,x)=>a+x.n,0),gok=gs.reduce((a,x)=>a+x.ok,0);
    return `<tr class="grp"><td colspan="8">${g} <span class="mono" style="font-weight:500;color:var(--muted);font-size:13px">${gok}/${gn}</span></td></tr>`+
    gs.map(x=>`<tr><td>${esc(x.name)}</td><td class="n">${x.n}</td><td class="n">${x.ok}</td><td class="n">${x.bad}</td><td class="n">${x.sk}</td><td class="n"><span class="minibar"><i style="width:${x.acc*100}%"></i></span>${Math.round(x.acc*100)}%</td><td class="n">${fmtS(x.avg)}</td><td><span class="chip ${x.tag}">${label[x.tag]}</span></td></tr>`).join("")}).join("");
  const groups=GROUPS.map(([g,ids])=>{const gs=ids.map(i=>sub[i]).filter(x=>x.n);if(!gs.length)return"";const gn=gs.reduce((a,x)=>a+x.n,0),gok=gs.reduce((a,x)=>a+x.ok,0);const p=gok/gn;
    return `<div class="gc"><span class="eyebrow">${g}</span><b>${gok}<span style="font-size:14px;color:var(--muted)">/${gn}</span></b><span class="minibar" style="width:100%"><i style="width:${p*100}%;background:${p>=.75?"var(--ok)":p>=.5?"var(--rev)":"var(--bad)"}"></i></span><span>${Math.round(p*100)}% · ${gs.length} subject${gs.length>1?"s":""}</span></div>`}).join("");
  const maxT=Math.max(60,...rows.map(x=>x.t));
  const strip=rows.map(x=>`<i title="Q${x.i+1} · ${esc(SUBJ[x.q.s])} · ${fmtS(x.t)} · ${x.st==="ok"?"correct":x.st==="bad"?"wrong":"skipped"}" style="height:${Math.max(4,x.t/maxT*100)}%;background:${x.st==="ok"?"var(--ok)":x.st==="bad"?"var(--bad)":"var(--skip)"}"></i>`).join("");
  const avgOk=rows.filter(x=>x.st==="ok"),avgBad=rows.filter(x=>x.st==="bad");
  const mean=a=>a.length?a.reduce((s,x)=>s+x.t,0)/a.length:0;
  const left=Math.max(0,DURATION/1000-used);
  const f=S.filter,fs=S.fsub;
  const list=rows.filter(r=>(f==="all"||r.st===f)&&(fs==="all"||r.q.s===+fs)).map(r=>{const p=S.perm[r.i];return`<article class="ri ${r.st}"><div class="wm" style="background-image:${WM}"></div>
    <div class="qhead"><div class="qnum" style="font-size:17px">Q${r.i+1}<small>${esc(SUBJ[r.q.s])}</small></div><span class="status">${r.st==="ok"?"Correct · +1":r.st==="bad"?"Wrong · 0":"Not answered · 0"}</span></div>
    <p class="qtext">${esc(r.q.q)}</p>
    ${p.map((o,k)=>{const cls=k===r.ci?"right":k===r.ua?"wrong":"";const lab=k===r.ci&&k===r.ua?"Your answer":k===r.ci?"Correct answer":k===r.ua?"Your answer":"";return`<div class="ro ${cls}"><span class="bub">${L[k]}</span><span>${esc(r.q.o[o])}</span><em>${lab}</em></div>`}).join("")}
    ${r.q.e?`<div class="meta"><b>Explanation.</b> ${esc(r.q.e)}</div>`:""}<div class="meta">Time spent ${fmtS(r.t)} · Source: ${/^\d/.test(r.q.src)?"Past CET paper "+esc(r.q.src):esc(r.q.src)}</div></article>`}).join("")||`<p style="color:var(--muted)">No questions match these filters.</p>`;
  const chip=(k,t,n)=>`<button class="chipb ${f===k?"on":""}" data-filter="${k}">${t} · ${n}</button>`;
  const opts=`<option value="all">All subjects</option>`+SUBJ.map((s,i)=>!sub[i].n?"":`<option value="${i}" ${fs===String(i)?"selected":""}>${esc(s)}</option>`).join("");
  return `<div class="topbar"><div class="in"><div class="brand">PGO Mock <i>Lab</i></div><div class="sec">Scorecard · ${esc(T.title)}</div>${themeBtn()}<button class="btn" data-act="home">My mocks</button></div></div>
  <div class="wrap"><div class="rgrid">
    ${S.demo?`<div class="demo">Sample scorecard built from a simulated attempt. Take the test to see your own.</div>`:""}
    <section class="card hero">
      <div class="ring" role="img" aria-label="Score ${ok} out of ${N}"><svg viewBox="0 0 160 160"><circle cx="80" cy="80" r="70" fill="none" stroke="var(--line)" stroke-width="12"/><circle cx="80" cy="80" r="70" fill="none" stroke="var(--pen)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${dash} ${circ}"/></svg><div class="c"><div><b>${ok}</b><small>out of ${N}</small></div></div></div>
      <div><div class="eyebrow">Scorecard for ${esc(S.name)}</div>
        <h1 style="font-size:clamp(24px,3.2vw,32px);margin-top:6px">${proj>=65?"Merit-list territory. Keep the weak subjects from slipping.":proj>=45?"In the selection range of past years. The subjects below decide your rank.":"Building up. Start with the three subjects that cost the most."}</h1>
        <div class="kpis">
          <div class="kpi"><b style="color:var(--ok)">${ok}</b><span>Correct</span></div>
          <div class="kpi"><b style="color:var(--bad)">${bad}</b><span>Wrong</span></div>
          <div class="kpi"><b>${sk}</b><span>Not answered</span></div>
          <div class="kpi"><b>${acc}%</b><span>Accuracy on attempted</span></div>
          <div class="kpi"><b>${fmtS(used)}</b><span>Time used of ${T.mins}m</span></div>
          <div class="kpi"><b>${S.tabs}</b><span>Tab switches</span></div>
        </div></div>
      <div class="rank"><h3>${N===100?`Where ${ok} would have ranked`:`At this accuracy (≈${proj}/100) you would have ranked`}</h3>${ranks}<p>Rank among candidates on the official provisional merit lists (all categories). Mock scores are a guide, not a guarantee.</p></div>
    </section>
    ${S.test==="demo"&&ME&&ME.pricing.packNow>0?`<section class="bundle"><div><span class="eyebrow">Ready for the real thing?</span><h2>${ME.pricing.fullCount} full mock tests</h2><p class="small">${ME.pricing.fullCount*100} questions, all 22 subjects in CET proportions, this scorecard after every mock.</p></div><div class="row"><b class="mono" style="font-size:26px">${rs(ME.pricing.packNow)}</b><button class="btn primary" data-act="buy" data-item="pack">Get all ${ME.pricing.fullCount} mocks</button></div></section>`:""}
    <section class="card"><div class="sh"><h2>Key takeaways</h2></div><div class="insights">${ins.join("")}</div></section>
    <section class="card"><div class="sh"><h2>Where your marks went</h2><p>Marks lost in each subject, biggest first. Subjects with more CET questions cost more when weak.</p></div>
      <div class="legend" style="margin-bottom:12px"><span><i class="sw" style="background:var(--bad)"></i>Wrong</span><span><i class="sw" style="background:var(--skip)"></i>Skipped</span><span><i class="sw" style="background:var(--ok-soft)"></i>Correct</span></div>
      <div class="lost">${lost||`<p>No marks lost. Remarkable.</p>`}</div></section>
    <section class="card"><div class="sh"><h2>Section summary</h2><p>The 22 CET subjects grouped into five areas.</p></div><div class="groups">${groups}</div></section>
    <section class="card"><div class="sh"><h2>Subject report</h2><p>Strong = 75%+ correct · Needs work = 50–74% · Weak = below 50%.</p></div>
      <div class="tblwrap"><table><thead><tr><th>Subject</th><th class="n">Qs</th><th class="n">Correct</th><th class="n">Wrong</th><th class="n">Skipped</th><th class="n">Accuracy</th><th class="n">Avg time</th><th>Status</th></tr></thead><tbody>${table}</tbody></table></div></section>
    <section class="card"><div class="sh"><h2>Time analysis</h2><p>Each bar is one question in paper order; height is time spent. Hover a bar for details.</p></div>
      <div class="legend" style="margin-bottom:8px"><span><i class="sw" style="background:var(--ok)"></i>Correct</span><span><i class="sw" style="background:var(--bad)"></i>Wrong</span><span><i class="sw" style="background:var(--skip)"></i>Skipped</span></div>
      <div class="strip" role="img" aria-label="Time spent per question">${strip}</div>
      <div class="tstats">
        <div><b>${fmtS(mean(avgOk))}</b><span>Average on correct answers</span></div>
        <div><b>${fmtS(mean(avgBad))}</b><span>Average on wrong answers</span></div>
        <div><b>${rushed}</b><span>Wrong in under 20 seconds</span></div>
        <div><b>${stuck.length}</b><span>Questions over 2 minutes</span></div>
        <div><b>${fmtS(left)}</b><span>Time left unused</span></div>
      </div></section>
    <section><div class="sh"><h2>Answer review</h2></div>
      <div class="filters">${chip("all","All",N)}${chip("bad","Wrong",bad)}${chip("skip","Not answered",sk)}${chip("ok","Correct",ok)}<label class="sr" for="fsub" style="position:absolute;left:-9999px">Subject</label><select id="fsub">${opts}</select></div>
      <div class="rev">${list}</div></section>
  </div></div>${foot()}`;
}

/* ---------- admin ---------- */
function vAdmin(){const a=S.admin;if(!a)return `${bar("Admin",true)}<div class="wrap"><p>Loading…</p></div>`;
  const d=ms=>new Date(ms).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
  return `${bar("Admin",true)}<div class="wrap"><div class="rgrid">
    <section class="card"><div class="sh"><h2>Overview</h2></div><div class="kpis"><div class="kpi"><b>${a.users.length}</b><span>Students</span></div><div class="kpi"><b>${a.orders.length}</b><span>Paid orders</span></div><div class="kpi"><b>${rs(a.revenue)}</b><span>Revenue (real payments)</span></div></div></section>
    <section class="card"><div class="sh"><h2>Give a mock to a student</h2><p>For free passes or payment disputes. The student must have signed in once.</p></div>${S.msg?`<div class="okmsg">${esc(S.msg)}</div>`:""}${errBox()}
      <form id="gf" class="row"><input id="ge" type="email" placeholder="student@email.com" style="padding:10px;border:1.5px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink);font:inherit;flex:1;min-width:200px" aria-label="Student email"><select id="gt" aria-label="Mock" style="padding:10px;border-radius:8px;border:1.5px solid var(--line);background:var(--sheet)"><option value="pack">All mocks</option>${a.tests.filter(t=>t.id!=="demo").map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join("")}</select><button class="btn primary" type="submit">Give access</button></form></section>
    <section class="card"><div class="sh"><h2>Students</h2></div><div class="tblwrap"><table><thead><tr><th>Email</th><th>Name</th><th>Joined</th><th>Owns</th><th class="n">Sign-ins</th><th>Scores</th></tr></thead><tbody>${a.users.map(u=>`<tr><td>${esc(u.email)}</td><td>${esc(u.name)}</td><td>${d(u.joined)}</td><td>${esc(u.owns.join(", ")||"-")}</td><td class="n">${u.logins}</td><td>${esc(u.attempts.map(x=>`${x.test}: ${x.score}`).join(" · ")||"-")}</td></tr>`).join("")||`<tr><td colspan="6">No students yet.</td></tr>`}</tbody></table></div></section>
    <section class="card"><div class="sh"><h2>Orders</h2></div><div class="tblwrap"><table><thead><tr><th>Date</th><th>Email</th><th>Item</th><th class="n">Amount</th><th>Method</th><th>Paid by</th></tr></thead><tbody>${a.orders.map(o=>`<tr><td>${d(o.paidAt)}</td><td>${esc(o.email||"")}</td><td>${esc(o.label)}</td><td class="n">${rs(o.amount)}</td><td>${esc(o.method||"-")}</td><td>${o.via==="dev"?"Simulated":esc(o.via)}</td></tr>`).join("")||`<tr><td colspan="6">No orders yet.</td></tr>`}</tbody></table></div></section>
  </div></div>${foot()}`}

/* ---------- pay page ---------- */
function payInfo(){const p=ME.pricing,item=S.pay.item;if(item==="pack")return{label:p.ownedFull?`Upgrade to all ${p.fullCount} mocks`:`All ${p.fullCount} full mock tests`,amount:p.packNow,detail:p.ownedFull?`Pack price ${rs(p.pack)} minus ${rs(p.single*p.ownedFull)} already paid for ${p.ownedFull} mock${p.ownedFull>1?"s":""}`:`${p.fullCount*100} questions · you save ${rs(p.single*p.fullCount-p.pack)} against buying singly`};
  const t=ME.tests.find(x=>x.id===item);return{label:t?t.title:"Mock test",amount:p.single,detail:`${t?t.n:100} questions · ${t?t.minutes:90} minutes · scorecard and answer review`}}
function vPay(){const o=payInfo(),m=S.pay.method||"upi";
  return `${bar("Payment",true)}<div class="wrap"><div class="pay">
    <section class="card"><div class="eyebrow">Step 1 of 2</div><h1 style="font-size:clamp(24px,3vw,32px);margin:6px 0 14px">Choose how to pay</h1>
      <div class="methods" role="radiogroup" aria-label="Payment method">${METHODS.map(([id,name,sub])=>`<button class="method ${m===id?"sel":""}" role="radio" aria-checked="${m===id}" data-method="${id}"><span class="bub">${m===id?"✓":""}</span><span><b>${name}</b><small>${sub}</small></span></button>`).join("")}</div>
      <p class="small" style="margin-top:14px">You enter your ${m==="upi"?"UPI ID":m==="netbanking"?"bank login":m==="wallet"?"wallet details":"card number"} in Razorpay's secure window on the next step. PGO Mock Lab never sees or stores your card, UPI or bank details.</p></section>
    <aside class="card summary"><div class="eyebrow">Order summary</div><h2 style="font-size:20px;margin:6px 0 4px">${esc(o.label)}</h2><p class="small">${esc(o.detail)}</p>
      <div class="mrow"><span>Price</span><b class="mono">${rs(o.amount)}</b></div><div class="mrow"><span>Taxes and fees</span><b class="mono">Included</b></div>
      <div class="mrow" style="border:0;font-size:18px"><span><b>Total</b></span><b class="mono">${rs(o.amount)}</b></div>
      ${errBox()}${ME.payments==="dev"?`<div class="demo">Local test mode: no money will move. The payment is simulated.</div>`:ME.payments==="off"?`<div class="err">Payments are not switched on yet.</div>`:""}
      <button class="btn primary wide" data-act="paynow" ${S.busy||ME.payments==="off"?"disabled":""}>${S.busy?"Opening secure payment…":`Pay ${rs(o.amount)} securely`}</button>
      <button class="btn ghost wide" data-act="home" style="margin-top:8px">Cancel</button>
      <p class="small" style="margin-top:12px">Signed in as ${esc(S.email)}. Your mocks unlock as soon as the payment is confirmed. Need help? ${CONTACT}</p></aside>
  </div></div>${foot()}`}

/* ---------- payments ---------- */
function loadScript(src){return new Promise((ok,no)=>{if(window.Razorpay)return ok();const s=document.createElement("script");s.src=src;s.onload=ok;s.onerror=()=>no(new Error("Could not load the payment window. Check your connection."));document.head.appendChild(s)})}
async function buy(item,method){
  S.err="";S.msg="";S.busy=true;render();
  try{
    const o=await api("POST","/api/checkout",{item,method});S.busy=false;
    if(o.mode==="dev"){await loadMe();S.msg=`Local test mode: payment of ${rs(o.amount)} for "${o.label}" was simulated. No money moved.`;S.screen="home";render();scrollTo(0,0);return}
    await loadScript("https://checkout.razorpay.com/v1/checkout.js");
    new window.Razorpay({key:o.keyId,amount:o.amount,currency:"INR",name:o.name,description:o.label,order_id:o.razorpayOrderId,prefill:{email:o.email,method:method==="credit"||method==="debit"?"card":method},theme:{color:"#7a4a1d"},modal:{ondismiss:()=>{S.busy=false;S.err="Payment window closed. You have not been charged.";render()}},
      handler:async resp=>{try{await api("POST","/api/checkout/verify",resp);await loadMe();S.msg=`Payment received. "${o.label}" is unlocked.`;S.screen="home";render();scrollTo(0,0)}catch(e){fail(e)}}}).open();
  }catch(e){S.busy=false;fail(e)}
}

/* ---------- render and events ---------- */
function render(){
  const v={loading:()=>`<div class="wrap"><p>Loading…</p></div>`,login:vLogin,otp:vOtp,name:vName,home:vHome,start:vStart,test:vTest,result:vResult,admin:vAdmin,pay:vPay}[S.screen];
  app.innerHTML=v();
}
app.addEventListener("submit",async e=>{e.preventDefault();const id=e.target.id;
  if(id==="lf")return sendCode();if(id==="of")return verify();
  if(id==="nf"){const n=document.getElementById("nm").value.trim();if(!n){S.err="Enter your name.";return render()}try{await api("POST","/api/profile",{name:n});S.name=n;ME.name=n;S.err="";S.screen="home";render()}catch(x){fail(x)}}
  if(id==="gf"){S.msg="";S.err="";try{await api("POST","/api/admin/grant",{email:document.getElementById("ge").value.trim(),testId:document.getElementById("gt").value});S.admin=await api("GET","/api/admin/overview");S.msg="Access given.";render()}catch(x){fail(x)}}
});
app.addEventListener("change",e=>{if(e.target.id==="fsub"){S.fsub=e.target.value;render()}});
app.addEventListener("click",async e=>{
  const t=e.target.closest("[data-opt],[data-act],[data-go],[data-filter],[data-method]");if(!t)return;
  try{
    if(t.dataset.opt!==undefined){const k=+t.dataset.opt;S.ans[S.cur]=k;render();post({n:S.cur,chosen:k,seconds:spent()});return}
    if(t.dataset.go!==undefined)return go(+t.dataset.go);
    if(t.dataset.filter){S.filter=t.dataset.filter;return render()}
    if(t.dataset.method){S.pay.method=t.dataset.method;S.err="";return render()}
    const a=t.dataset.act;
    if(a==="prev")go(S.cur-1);
    else if(a==="next")go(S.cur+1);
    else if(a==="clear"){S.ans[S.cur]=null;render();post({n:S.cur,chosen:null,seconds:spent()})}
    else if(a==="mark"){const m=!S.mark[S.cur];S.mark[S.cur]=m;post({n:S.cur,marked:m,seconds:spent()});if(m&&S.cur<N-1)go(S.cur+1);else render()}
    else if(a==="pal"){S.pal=!S.pal;render()}
    else if(a==="theme"){setTheme(THEMES[(THEMES.indexOf(theme())+1)%THEMES.length]);render()}
    else if(a==="submit"){S.confirm=true;render()}
    else if(a==="cancel"){S.confirm=false;render()}
    else if(a==="final")await submitTest();
    else if(a==="home"){clearInterval(tick);S.err="";S.msg="";await loadMe();S.screen="home";render();scrollTo(0,0)}
    else if(a==="change"){S.screen="login";S.err="";render()}
    else if(a==="resend"){if(S.resendAt<=Date.now())await sendCode()}
    else if(a==="signout"){clearInterval(tick);await api("POST","/api/auth/logout");ME=null;S={screen:"login",name:"",email:"",err:""};render()}
    else if(a==="open"){S.sel=ME.tests.find(x=>x.id===t.dataset.t);S.err="";S.screen="start";render();scrollTo(0,0)}
    else if(a==="begin"){const r=await api("POST","/api/attempts",{testId:S.sel.id});await enterAttempt(r.attemptId)}
    else if(a==="resume")await enterAttempt(t.dataset.id);
    else if(a==="score")await showResult(t.dataset.id);
    else if(a==="buy"){clearInterval(tick);await loadMe();S.pay={item:t.dataset.item,method:"upi"};S.err="";S.msg="";S.busy=false;S.screen="pay";render();scrollTo(0,0)}
    else if(a==="paynow")await buy(S.pay.item,S.pay.method);
    else if(a==="admin"){S.admin=null;S.msg="";S.err="";S.screen="admin";render();S.admin=await api("GET","/api/admin/overview");render()}
  }catch(x){fail(x)}
});
/* code boxes: auto-advance, backspace, paste */
app.addEventListener("input",e=>{const el=e.target;if(!el.id||!el.id.startsWith("otp"))return;el.value=el.value.replace(/\D/g,"").slice(-1);const i=+el.id.slice(3);if(el.value&&i<5)document.getElementById("otp"+(i+1)).focus();if(i===5&&el.value)verify()});
app.addEventListener("keydown",e=>{const el=e.target;if(!el.id||!el.id.startsWith("otp"))return;const i=+el.id.slice(3);if(e.key==="Backspace"&&!el.value&&i>0)document.getElementById("otp"+(i-1)).focus()});
app.addEventListener("paste",e=>{const el=e.target;if(!el.id||!el.id.startsWith("otp"))return;const d=(e.clipboardData.getData("text")||"").replace(/\D/g,"").slice(0,6);if(!d)return;e.preventDefault();[...d].forEach((c,k)=>{const b=document.getElementById("otp"+k);if(b)b.value=c});if(d.length===6)verify();else document.getElementById("otp"+d.length).focus()});
/* anti-copy measures on test and review screens */
const guarded=()=>S.screen==="test"||S.screen==="result";
document.addEventListener("contextmenu",e=>{if(guarded())e.preventDefault()});
document.addEventListener("copy",e=>{if(guarded())e.preventDefault()});
document.addEventListener("keydown",e=>{
  if(guarded()&&(e.ctrlKey||e.metaKey)&&["c","p","s","a"].includes(e.key.toLowerCase())){e.preventDefault();return}
  if(S.screen!=="test"||S.confirm||e.target.tagName==="INPUT")return;
  if(e.key==="ArrowRight")go(S.cur+1);else if(e.key==="ArrowLeft")go(S.cur-1);
  else{const k="abcd".indexOf(e.key.toLowerCase());if(k>-1&&qCache[S.cur]){S.ans[S.cur]=k;render();post({n:S.cur,chosen:k,seconds:spent()})}}
});
document.addEventListener("visibilitychange",()=>{if(S.screen!=="test")return;if(document.hidden){post({n:S.cur,seconds:spent()});api("POST",`/api/attempts/${AT.id}/tab`).then(r=>{S.tabs=r.tabs}).catch(()=>{})}else{S.qStart=Date.now();render()}const q=document.getElementById("qcard");if(q)q.classList.toggle("blur",document.hidden)});
window.addEventListener("blur",()=>{const q=document.getElementById("qcard");if(q&&S.screen==="test")q.classList.add("blur")});
window.addEventListener("focus",()=>{const q=document.getElementById("qcard");if(q)q.classList.remove("blur")});

/* ---------- start ---------- */
(async()=>{render();try{await loadMe();const open=ME.tests.find(t=>t.openAttempt);S.screen=ME.name?"home":"name";render();if(open&&ME.name){S.msg=`You have a test in progress: ${open.title}. Tap Resume to continue; the clock is still running.`;render()}}catch(e){if(e.message!=="signed-out"){S.screen="login";S.err="";render()}}})();
