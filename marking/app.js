"use strict";
/* ---------- helpers ---------- */
function h(tag, attrs, ...kids){
  const el=document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){
    if(v==null||v===false) continue;
    if(k==='class') el.className=v;
    else if(k.startsWith('on')) el.addEventListener(k.slice(2),v);
    else if(k==='value') el.value=v;
    else if(v===true) el.setAttribute(k,'');
    else el.setAttribute(k,v);
  }
  for(const kid of kids.flat(Infinity)){ if(kid==null||kid===false) continue; el.append(kid.nodeType?kid:String(kid)); }
  return el;
}
const $=s=>document.querySelector(s);
const fmt=n=>Number.isInteger(n)?String(n):(Math.round(n*100)/100).toString();
const pct=(a,b)=>b>0?Math.round(a/b*100):0;
const rid=()=>'q'+Math.random().toString(36).slice(2,9);
const when=iso=>{ if(!iso) return ''; const d=new Date(iso); return isNaN(d)?'':d.toLocaleString(undefined,{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}); };
let toastT;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),4000); }
function confirmBtn(label,onConfirm,armedLabel){
  let armed=false,t;
  const b=h('button',{type:'button',class:'btn quiet danger'},label);
  b.addEventListener('click',()=>{
    if(!armed){ armed=true; b.textContent=armedLabel||('Confirm '+label.toLowerCase()); b.classList.add('armed');
      t=setTimeout(()=>{armed=false;b.textContent=label;b.classList.remove('armed');},5000); }
    else { clearTimeout(t); b.disabled=true; onConfirm(); }
  });
  return b;
}
function remember(k,v){ try{ if(v===undefined) return localStorage.getItem(k)||''; localStorage.setItem(k,v); }catch(e){} return ''; }

/* ---------- state and server calls ---------- */
const CFG=window.MD_CONFIG||{};
const state={
  setup:true,role:null,token:'',staffCanEdit:false,loaded:false,fatal:'',
  exams:[],mine:[],results:[],resultsSig:'',
  view:'enter',examId:null,marker:remember('md-marker'),draft:newDraft(),formError:'',dupPending:false,saving:false,
  editing:null,editError:'',resExamId:null,showMcq:false,sort:'time',loginMode:'staff',authError:'',settingsError:''
};
function newDraft(){ return {studentId:'',sa:{},mcq:[],editId:null}; }
function keepToken(t){ state.token=t||''; try{ if(t) sessionStorage.setItem('md-token',t); else sessionStorage.removeItem('md-token'); }catch(e){} }
function configured(){ return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(CFG.supabaseUrl||'')&&!/PASTE|YOUR-/.test((CFG.supabaseKey||'')+(CFG.supabaseUrl||''))||/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(CFG.supabaseUrl||''); }
async function rpc(fn,params){
  const key=String(CFG.supabaseKey||''), headers={'Content-Type':'application/json',apikey:key};
  if(key.startsWith('eyJ')) headers.Authorization='Bearer '+key;   // older "anon" keys
  let r,j;
  try{ r=await fetch(String(CFG.supabaseUrl).replace(/\/$/,'')+'/rest/v1/rpc/'+fn,{method:'POST',headers,body:JSON.stringify(params||{}),cache:'no-store',referrerPolicy:'no-referrer'}); }
  catch(e){ throw Object.assign(new Error('Can’t reach the results database. Check your internet connection. On the school network, the filter may be blocking supabase.co.'),{status:0}); }
  const text=await r.text(); try{ j=text?JSON.parse(text):null; }catch(e){ j=null; }
  if(r.ok) return j;
  const hint=j&&j.hint||'';
  if(hint==='auth'){ keepToken(''); if(state.role){ state.role=null; state.authError='Your session ended. Sign in again.'; render(); } }
  let msg=j&&j.message||'';
  if(r.status===404||(j&&j.code==='PGRST202')) msg='The database is not set up yet. Run supabase-setup.sql in the Supabase SQL Editor (see README).';
  else if(r.status===401||r.status===403&&!hint) msg='The database refused the key. Check the publishable key in config.js.';
  else if(r.status>=500||!msg) msg='The results database had a problem (code '+r.status+'). If it keeps happening, check the project isn’t paused in Supabase.';
  throw Object.assign(new Error(msg),{status:r.status,hint});
}
const canEditExams=()=>state.role==='admin'||(state.role==='staff'&&state.staffCanEdit);
const examById=id=>state.exams.find(e=>e.id===id)||null;
const letters=x=>'ABCDE'.slice(0,x.mcqOptions===5?5:4).split('');
function score(x,e){
  let sa=0,saMax=0,mc=0,mcMax=0; const key=x.mcqKey||[];
  for(const q of x.sa||[]){ saMax+=Number(q.max)||0; const v=e.sa?Number(e.sa[q.id]):NaN; if(!isNaN(v)) sa+=v; }
  for(let i=0;i<(x.mcqCount||0);i++){ if(key[i]){ mcMax++; if(e.mcq&&e.mcq[i]===key[i]) mc++; } }
  return {sa,saMax,mc,mcMax,total:sa+mc,max:saMax+mcMax};
}
function examMeta(x){
  const parts=[], n=(x.sa||[]).length;
  if(n) parts.push(n+' short-answer part'+(n>1?'s':'')+', '+fmt((x.sa||[]).reduce((s,q)=>s+(Number(q.max)||0),0))+' marks');
  if(x.mcqCount) parts.push(x.mcqCount+' multiple choice');
  return parts.join(' · ')||'No questions yet';
}
async function loadState(){
  if(!configured()){ state.fatal='This site isn\u2019t connected to its database yet. Fill in the Supabase details in config.js (see README).'; state.loaded=true; return; }
  let t=''; try{ t=sessionStorage.getItem('md-token')||''; }catch(e){}
  state.role=null;
  if(t){ try{ const w=await rpc('md_whoami',{p_token:t}); keepToken(t); state.role=w.role; state.staffCanEdit=w.staffCanEditExams; state.setup=true; state.loaded=true; return; }catch(e){ if(e.hint!=='auth') throw e; } }
  const s=await rpc('md_status'); state.setup=s.setup; state.loaded=true;
}
function signedIn(r){ keepToken(r.token); state.role=r.role; state.staffCanEdit=r.staffCanEditExams; state.setup=true; }
async function loadExams(){ state.exams=await rpc('md_exams',{p_token:state.token}); }
async function loadMine(){ state.mine=state.examId?await rpc('md_my_results',{p_token:state.token,p_exam_id:state.examId}):[]; }
async function loadResults(quiet){
  if(!state.resExamId){ state.results=[]; return; }
  const r=await rpc('md_results',{p_token:state.token,p_exam_id:state.resExamId}), sig=JSON.stringify(r);
  if(quiet&&sig===state.resultsSig) return false;
  state.results=r; state.resultsSig=sig; return true;
}

/* ---------- multiple-choice grid (entry and answer key) ---------- */
function mcqGrid(count,opts,values,onChange){
  values.length=count; for(let i=0;i<count;i++) if(!values[i]) values[i]='';
  const grid=h('div',{class:'mcq-grid'}), rows=[];
  const paint=i=>rows[i].querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.l===values[i])));
  const focusRow=i=>{ const r=rows[i]; if(!r) return; (r.querySelector('[aria-pressed="true"]')||r.querySelector('button')).focus(); };
  for(let i=0;i<count;i++){
    const row=h('div',{class:'mcq-row',role:'group','aria-label':'Question '+(i+1)},
      h('span',{class:'mcq-n'},i+1),
      opts.map(l=>h('button',{type:'button','data-l':l,'aria-pressed':String(values[i]===l),
        onclick:()=>{ values[i]=values[i]===l?'':l; paint(i); onChange(); }},l)));
    rows.push(row); grid.append(row);
  }
  grid.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    const row=e.target.closest('.mcq-row'); if(!row) return;
    const i=rows.indexOf(row), k=e.key.toUpperCase();
    if(opts.includes(k)){ e.preventDefault(); values[i]=k; paint(i); onChange(); focusRow(i+1); }
    else if(e.key==='Backspace'||e.key==='Delete'){ e.preventDefault(); values[i]=''; paint(i); onChange(); if(e.key==='Backspace') focusRow(i-1); }
    else if(e.key==='ArrowDown'){ e.preventDefault(); focusRow(i+1); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); focusRow(i-1); }
  });
  return grid;
}

/* ---------- shell ---------- */
function views(){ const v=['enter']; if(canEditExams()) v.push('exams'); if(state.role==='admin') v.push('results','settings'); return v; }
function route(){ const v=location.hash.slice(1); state.view=views().includes(v)?v:'enter'; }
function renderNav(){
  const nav=$('#nav'); if(!state.role){ nav.replaceChildren(); return; }
  const names={enter:'Enter results',exams:'Exams',results:'All results',settings:'Settings'};
  nav.replaceChildren(...views().map(v=>h('a',{href:'#'+v,'aria-current':state.view===v?'page':null},names[v])),
    h('button',{type:'button',onclick:signOut},'Sign out'));
}
function render(){
  renderNav();
  const v=$('#view');
  if(state.fatal){ v.replaceChildren(h('div',{class:'notice'},state.fatal)); return; }
  if(!state.loaded){ v.replaceChildren(h('p',{class:'muted'},'Loading…')); return; }
  if(!state.setup){ v.replaceChildren(renderSetup()); return; }
  if(!state.role){ v.replaceChildren(renderLogin()); return; }
  route();
  if(state.view==='exams') v.replaceChildren(...renderExams());
  else if(state.view==='results') v.replaceChildren(...renderResults());
  else if(state.view==='settings') v.replaceChildren(...renderSettings());
  else v.replaceChildren(...renderEnter());
}
async function enterApp(){
  if(!state.role) await loadState();
  if(state.role){ await loadExams(); route(); await loadView(); }
  render();
}
async function loadView(){
  if(state.view==='enter'){ if(!examById(state.examId)) state.examId=state.exams[0]?state.exams[0].id:null; await loadMine(); }
  if(state.view==='results'&&state.role==='admin'){ if(!examById(state.resExamId)) state.resExamId=state.exams[0]?state.exams[0].id:null; await loadResults(); }
}
async function signOut(){ const t=state.token; keepToken(''); clearTimeout(toastT); $('#toast').classList.remove('show'); try{ await rpc('md_logout',{p_token:t}); }catch(e){} state.role=null; state.draft=newDraft(); state.mine=[]; state.results=[]; state.authError=''; render(); }

/* ---------- first-time setup and sign in ---------- */
function renderSetup(){
  const err=h('p',{class:'error',role:'alert'},state.authError);
  return h('form',{class:'card narrow',novalidate:true,onsubmit:async e=>{ e.preventDefault();
      const a=$('#su-admin').value,a2=$('#su-admin2').value,s=$('#su-staff').value;
      if(a!==a2){ err.textContent='The two admin passwords do not match.'; return; }
      try{ signedIn(await rpc('md_setup',{p_admin:a,p_staff:s})); state.authError=''; await enterApp(); toast('Setup complete. You are signed in as administrator.'); }
      catch(x){ err.textContent=x.message; } }},
    h('h2',{},'Set up this site'),
    h('p',{class:'muted'},'Choose the two passwords. Keep the admin password to yourself; give the staff passcode to the people entering results.'),
    h('label',{class:'f'},'Admin password (at least 10 characters)',h('input',{id:'su-admin',type:'password',autocomplete:'new-password'})),
    h('label',{class:'f'},'Admin password again',h('input',{id:'su-admin2',type:'password',autocomplete:'new-password'})),
    h('label',{class:'f'},'Staff passcode (at least 6 characters)',h('input',{id:'su-staff',type:'text',autocomplete:'off'})),
    err,h('div',{},h('button',{class:'btn',type:'submit'},'Finish setup')));
}
function renderLogin(){
  const admin=state.loginMode==='admin', err=h('p',{class:'error',role:'alert'},state.authError);
  return h('form',{class:'card narrow',novalidate:true,onsubmit:async e=>{ e.preventDefault();
      try{ const r=await rpc('md_login',{p_role:state.loginMode,p_password:$('#login-pass').value});
        if(r.error){ err.textContent=r.error; $('#login-pass').select(); return; }
        signedIn(r); state.authError=''; await enterApp(); }
      catch(x){ err.textContent=x.message; } }},
    h('h2',{},admin?'Administrator sign in':'Staff sign in'),
    h('label',{class:'f'},admin?'Admin password':'Staff passcode',h('input',{id:'login-pass',type:'password',autocomplete:admin?'current-password':'off',autofocus:true})),
    err,
    h('div',{class:'row mid between'},h('button',{class:'btn',type:'submit'},'Sign in'),
      h('button',{class:'btn quiet',type:'button',onclick:()=>{state.loginMode=admin?'staff':'admin';state.authError='';render();}},admin?'Staff sign in':'Administrator sign in')));
}

/* ---------- enter results ---------- */
function liveTotals(x){
  const d=state.draft, e={sa:{},mcq:d.mcq};
  for(const q of x.sa||[]) if(d.sa[q.id]!==''&&d.sa[q.id]!=null) e.sa[q.id]=Number(d.sa[q.id]);
  const s=score(x,e), out=[];
  if(s.saMax) out.push(h('span',{},'Short answer ',h('b',{},fmt(s.sa)),' / '+fmt(s.saMax)));
  if(x.mcqCount){ const done=d.mcq.slice(0,x.mcqCount).filter(Boolean).length;
    out.push(h('span',{},'Multiple choice answered ',h('b',{},done),' / '+x.mcqCount));
    if(done<x.mcqCount) out.push(h('span',{class:'muted small'},'Blanks are saved as no answer')); }
  return out;
}
function renderEnter(){
  if(!state.exams.length) return [h('section',{class:'card'},h('h2',{},'No exams yet'),
    h('p',{class:'muted'},canEditExams()?'Set up an exam first, then come back here to enter results.':'The administrator has not set up an exam yet.'),
    canEditExams()?h('div',{},h('a',{class:'btn',href:'#exams'},'Go to Exams')):null)];
  if(!examById(state.examId)) state.examId=state.exams[0].id;
  const x=examById(state.examId), d=state.draft, opts=letters(x);
  const totals=h('div',{class:'totals'},liveTotals(x)), upd=()=>totals.replaceChildren(...liveTotals(x));
  const select=h('select',{id:'exam-select',onchange:async e=>{ state.examId=Number(e.target.value); state.draft=newDraft(); state.formError=''; state.dupPending=false; try{ await loadMine(); }catch(_){} render(); }},
    state.exams.map(o=>h('option',{value:o.id},o.title)));
  select.value=String(state.examId);
  const form=h('form',{class:'card',novalidate:true,onsubmit:e=>{e.preventDefault();submitEntry(false);}},
    h('div',{class:'row between'},h('h2',{},d.editId?'Edit entry':'Enter a student’s results'),h('span',{class:'muted small'},examMeta(x))),
    h('div',{class:'fields'},
      h('label',{class:'f'},'Exam',select),
      h('label',{class:'f'},'Your name',h('input',{id:'marker',type:'text',autocomplete:'name',maxlength:'80',value:state.marker,oninput:e=>{state.marker=e.target.value;}})),
      h('label',{class:'f'},'Student ID',h('input',{id:'student-id',type:'text',autocomplete:'off',maxlength:'40',value:d.studentId,oninput:e=>{d.studentId=e.target.value;state.dupPending=false;}}))),
    (x.sa||[]).length?[h('h3',{},'Short answer'),
      h('div',{class:'sa-list'},x.sa.map(q=>h('div',{class:'sa-row'},
        h('label',{class:'q',for:'sa-'+q.id},q.label),
        h('input',{type:'number',id:'sa-'+q.id,class:'sa-in',min:'0',max:String(q.max),step:'0.5',inputmode:'decimal','aria-label':'Marks for '+q.label,
          value:d.sa[q.id]??'',oninput:e=>{d.sa[q.id]=e.target.value;upd();},
          onkeydown:e=>{ if(e.key==='Enter'){ e.preventDefault(); const all=[...document.querySelectorAll('.sa-in')], n=all[all.indexOf(e.target)+1]; if(n) n.focus(); else { const m=document.querySelector('.mcq-row button'); if(m) m.focus(); } } }}),
        h('span',{class:'muted'},'/ '+fmt(Number(q.max))))))]:null,
    x.mcqCount?[h('h3',{},'Multiple choice'),
      h('p',{class:'muted small'},'Click the student’s answer, or type '+opts[0]+'–'+opts[opts.length-1]+' and the cursor moves to the next question. Backspace clears.'),
      mcqGrid(x.mcqCount,opts,d.mcq,upd)]:null,
    totals,
    h('p',{class:'error',id:'form-error',role:'alert'},state.formError),
    h('div',{class:'row'},
      h('button',{class:'btn',type:'submit',disabled:state.saving},state.saving?'Saving…':(d.editId?'Save changes':'Submit results')),
      state.dupPending?h('button',{class:'btn quiet',type:'button',onclick:()=>submitEntry(true)},'Submit anyway'):null,
      d.editId?h('button',{class:'btn quiet',type:'button',onclick:()=>{state.draft=newDraft();state.formError='';render();}},'Cancel edit'):null));
  return [form,h('section',{class:'card'},renderMine(x))];
}
function renderMine(x){
  const rows=state.mine;
  const head=h('div',{class:'row between'},h('h2',{},'Your entries this session'),h('span',{class:'muted small'},rows.length+' entered'));
  if(!rows.length) return [head,h('p',{class:'muted'},'Entries you submit appear here until you sign out or close the tab, so you can check or fix them.')];
  return [head,h('div',{class:'scroll'},h('table',{},
    h('thead',{},h('tr',{},h('th',{},'Student ID'),(x.sa||[]).length?h('th',{class:'n'},'Short answer'):null,x.mcqCount?h('th',{},'Multiple choice'):null,h('th',{},'Entered'),h('th',{},''))),
    h('tbody',{},rows.map(e=>{ const s=score(x,e); return h('tr',{},
      h('td',{class:'strong'},e.studentId),
      (x.sa||[]).length?h('td',{class:'n'},fmt(s.sa)+' / '+fmt(s.saMax)):null,
      x.mcqCount?h('td',{},(e.mcq||[]).map(a=>a||'·').join(' ')):null,
      h('td',{},when(e.submittedAt)),
      h('td',{},h('div',{class:'row'},
        h('button',{class:'btn quiet',type:'button',onclick:()=>editEntry(e)},'Edit'),
        confirmBtn('Delete',async()=>{ try{ await rpc('md_result_delete',{p_token:state.token,p_id:e.id}); await loadMine(); }catch(er){ toast(er.message); } render(); }))));
    }))))];
}
function editEntry(e){
  const sa={}; for(const k in (e.sa||{})) sa[k]=String(e.sa[k]);
  state.draft={studentId:e.studentId||'',sa,mcq:[...(e.mcq||[])],editId:e.id};
  state.formError=''; state.dupPending=false; render(); window.scrollTo(0,0);
}
async function submitEntry(force){
  const x=examById(state.examId), d=state.draft; if(!x||state.saving) return;
  const fail=(m,id)=>{ state.formError=m; $('#form-error').textContent=m; const el=id&&document.getElementById(id); if(el) el.focus(); };
  const marker=state.marker.trim(), studentId=d.studentId.trim();
  if(!marker) return fail('Enter your name so the entry shows who marked it.','marker');
  if(!studentId) return fail('Enter the student ID.','student-id');
  const sa={};
  for(const q of x.sa||[]){
    const raw=d.sa[q.id]; if(raw===''||raw==null) return fail('Enter a mark for question '+q.label+'.','sa-'+q.id);
    const v=Number(raw); if(isNaN(v)||v<0||v>Number(q.max)) return fail('Question '+q.label+' must be between 0 and '+fmt(Number(q.max))+'.','sa-'+q.id);
    sa[q.id]=v;
  }
  const mcq=[]; for(let i=0;i<(x.mcqCount||0);i++) mcq.push(d.mcq[i]||'');
  state.saving=true; state.formError=''; render();
  try{
    remember('md-marker',marker);
    await rpc('md_result_save',{p_token:state.token,p_result:{id:d.editId||0,examId:x.id,studentId,marker,sa,mcq,force:!!force}});
    state.saving=false; state.dupPending=false; state.draft=newDraft();
    try{ await loadMine(); }catch(_){}
    toast('Saved results for student '+studentId+'.'); render();
    const f=$('#student-id'); if(f) f.focus();
  }catch(err){
    state.saving=false; state.dupPending=err.hint==='duplicate';
    state.formError=err.message+(state.dupPending?' Check the ID, or choose Submit anyway to add a second entry.':''); render();
  }
}

/* ---------- exams ---------- */
function renderExams(){
  if(state.editing) return [renderEditor()];
  return [h('section',{class:'card'},
    h('div',{class:'row between'},h('h2',{},'Exams'),h('button',{class:'btn',type:'button',onclick:()=>startEdit(null)},'New exam')),
    state.exams.length?h('div',{},state.exams.map(x=>h('div',{class:'exam-item'},
      h('div',{},h('div',{class:'strong'},x.title),h('div',{class:'muted small'},examMeta(x)+(x.resultCount!=null?' · '+x.resultCount+' result'+(x.resultCount===1?'':'s')+' entered':''))),
      h('div',{class:'row'},
        h('button',{class:'btn quiet',type:'button',onclick:()=>{state.examId=x.id;state.draft=newDraft();location.hash='enter';}},'Enter results'),
        h('button',{class:'btn quiet',type:'button',onclick:()=>startEdit(x)},'Edit'),
        state.role==='admin'?confirmBtn('Delete',async()=>{ try{ await rpc('md_exam_delete',{p_token:state.token,p_id:x.id}); await loadExams(); toast('Exam deleted.'); }catch(er){ toast(er.message); } render(); },
          x.resultCount?'Delete exam and its '+x.resultCount+' result'+(x.resultCount===1?'':'s'):'Confirm delete'):null))))
      :h('p',{class:'muted'},'No exams yet. Create one to start entering results.'))];
}
function startEdit(x){
  state.editing=x?{id:x.id,title:x.title||'',sa:(x.sa||[]).map(q=>({id:q.id,label:q.label,max:String(q.max)})),mcqCount:String(x.mcqCount||0),mcqOptions:x.mcqOptions===5?5:4,mcqKey:[...(x.mcqKey||[])]}
    :{id:0,title:'',sa:[{id:rid(),label:'',max:''}],mcqCount:'0',mcqOptions:4,mcqKey:[]};
  state.editError=''; render();
}
function renderEditor(){
  const d=state.editing, saBox=h('div',{}), keyBox=h('div',{});
  const drawSa=focusLast=>{
    saBox.replaceChildren(...d.sa.map((q,i)=>h('div',{class:'sa-edit'},
      h('input',{type:'text',id:'ql-'+q.id,maxlength:'20',placeholder:'Question, e.g. 1a','aria-label':'Question label',value:q.label,oninput:e=>{q.label=e.target.value;}}),
      h('input',{type:'number',id:'qm-'+q.id,min:'0.5',step:'0.5',placeholder:'Marks','aria-label':'Marks available',value:q.max,oninput:e=>{q.max=e.target.value;},
        onkeydown:e=>{ if(e.key==='Enter'){ e.preventDefault(); if(i===d.sa.length-1){ d.sa.push({id:rid(),label:'',max:''}); drawSa(true); } else document.getElementById('ql-'+d.sa[i+1].id).focus(); } }}),
      h('button',{type:'button',class:'btn quiet danger','aria-label':'Remove question '+(q.label||i+1),onclick:()=>{d.sa.splice(i,1);drawSa();}},'Remove'))));
    if(focusLast&&d.sa.length) document.getElementById('ql-'+d.sa[d.sa.length-1].id).focus();
  };
  const drawKey=()=>{
    const n=Math.max(0,Math.min(200,parseInt(d.mcqCount,10)||0));
    keyBox.replaceChildren(...(n?[h('p',{class:'muted small'},'Answer key: choose the correct answer for each question. Questions without a key are recorded but not scored.'),
      mcqGrid(n,'ABCDE'.slice(0,d.mcqOptions).split(''),d.mcqKey,()=>{})]:[]));
  };
  const optSel=h('select',{id:'mcq-options',onchange:e=>{d.mcqOptions=Number(e.target.value);d.mcqKey=d.mcqKey.map(v=>v==='E'&&d.mcqOptions===4?'':v);drawKey();}},
    h('option',{value:'4'},'A to D'),h('option',{value:'5'},'A to E'));
  optSel.value=String(d.mcqOptions);
  const form=h('form',{class:'card',novalidate:true,onsubmit:e=>{e.preventDefault();saveExam();}},
    h('h2',{},d.id?'Edit exam':'New exam'),
    h('label',{class:'f'},'Exam title',h('input',{id:'exam-title',type:'text',maxlength:'200',placeholder:'e.g. Year 9 Science, Term 4 test',value:d.title,oninput:e=>{d.title=e.target.value;}})),
    h('h3',{},'Short-answer questions'),
    h('p',{class:'muted small'},'One row per part that gets its own mark. Press Enter in the marks box to add the next row. Leave empty if this exam is multiple choice only.'),
    saBox,
    h('div',{},h('button',{type:'button',class:'btn quiet',onclick:()=>{d.sa.push({id:rid(),label:'',max:''});drawSa(true);}},'Add question')),
    h('h3',{},'Multiple choice'),
    h('div',{class:'fields'},
      h('label',{class:'f'},'Number of questions (0 for none)',h('input',{id:'mcq-count',type:'number',min:'0',max:'200',step:'1',value:d.mcqCount,oninput:e=>{d.mcqCount=e.target.value;drawKey();}})),
      h('label',{class:'f'},'Answer options',optSel)),
    keyBox,
    d.id?h('p',{class:'muted small'},'Removing a question or changing the answer key changes the scores of results already entered.'):null,
    h('p',{class:'error',id:'edit-error',role:'alert'},state.editError),
    h('div',{class:'row'},h('button',{class:'btn',type:'submit'},'Save exam'),h('button',{class:'btn quiet',type:'button',onclick:()=>{state.editing=null;render();}},'Cancel')));
  drawSa(); drawKey();
  return form;
}
async function saveExam(){
  const d=state.editing, fail=m=>{state.editError=m;$('#edit-error').textContent=m;};
  const n=Math.max(0,Math.min(200,parseInt(d.mcqCount,10)||0));
  const sa=d.sa.filter(q=>q.label.trim()||q.max!=='').map(q=>({id:q.id,label:q.label.trim(),max:q.max===''?null:Number(q.max)}));
  try{
    const r=await rpc('md_exam_save',{p_token:state.token,p_exam:{id:d.id,title:d.title.trim(),sa,mcqCount:n,mcqOptions:d.mcqOptions,mcqKey:Array.from({length:n},(_,i)=>d.mcqKey[i]||'')}});
    await loadExams(); if(!d.id) state.examId=r.id; state.editing=null; toast('Exam saved.'); render();
  }catch(err){ fail(err.message); }
}

/* ---------- all results (administrator) ---------- */
function renderResults(){
  if(!state.exams.length) return [h('section',{class:'card'},h('h2',{},'All results'),h('p',{class:'muted'},'No exams yet.'))];
  if(!examById(state.resExamId)) state.resExamId=state.exams[0].id;
  const x=examById(state.resExamId), L=letters(x), key=x.mcqKey||[];
  const rows=state.results.map(e=>({e,s:score(x,e)}));
  const counts={}; rows.forEach(r=>{const k=r.e.studentId.trim().toLowerCase();counts[k]=(counts[k]||0)+1;});
  rows.sort(state.sort==='id'?(a,b)=>a.e.studentId.localeCompare(b.e.studentId,undefined,{numeric:true}):
            state.sort==='total'?(a,b)=>b.s.total-a.s.total:(a,b)=>b.e.id-a.e.id);
  const exSel=h('select',{id:'res-exam',onchange:async e=>{state.resExamId=Number(e.target.value);try{await loadResults();}catch(er){toast(er.message);}render();}},state.exams.map(o=>h('option',{value:o.id},o.title))); exSel.value=String(x.id);
  const sortSel=h('select',{id:'res-sort',onchange:e=>{state.sort=e.target.value;render();}},h('option',{value:'time'},'Newest first'),h('option',{value:'id'},'Student ID'),h('option',{value:'total'},'Highest total')); sortSel.value=state.sort;
  const out=[h('section',{class:'card'},
    h('div',{class:'fields'},h('label',{class:'f'},'Exam',exSel),h('label',{class:'f'},'Sort by',sortSel)),
    h('div',{class:'row mid'},
      h('button',{class:'btn',type:'button',disabled:!rows.length,onclick:()=>download(x,'xlsx')},'Download Excel file'),
      h('button',{class:'btn quiet',type:'button',disabled:!rows.length,onclick:()=>download(x,'csv')},'Download CSV'),
      h('button',{class:'btn quiet',type:'button',onclick:async()=>{try{await loadResults();toast('Results refreshed.');}catch(er){toast(er.message);}render();}},'Refresh'),
      x.mcqCount?h('label',{class:'check'},h('input',{type:'checkbox',id:'show-mcq',checked:state.showMcq,onchange:e=>{state.showMcq=e.target.checked;render();}}),'Show each multiple-choice answer'):null))];
  if(!rows.length){ out.push(h('section',{class:'card'},h('p',{class:'muted'},'No results entered for this exam yet.'))); return out; }
  const pcts=rows.map(r=>pct(r.s.total,r.s.max)), avg=rows.reduce((a,r)=>a+r.s.total,0)/rows.length, mx=rows[0].s.max, hasSa=(x.sa||[]).length>0;
  out.push(h('div',{class:'tiles'},
    h('div',{class:'tile'},h('span',{class:'muted small'},'Results entered'),h('b',{},rows.length)),
    h('div',{class:'tile'},h('span',{class:'muted small'},'Average'),h('b',{},avg.toFixed(1)+' / '+fmt(mx)),h('span',{class:'muted small'},pct(avg,mx)+'%')),
    h('div',{class:'tile'},h('span',{class:'muted small'},'Highest'),h('b',{},Math.max(...pcts)+'%')),
    h('div',{class:'tile'},h('span',{class:'muted small'},'Lowest'),h('b',{},Math.min(...pcts)+'%'))));
  out.push(h('div',{class:'scroll'},h('table',{},
    h('thead',{},h('tr',{},h('th',{},'Student ID'),
      (x.sa||[]).map(q=>h('th',{class:'n'},q.label,' ',h('small',{},'/'+fmt(Number(q.max))))),
      hasSa?h('th',{class:'n'},'Short answer'):null,
      state.showMcq?Array.from({length:x.mcqCount||0},(_,i)=>h('th',{class:'c',title:key[i]?'Key: '+key[i]:'No key'},i+1)):null,
      x.mcqCount?h('th',{class:'n'},'Multiple choice'):null,
      h('th',{class:'n'},'Total'),h('th',{class:'n'},'%'),h('th',{},'Marked by'),h('th',{},'Entered'),h('th',{},''))),
    h('tbody',{},rows.map(({e,s})=>h('tr',{},
      h('td',{class:'strong'},e.studentId,counts[e.studentId.trim().toLowerCase()]>1?h('span',{class:'pill',title:'More than one entry for this student'},'Duplicate'):null),
      (x.sa||[]).map(q=>h('td',{class:'n'},e.sa&&e.sa[q.id]!=null?fmt(Number(e.sa[q.id])):'—')),
      hasSa?h('td',{class:'n'},fmt(s.sa)+' / '+fmt(s.saMax)):null,
      state.showMcq?Array.from({length:x.mcqCount||0},(_,i)=>{ const a=e.mcq&&L.includes(e.mcq[i])?e.mcq[i]:''; return h('td',{class:'c '+(!key[i]?'':a===key[i]?'ok':'no'),title:!key[i]?'':a===key[i]?'Correct':'Incorrect, key is '+key[i]},a||'·'); }):null,
      x.mcqCount?h('td',{class:'n'},s.mc+' / '+s.mcMax):null,
      h('td',{class:'n tot'},fmt(s.total)+' / '+fmt(s.max)),h('td',{class:'n'},pct(s.total,s.max)+'%'),
      h('td',{},e.marker||'—'),h('td',{},when(e.submittedAt)),
      h('td',{},h('div',{class:'row'},
        h('button',{class:'btn quiet',type:'button',onclick:()=>{state.examId=x.id;editEntry(e);location.hash='enter';}},'Edit'),
        confirmBtn('Delete',async()=>{ try{ await rpc('md_result_delete',{p_token:state.token,p_id:e.id}); await loadResults(); }catch(er){ toast(er.message); } render(); })))))))));
  if(hasSa) out.push(h('section',{class:'card'},h('h2',{},'Short answer by question'),h('div',{class:'scroll'},h('table',{},
    h('thead',{},h('tr',{},h('th',{},'Question'),h('th',{},'Average mark'))),
    h('tbody',{},x.sa.map(q=>{ const vs=rows.map(r=>r.e.sa?Number(r.e.sa[q.id]):NaN).filter(v=>!isNaN(v)), a=vs.length?vs.reduce((p,c)=>p+c,0)/vs.length:0, bar=h('span',{}); bar.style.width=pct(a,Number(q.max))+'%';
      return h('tr',{},h('td',{},q.label),h('td',{},h('span',{class:'bar'},bar),a.toFixed(1)+' / '+fmt(Number(q.max)))); }))))));
  if(x.mcqCount) out.push(h('section',{class:'card'},h('h2',{},'Multiple choice by question'),h('div',{class:'scroll'},h('table',{},
    h('thead',{},h('tr',{},h('th',{class:'n'},'Q'),h('th',{class:'c'},'Key'),h('th',{},'Answered correctly'),L.map(l=>h('th',{class:'n'},l)),h('th',{class:'n'},'Blank'))),
    h('tbody',{},Array.from({length:x.mcqCount},(_,i)=>{ const c={}; let blank=0; rows.forEach(r=>{const a=r.e.mcq&&r.e.mcq[i]; if(L.includes(a)) c[a]=(c[a]||0)+1; else blank++;});
      const p=key[i]?pct(c[key[i]]||0,rows.length):null, bar=h('span',{}); bar.style.width=(p||0)+'%';
      return h('tr',{},h('td',{class:'n'},i+1),h('td',{class:'c'},key[i]||'—'),h('td',{},p==null?'No key set':[h('span',{class:'bar'},bar),p+'%']),
        L.map(l=>h('td',{class:'n'+(l===key[i]?' ok':'')},c[l]||0)),h('td',{class:'n'},blank)); }))))));
  return out;
}

/* ---------- downloads (built in the browser) ---------- */
function exportRows(x){
  const L=letters(x), head=['Student ID'];
  for(const q of x.sa||[]) head.push(q.label+' (/'+fmt(Number(q.max))+')');
  if((x.sa||[]).length) head.push('Short answer total');
  for(let i=1;i<=(x.mcqCount||0);i++) head.push('MC '+i);
  if(x.mcqCount) head.push('Multiple choice score');
  head.push('Total','Out of','Percent','Marked by','Entered');
  const pad=n=>String(n).padStart(2,'0');
  const rows=[...state.results].sort((a,b)=>a.studentId.localeCompare(b.studentId,undefined,{numeric:true})||a.id-b.id).map(e=>{
    const s=score(x,e), r=[String(e.studentId)];
    for(const q of x.sa||[]) r.push(e.sa&&e.sa[q.id]!=null?Number(e.sa[q.id]):'');
    if((x.sa||[]).length) r.push(s.sa);
    for(let i=0;i<(x.mcqCount||0);i++){ const a=e.mcq&&e.mcq[i]; r.push(L.includes(a)?a:''); }
    if(x.mcqCount) r.push(s.mc);
    const d=new Date(e.submittedAt);
    r.push(s.total,s.max,pct(s.total,s.max),String(e.marker||''),isNaN(d)?'':d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes()));
    return r; });
  return [head,rows];
}
async function download(x,kind){
  try{ await loadResults(); }catch(er){ toast(er.message); return; }
  const [head,rows]=exportRows(x), name=((x.title||'exam').replace(/[^A-Za-z0-9 _-]+/g,'').trim().slice(0,60)||'exam')+' results';
  let blob;
  if(kind==='csv'){
    const safe=v=>{ let s=String(v??''); if(typeof v==='string'&&/^[=+\-@\t\r]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"'; };
    blob=new Blob(['﻿'+[head,...rows].map(r=>r.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  } else blob=MDXlsx.build(head,rows,'Results');
  const url=URL.createObjectURL(blob), a=h('a',{href:url,download:name+'.'+kind});
  document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),10000);
  render();
}

/* ---------- settings (administrator) ---------- */
function renderSettings(){
  const err=h('p',{class:'error',role:'alert'},state.settingsError);
  const out=[];
  out.push(h('form',{class:'card narrow',novalidate:true,onsubmit:async e=>{ e.preventDefault();
      const body={currentPassword:$('#set-current').value,staffPasscode:$('#set-staff').value,adminPassword:$('#set-admin').value,staffCanEditExams:$('#set-edit').checked};
      if(body.adminPassword&&body.adminPassword!==$('#set-admin2').value){ err.textContent='The two new admin passwords do not match.'; return; }
      try{ await rpc('md_settings_save',{p_token:state.token,p_current:body.currentPassword,p_staff:body.staffPasscode,p_admin:body.adminPassword,p_staff_can_edit:body.staffCanEditExams}); state.staffCanEdit=body.staffCanEditExams; state.settingsError=''; toast('Settings saved.'); render(); }
      catch(x){ err.textContent=x.message; } }},
    h('h2',{},'Settings'),
    h('label',{class:'check'},h('input',{type:'checkbox',id:'set-edit',checked:state.staffCanEdit}),'Staff can create and edit exams (this lets them see answer keys)'),
    h('label',{class:'f'},'New staff passcode (leave blank to keep the current one)',h('input',{id:'set-staff',type:'text',autocomplete:'off'})),
    h('label',{class:'f'},'New admin password (leave blank to keep the current one)',h('input',{id:'set-admin',type:'password',autocomplete:'new-password'})),
    h('label',{class:'f'},'New admin password again',h('input',{id:'set-admin2',type:'password',autocomplete:'new-password'})),
    h('label',{class:'f'},'Your current admin password, to confirm',h('input',{id:'set-current',type:'password',autocomplete:'current-password'})),
    err,h('div',{},h('button',{class:'btn',type:'submit'},'Save settings'))));
  return out;
}

/* ---------- start ---------- */
window.addEventListener('hashchange',async()=>{ if(!state.role) return; state.editing=null; route(); try{ if(state.view==='exams') await loadExams(); await loadView(); }catch(e){ if(e.status!==401) toast(e.message); } render(); });
setInterval(async()=>{ if(state.role==='admin'&&state.view==='results'&&!document.hidden){ try{ if(await loadResults(true)) render(); }catch(e){} } },30000);
(async()=>{ try{ await enterApp(); }catch(e){ state.fatal=e.message; state.loaded=true; render(); } })();
