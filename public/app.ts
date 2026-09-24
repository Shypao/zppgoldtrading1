// Browser application source.
// The legacy single-page UI is incrementally typed; server and persistence code use strict TypeScript.
// @ts-nocheck
/* ============================= DATA LAYER ============================= */
let db = { rates:[], customers:[], stock:[], inventoryPools:[], liquidationBatches:[], liquidations:[], refiningBatches:[], retailSales:[] };
let currentTab = 'dashboard';
let currentUser = null;
let userAccounts = [];
let currentCashflow = null;
let cashflowSyncBusy = false;
let cashflowHistorySnapshot = null;
let cashflowHistoryDate = '';
let cashflowHistoryLoading = false;
const CASHFLOW_PAGE_SIZE = 50;
let cashflowPurchasePage = 1;
let cashflowAdjustmentPage = 1;
let cashflowSearch = '';
let cashflowAdjustmentSearch = '';
const STORE_KEY = 'zpp_gold_db';
const LEDGER_DB_NAME = 'zpp_gold_trading_ph';
const LEDGER_DB_VERSION = 3;
const ARRAY_STORES = ['customers','stock','inventoryPools','liquidationBatches','liquidations','refiningBatches','retailSales','pricingHistory'];
let ledgerDB = null;
let storageLocationCleanupNeeded=false;

function uid(p){ return (p||'id')+'_'+Math.random().toString(36).slice(2,9); }
function todayStr(){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function cashflowDateStr(value=new Date()){
  const shifted=new Date(value.getTime()-4*60*60*1000);
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(shifted);
  const date=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${date.year}-${date.month}-${date.day}`;
}
function monthStr(){ return todayStr().slice(0,7); }
function fmtMoney(n){ n=Number(n)||0; return 'PHP ' + Math.round(n).toLocaleString('en-PH',{maximumFractionDigits:0}); }
function fmtMoneyExact(n){ n=Number(n)||0; return 'PHP ' + n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtWeight(n){ return (Number(n)||0).toFixed(2) + ' g'; }
function roundMoney(n){ return Math.round((Number(n)+Number.EPSILON)*100)/100; }
function roundPeso(n){ return Math.round(Number(n)||0); }
function roundWeight(n){ return Math.round((Number(n)+Number.EPSILON)*100)/100; }
function fmtDate(d){ if(!d) return '—'; const dt=new Date(d+'T00:00:00'); return dt.toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'2-digit'}); }
function esc(s){ return (s==null?'':String(s)).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function parseMoneyEntry(value){ return Number(String(value??'').replace(/,/g,''))||0; }
function moneyEntryValue(value){
  const number=parseMoneyEntry(value);
  return number?number.toLocaleString('en-PH',{maximumFractionDigits:2}):'';
}
function formatMoneyEntry(input){
  const raw=String(input.value||'').replace(/,/g,'').replace(/[^0-9.]/g,'');
  if(!raw){ input.value=''; return; }
  const hasDecimal=raw.includes('.');
  const parts=raw.split('.');
  const whole=(parts.shift()||'0').replace(/^0+(?=\d)/,'')||'0';
  const decimals=parts.join('').slice(0,2);
  input.value=Number(whole).toLocaleString('en-PH')+(hasDecimal?'.'+decimals:'');
  input.setSelectionRange?.(input.value.length,input.value.length);
}
function nextSequenceId(prefix,records){
  const maximum=records.reduce((max,record)=>{
    const match=String(record.id||'').match(new RegExp(`^${prefix}-(\\d+)$`));
    return match?Math.max(max,Number(match[1])):max;
  },0);
  return `${prefix}-${String(maximum+1).padStart(4,'0')}`;
}

function ensureShape(){
  db.customers = db.customers||[]; db.stock = db.stock||[];
  db.inventoryPools=db.inventoryPools||[];
  db.stock.forEach(item=>{
    if(Object.prototype.hasOwnProperty.call(item,'location')){ delete item.location; storageLocationCleanupNeeded=true; }
    if(item.status==='For Selling'){ item.status='Available'; storageLocationCleanupNeeded=true; }
  });
  db.liquidationBatches = db.liquidationBatches||[];
  db.liquidationBatches.forEach(batch=>{
    if(Object.prototype.hasOwnProperty.call(batch,'buyerOffer')){ delete batch.buyerOffer; storageLocationCleanupNeeded=true; }
  });
  db.liquidations = db.liquidations||[]; db.refiningBatches = db.refiningBatches||[]; db.retailSales = db.retailSales||[];
  syncAllInventoryPools();
  db.pricingHistory = db.pricingHistory||[];
  db.pricingHistory.forEach(h=>{ if(!h.id) h.id=uid('rate'); });
  if(!db.pricing){
    db.pricing = { effectiveDate: todayStr(), gold:{base:0,overrides:{}}, silver:{base:0,overrides:{}}, platinum:{base:0,overrides:{}}, featured:null };
  }
  db.pricing.gold = db.pricing.gold||{base:0,overrides:{}}; db.pricing.gold.overrides = db.pricing.gold.overrides||{};
  db.pricing.silver = db.pricing.silver||{base:0,overrides:{}}; db.pricing.silver.overrides = db.pricing.silver.overrides||{};
  db.pricing.platinum = db.pricing.platinum||{base:0,overrides:{}}; db.pricing.platinum.overrides = db.pricing.platinum.overrides||{};
  db.pricing.auto = Object.assign({enabled:false,lastFetchDate:'',lastAppliedDate:'',lastFetchedAt:'',marketPhp:{},goldSource:'',draft:null},db.pricing.auto||{});
  db.pricing.gradeMultipliers = db.pricing.gradeMultipliers||{};
  db.pricing.dailyFormula = db.pricing.dailyFormula||{effectiveDate:'',baseRates:{}};
  db.pricing.dailyFormula.baseRates = db.pricing.dailyFormula.baseRates||{};
  db.pricing.staffRateEditingUnlocked=Boolean(db.pricing.staffRateEditingUnlocked);
}

function openLedgerDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(LEDGER_DB_NAME,LEDGER_DB_VERSION);
    req.onupgradeneeded=()=>{
      const idb=req.result;
      ARRAY_STORES.forEach(name=>{ if(!idb.objectStoreNames.contains(name)) idb.createObjectStore(name,{keyPath:'id'}); });
      if(!idb.objectStoreNames.contains('settings')) idb.createObjectStore('settings',{keyPath:'id'});
    };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
function idbRequest(req){ return new Promise((resolve,reject)=>{ req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
async function loadFromLedgerDB(){
  const tx=ledgerDB.transaction([...ARRAY_STORES,'settings'],'readonly');
  const arrayReads=ARRAY_STORES.map(name=>idbRequest(tx.objectStore(name).getAll()));
  const pricingRead=idbRequest(tx.objectStore('settings').get('pricing'));
  const values=await Promise.all([...arrayReads,pricingRead]);
  const loaded={}; ARRAY_STORES.forEach((name,i)=>loaded[name]=values[i]);
  const pricing=values[values.length-1];
  if(!pricing && ARRAY_STORES.every(name=>!loaded[name].length)) return false;
  ARRAY_STORES.forEach(name=>db[name]=loaded[name]);
  db.pricing=pricing?pricing.value:null;
  ensureShape(); return true;
}
async function saveDB(){
  try{
    ensureShape();
    if(location.protocol==='http:'||location.protocol==='https:'){
      const response=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(db)});
      if(response.status===401){ showLogin(); throw new Error('Session expired'); }
      const result=await response.json().catch(()=>null);
      if(response.status===409) throw new Error(result?.error||'The database changed in another session. Refresh and try again.');
      if(!response.ok) throw new Error(result?.error||'Database server returned HTTP '+response.status);
      if(Number.isInteger(result?.revision)) db._revision=result.revision;
      storageLocationCleanupNeeded=false;
      return true;
    }
    if(!ledgerDB) ledgerDB=await openLedgerDB();
    const snapshot=JSON.parse(JSON.stringify(db));
    await new Promise((resolve,reject)=>{
      const tx=ledgerDB.transaction([...ARRAY_STORES,'settings'],'readwrite');
      ARRAY_STORES.forEach(name=>{
        const store=tx.objectStore(name); store.clear();
        (snapshot[name]||[]).forEach(item=>store.put(item));
      });
      tx.objectStore('settings').put({id:'pricing',value:snapshot.pricing});
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
    });
    storageLocationCleanupNeeded=false;
    return true;
  }
  catch(e){ console.error('Save failed', e); toast('Could not save — changes may not persist'); return false; }
}

async function savePricingDB(includeHistory=false){
  if(!(location.protocol==='http:'||location.protocol==='https:')) return saveDB();
  try{
    ensureShape();
    const body={pricing:db.pricing};
    if(includeHistory) body.pricingHistory=db.pricingHistory;
    const response=await fetch('/api/pricing',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(response.status===401){ showLogin(); throw new Error('Session expired'); }
    const result=await response.json().catch(()=>null);
    if(!response.ok) throw new Error(result?.error||'Pricing server returned HTTP '+response.status);
    if(Number.isInteger(result?.revision)) db._revision=result.revision;
    return true;
  }catch(error){
    console.error('Pricing save failed',error);
    toast('Could not save pricing — please try again');
    return false;
  }
}

function seedEmptyLedger(){
  db.customers = [];
  db.pricing = {
    effectiveDate: todayStr(),
    gold:{ base:8500, overrides:{} },
    silver:{ base:105, overrides:{} },
    platinum:{ base:2450, overrides:{} },
    auto:{enabled:false,lastFetchDate:'',lastAppliedDate:'',lastFetchedAt:'',usdPhp:0,spotUsd:{},draft:null},
    dailyFormula:{effectiveDate:todayStr(),baseRates:{Gold:8500,Silver:105,Platinum:2450}},
    staffRateEditingUnlocked:false,
    featured:{ metal:'Gold', key:'18K-BUO', low:6360, high:6560 }
  };
  db.pricingHistory = [{ id:uid('rate'), ts:Date.now(), effectiveDate: todayStr(), enteredBy:'Admin', snapshot: JSON.parse(JSON.stringify(db.pricing)) }];
  db.stock = [];
  db.inventoryPools = []; db.liquidationBatches = []; db.liquidations = []; db.refiningBatches = []; db.retailSales = [];
}

async function loadDB(){
  try{
    if(location.protocol==='http:'||location.protocol==='https:'){
      const response=await fetch('/api/state',{cache:'no-store'});
      if(response.status===401){ showLogin(); return; }
      if(!response.ok) throw new Error('Database server returned HTTP '+response.status);
      const serverState=await response.json();
      if(serverState.pricing){ db=serverState; ensureShape(); if(storageLocationCleanupNeeded) await saveDB(); }
      else { const revision=serverState._revision; seedEmptyLedger(); db._revision=revision; ensureShape(); await saveDB(); }
      boot();
      return;
    }
    ledgerDB=await openLedgerDB();
    const found=await loadFromLedgerDB();
    if(found&&storageLocationCleanupNeeded) await saveDB();
    if(!found){
      let legacy=null;
      try{
        if(window.storage && typeof window.storage.get==='function'){ const r=await window.storage.get(STORE_KEY,false); legacy=r&&r.value; }
        if(!legacy) legacy=localStorage.getItem(STORE_KEY);
      }catch(ignore){}
      if(legacy){ db=JSON.parse(legacy); ensureShape(); }
      else seedEmptyLedger();
      await saveDB();
    }
  }catch(e){ console.error('Database load failed',e); seedEmptyLedger(); ensureShape(); }
  boot();
}

function isAdmin(){ return currentUser?.role==='admin'; }
function staffRateEditingUnlocked(){ return db.pricing?.staffRateEditingUnlocked===true; }
function canEditDailyRates(){ return isAdmin()||staffRateEditingUnlocked(); }
function canOverrideBuyingRate(){ return isAdmin()||staffRateEditingUnlocked(); }
function allowedTabs(){ return TABS.filter(tab=>isAdmin()||tab.staff); }
function showLogin(){
  currentUser=null;
  document.getElementById('appShell')?.classList.add('is-hidden');
  document.getElementById('loginScreen')?.classList.remove('is-hidden');
}
function showApp(){
  document.getElementById('loginScreen')?.classList.add('is-hidden');
  document.getElementById('appShell')?.classList.remove('is-hidden');
  const userEl=document.getElementById('sessionUser');
  if(userEl) userEl.innerHTML=`${esc(currentUser.displayName)}<br><span class="session-role">${esc(currentUser.role)}</span>`;
  const badge=document.getElementById('accessBadge');
  if(badge){
    badge.className=`access-badge ${currentUser.role}`;
    badge.textContent=`${currentUser.role.toUpperCase()} ACCESS`;
    badge.title=`Signed in as ${currentUser.displayName} (${currentUser.role})`;
  }
}
async function initializeAuth(){
  try{
    const response=await fetch('/api/session',{cache:'no-store'});
    if(!response.ok){ showLogin(); return; }
    const result=await response.json();
    if(!result.authenticated||!result.user){ showLogin(); return; }
    currentUser=result.user; showApp(); await loadDB();
  }catch(error){ console.error('Session check failed',error); showLogin(); }
}
async function signIn(event){
  event.preventDefault();
  const errorEl=document.getElementById('login_error');
  const username=val('login_username').trim(),password=val('login_password');
  errorEl.textContent='Signing in…';
  try{
    const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error||'Sign-in failed');
    currentUser=result.user; currentTab='dashboard'; errorEl.textContent=''; showApp(); await loadDB();
  }catch(error){ errorEl.textContent=error.message||'Sign-in failed'; }
}
async function signOut(){
  try{ await fetch('/api/logout',{method:'POST'}); }catch(ignore){}
  db={rates:[],customers:[],stock:[],inventoryPools:[],liquidationBatches:[],liquidations:[],refiningBatches:[],retailSales:[]};
  userAccounts=[]; currentCashflow=null;buyingDraftLoaded=false;buyingDraftLoading=false; showLogin();
}

async function resetDemo(){
  if(!confirm('This clears the ledger and restores the default rates. Continue?')) return;
  seedEmptyLedger();
  await saveDB();
  render();
  toast('Sample data restored');
}

function toast(msg){
  const t=document.createElement('div');
  t.className='toast'; t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2600);
}

/* ============================= PRICING / RATES ============================= */
const GOLD_GRADES = [
  {key:'24K', label:'24K', mult:1},
  {key:'23K', label:'23K', mult:0.95},
  {key:'22K', label:'22K', mult:0.916},
  {key:'21K', label:'21K', mult:0.875},
  {key:'20K', label:'20K', mult:0.79},
  {key:'18K', label:'18K', mult:0.75},
  {key:'18K-BUO', label:'18K-Buo', mult:0.75},
  {key:'17K', label:'17K', mult:0.7},
  {key:'16K', label:'16K', mult:0.645},
  {key:'14K', label:'14K', mult:0.585},
  {key:'12K', label:'12K', mult:0.4789},
  {key:'10K', label:'10K', mult:0.35},
  {key:'9K', label:'9K', mult:0.335},
  {key:'8K', label:'8K', mult:0.24},
  {key:'5K', label:'5K', mult:0.06},
  {key:'98%', label:'98%', mult:0.98},
  {key:'73%', label:'73%', mult:0.73},
];
const SILVER_GRADES = [
  {key:'999', label:'999', mult:1},
  {key:'925', label:'925', mult:925/999},
  {key:'900', label:'900', mult:0.9},
  {key:'800', label:'800', mult:0.8},
  {key:'750', label:'75%', mult:0.75},
  {key:'600', label:'60%', mult:0.6},
];
const PLATINUM_GRADES = [
  {key:'999', label:'999', mult:1},
  {key:'950', label:'950', mult:950/999},
  {key:'900', label:'900', mult:900/999},
  {key:'850', label:'850', mult:850/999},
];
const GRADE_META = { Gold: GOLD_GRADES, Silver: SILVER_GRADES, Platinum: PLATINUM_GRADES };
const GRADES = Object.fromEntries(Object.entries(GRADE_META).map(([metal,grades])=>[metal,grades.map(g=>g.key)]));

function gradeMeta(metal, key){
  return (GRADE_META[metal]||[]).find(g=>g.key===key) || null;
}
function configuredGradeMultiplier(metal,key){
  const saved=Number(db.pricing?.gradeMultipliers?.[metal]?.[key]);
  return Number.isFinite(saved)&&saved>=0?saved:(Number(gradeMeta(metal,key)?.mult)||0);
}
function configuredBaseRate(metal){
  const liveBase=Number(bucketFor(metal).base)||0;
  const daily=db.pricing?.dailyFormula;
  const configured=Number(daily?.effectiveDate===todayStr()?daily?.baseRates?.[metal]:NaN);
  return Number.isFinite(configured)&&configured>0 ? configured : liveBase;
}
function configuredSilver925Rate(silver999Base=configuredBaseRate('Silver')){
  const daily=db.pricing?.dailyFormula;
  const configured=Number(daily?.effectiveDate===todayStr()?daily?.baseRates?.Silver925:NaN);
  if(Number.isFinite(configured)&&configured>0) return roundPeso(configured);
  const legacyOverride=Number(db.pricing?.silver?.overrides?.['925']);
  if(Number.isFinite(legacyOverride)&&legacyOverride>0) return roundPeso(legacyOverride);
  return roundPeso(Math.max(Number(silver999Base||0)-10,0));
}
function calculatedRateFromBase(metal,key,base){
  const customPurity=customPurityFromKey(key);
  if(!Number.isFinite(base)||base<=0||(!gradeMeta(metal,key)&&customPurity===null)) return 0;
  let rate=0;
  if(customPurity!==null){
    rate=base*(customPurity/100);
  }
  else if(metal==='Gold'){
    rate=base*configuredGradeMultiplier(metal,key);
  }else if(metal==='Silver'){
    const sterlingRate=configuredSilver925Rate(base);
    rate=key==='999'?base:key==='925'?sterlingRate:sterlingRate*Number(key)/925;
  }else if(metal==='Platinum'){
    const deductions={999:0,950:100,900:150,850:200};
    rate=Math.max(base-Number(deductions[key]??0),0);
  }
  return roundPeso(rate);
}
function computedRate(metal, key){
  return calculatedRateFromBase(metal,key,configuredBaseRate(metal));
}
function bucketFor(metal){ return metal==='Gold'?db.pricing.gold : metal==='Silver'?db.pricing.silver : db.pricing.platinum; }
function metalRate(metal, key){
  const b = bucketFor(metal);
  const ov = b.overrides[key];
  return (ov!=null && ov!=='') ? roundPeso(ov) : computedRate(metal, key);
}
function isOverridden(metal, key){
  const b = bucketFor(metal);
  return b.overrides[key]!=null && b.overrides[key]!=='';
}
function customPurityFromKey(key){
  const match=String(key||'').match(/^(\d+(?:\.\d+)?)%$/);
  if(!match) return null;
  const purity=Number(match[1]);
  return Number.isFinite(purity)&&purity>0&&purity<=100?purity:null;
}
function customPurityGradeKey(value){
  const purity=Number(value);
  if(!Number.isFinite(purity)||purity<=0||purity>100) return '';
  return `${Number(purity.toFixed(2))}%`;
}
function gradeLabel(metal, key){
  const g=gradeMeta(metal,key);
  if(g) return g.label;
  const customPurity=customPurityFromKey(key);
  return customPurity===null?key:`${Number(customPurity.toFixed(2))}% purity`;
}
function distinctKarats(metal){ return GRADES[metal] || []; }
function activeRate(metal, karat){
  const isCustomPurity=customPurityFromKey(karat)!==null;
  if((!GRADES[metal] || !GRADES[metal].includes(karat))&&!isCustomPurity) return null;
  return { rate: metalRate(metal, karat), effectiveDate: db.pricing.effectiveDate };
}

async function setBase(metal, value){
  const v = roundPeso(parseFloat(value));
  if(!Number.isFinite(v)||v<=0){ toast('Enter a valid PHP base rate'); render(); return; }
  if(db.pricing.dailyFormula.effectiveDate!==todayStr()) db.pricing.dailyFormula={effectiveDate:todayStr(),baseRates:{}};
  db.pricing.dailyFormula.baseRates[metal]=v;
  if(await savePricingDB()){ render(); toast(`${metal} PHP base rate updated for today`); }
}
async function setSilver925Base(value){
  const rate=roundPeso(parseFloat(value));
  if(!Number.isFinite(rate)||rate<=0){ toast('Enter a valid 925 Silver rate'); render(); return; }
  if(db.pricing.dailyFormula.effectiveDate!==todayStr()) db.pricing.dailyFormula={effectiveDate:todayStr(),baseRates:{}};
  db.pricing.dailyFormula.baseRates.Silver925=rate;
  delete db.pricing.silver.overrides['925'];
  if(await savePricingDB()){ render(); toast('Silver 925 basis rate updated for today'); }
}
let staffRateEditingToggleBusy=false;
async function toggleStaffRateEditing(){
  if(!isAdmin()||staffRateEditingToggleBusy) return;
  const wasUnlocked=staffRateEditingUnlocked();
  staffRateEditingToggleBusy=true;
  db.pricing.staffRateEditingUnlocked=!wasUnlocked;
  render();
  try{
    if(await savePricingDB()){
      toast(!wasUnlocked?'Staff can now edit daily buying rates':'Staff daily buying-rate editing is locked');
    }else{
      db.pricing.staffRateEditingUnlocked=wasUnlocked;
    }
  }finally{
    staffRateEditingToggleBusy=false;
    render();
  }
}
async function setOverride(metal, key, value){
  const b = bucketFor(metal);
  if(value===''){ delete b.overrides[key]; } else { b.overrides[key] = roundPeso(parseFloat(value)); }
  await savePricingDB(); render();
}
async function resetOverride(metal, key){
  delete bucketFor(metal).overrides[key];
  await savePricingDB(); render();
}
async function setFeatured(metal, key, low, high, remarks=''){
  db.pricing.featured = { metal, key, low:parseFloat(low)||0, high:parseFloat(high)||0, remarks:String(remarks||'').trim() };
  await savePricingDB(); render();
}
async function clearFeatured(){ db.pricing.featured = null; featuredRemarksDraft=''; await savePricingDB(); render(); }
let pricingFetchBusy=false;
const overrideEditors=new Set();
const TROY_OUNCE_GRAMS=31.1034768;
async function fetchJson(url){
  const response=await fetch(url,{cache:'no-store'});
  const payload=await response.json().catch(()=>null);
  if(!response.ok){
    if(response.status===401&&String(url).startsWith('/api/')) showLogin();
    throw new Error(payload?.error||('Price service returned HTTP '+response.status));
  }
  return payload;
}
async function refreshPhilippineRates(silent){
  if(pricingFetchBusy) return;
  pricingFetchBusy=true;
  if(!silent) render();
  try{
    let proposal;
    if(location.protocol==='http:'||location.protocol==='https:'){
      proposal=await fetchJson('/api/market?apply=1');
    }else{
      const [gold,silver,platinum,fx]=await Promise.all([
        fetchJson('https://api.gold-api.com/price/XAU'),fetchJson('https://api.gold-api.com/price/XAG'),
        fetchJson('https://api.gold-api.com/price/XPT'),fetchJson('https://open.er-api.com/v6/latest/USD')
      ]);
      const usdPhp=Number(fx.rates&&fx.rates.PHP), spotUsd={Gold:Number(gold.price),Silver:Number(silver.price),Platinum:Number(platinum.price)};
      if(!usdPhp||Object.values(spotUsd).some(v=>!v)) throw new Error('Incomplete market data');
      const marketPhp={Gold:+(spotUsd.Gold*usdPhp/TROY_OUNCE_GRAMS).toFixed(2),Silver:+(spotUsd.Silver*usdPhp/TROY_OUNCE_GRAMS).toFixed(2),Platinum:+(spotUsd.Platinum*usdPhp/TROY_OUNCE_GRAMS).toFixed(2)};
      proposal={effectiveDate:todayStr(),fetchedAt:new Date().toISOString(),marketPhp,goldSource:'Converted international spot fallback',draft:{effectiveDate:todayStr(),gold:marketPhp.Gold,silver:marketPhp.Silver,platinum:marketPhp.Platinum}};
    }
    db.pricing.auto.lastFetchDate=proposal.effectiveDate;
    db.pricing.auto.lastFetchedAt=proposal.fetchedAt;
    db.pricing.auto.marketPhp=proposal.marketPhp||{};
    db.pricing.auto.goldSource=proposal.goldSource||'';
    activateMarketRates(proposal.draft, silent?'Automatic 5-minute internet update':'Manual internet refresh', !silent);
    if(isAdmin()&&!silent) await saveDB();
    if(!silent) toast('Live internet prices refreshed and activated');
  }catch(e){
    console.error('Automatic pricing failed',e);
    if(!silent) toast(`Live pricing unavailable — ${e.message||'current rates are unchanged'}`);
  }finally{
    pricingFetchBusy=false;
    // Background market polling must never replace an in-progress form or
    // clear selections on another page. Only the rate screen needs a redraw.
    const editingRateField=currentTab==='rates'&&document.activeElement?.matches('input,select,textarea');
    if(!silent||(currentTab==='rates'&&!editingRateField)) render();
  }
}
function activateMarketRates(d, enteredBy, recordHistory=true){
  db.pricing.gold.base=d.gold; db.pricing.silver.base=d.silver; db.pricing.platinum.base=d.platinum;
  db.pricing.effectiveDate=d.effectiveDate;
  db.pricing.auto.lastAppliedDate=d.effectiveDate;
  db.pricing.auto.draft=null;
  const duplicate=db.pricingHistory.some(h=>
    h.effectiveDate===d.effectiveDate && h.enteredBy===enteredBy &&
    Number(h.snapshot?.gold?.base)===Number(d.gold) &&
    Number(h.snapshot?.silver?.base)===Number(d.silver) &&
    Number(h.snapshot?.platinum?.base)===Number(d.platinum)
  );
  if(recordHistory&&!duplicate){
    db.pricingHistory.push({id:uid('rate'),ts:Date.now(),effectiveDate:d.effectiveDate,enteredBy,snapshot:JSON.parse(JSON.stringify(db.pricing))});
  }
}

function visiblePricingHistory(){
  const seen=new Set();
  return db.pricingHistory.slice().sort((a,b)=>b.ts-a.ts).filter(h=>{
    const key=[h.effectiveDate,h.enteredBy,h.snapshot?.gold?.base,h.snapshot?.silver?.base,h.snapshot?.platinum?.base].join('|');
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function overrideEditorId(metal,key){ return metal+'|'+key; }
function beginOverride(metal,key){
  const id=overrideEditorId(metal,key);
  overrideEditors.add(id);
  render();
  requestAnimationFrame(()=>{
    const input=document.querySelector(`[data-rate-editor="${metal}-${key}"]`);
    if(input){ input.focus(); input.select(); }
  });
}
function cancelOverride(metal,key){ overrideEditors.delete(overrideEditorId(metal,key)); render(); }
function commitOverride(metal,key,value){
  const n=parseFloat(value);
  if(!Number.isFinite(n)||n<0){ toast('Enter a valid non-negative price'); return; }
  overrideEditors.delete(overrideEditorId(metal,key));
  setOverride(metal,key,n);
  toast(`${gradeLabel(metal,key)} price overridden`);
}
async function savePricingSnapshot(){
  const by = val('px_by').trim() || 'Admin';
  const date = val('px_date') || todayStr();
  db.pricing.effectiveDate = date;
  db.pricingHistory.push({ id:uid('rate'), ts:Date.now(), effectiveDate:date, enteredBy:by, snapshot: JSON.parse(JSON.stringify(db.pricing)) });
  if(await savePricingDB(true)){ render(); toast('Rate sheet saved to history'); }
}
async function saveGoldMultipliers(){
  if(!adminEditGuard()) return;
  const values={};
  for(const grade of GOLD_GRADES){
    const inputId=`multiplier_gold_${grade.key.replace(/[^a-z0-9]/gi,'_')}`;
    const value=Number(val(inputId));
    if(!Number.isFinite(value)||value<0||value>1.5){ toast(`Enter a valid multiplier for ${grade.label}`); return; }
    values[grade.key]=value;
  }
  db.pricing.gradeMultipliers=db.pricing.gradeMultipliers||{};
  db.pricing.gradeMultipliers.Gold=values;
  closeGoldMultiplierEditor();
  if(await savePricingDB()){ render(); toast('Gold karat multipliers updated'); }
}
async function resetGoldMultipliers(){
  if(!adminEditGuard()||!confirm('Reset every Gold multiplier to the original rate-sheet values?')) return;
  if(db.pricing.gradeMultipliers) delete db.pricing.gradeMultipliers.Gold;
  closeGoldMultiplierEditor();
  if(await savePricingDB()){ render(); toast('Gold multipliers reset'); }
}
function openGoldMultiplierEditor(){
  if(!adminEditGuard()) return;
  closeGoldMultiplierEditor();
  const modal=document.createElement('div');
  modal.id='gold_multiplier_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="summary-modal multiplier-modal" role="dialog" aria-modal="true" aria-labelledby="gold_multiplier_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Daily rate setup</div><h2 id="gold_multiplier_title">Gold karat multipliers</h2></div><button type="button" class="modal-close" onclick="closeGoldMultiplierEditor()" aria-label="Close">×</button></div>
    <p class="form-note multiplier-modal-note">Change how each Gold grade is calculated from today's 24K PHP base. Example: 0.750 means 75% of the base.</p>
    <div class="multiplier-grid">${GOLD_GRADES.map(grade=>`<div class="field"><label>${esc(grade.label)}</label><input id="multiplier_gold_${grade.key.replace(/[^a-z0-9]/gi,'_')}" type="number" min="0" max="1.5" step="0.001" value="${configuredGradeMultiplier('Gold',grade.key)}"></div>`).join('')}</div>
    <div class="form-actions multiplier-modal-actions"><button type="button" class="btn secondary" onclick="resetGoldMultipliers()">Reset multipliers</button><button type="button" class="btn secondary" onclick="closeGoldMultiplierEditor()">Cancel</button><button type="button" class="btn" onclick="saveGoldMultipliers()">Save multipliers</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeGoldMultiplierEditor();});
  document.body.appendChild(modal);
  modal.querySelector('input')?.focus();
}
function closeGoldMultiplierEditor(){ document.getElementById('gold_multiplier_modal')?.remove(); }

/* ============================= NAV / BOOT ============================= */
const TABS = [
  {id:'dashboard', label:'Dashboard & reports'},
  {id:'rates', label:'Daily rate setup', staff:true},
  {id:'buying', label:'Buying transactions', staff:true},
  {id:'inventory', label:'Inventory', staff:true},
  {id:'liquidation', label:'Liquidation'},
  {id:'refining', label:'Refining tracking'},
  {id:'retail', label:'Limited retail sales'},
  {id:'customers', label:'Customer management'},
  {id:'users', label:'User accounts'},
];

function boot(){
  const nav = document.getElementById('navTabs');
  if(!allowedTabs().some(tab=>tab.id===currentTab)) currentTab=allowedTabs()[0]?.id||'buying';
  nav.innerHTML = allowedTabs().map(t=>`<button data-tab="${t.id}" class="${t.id===currentTab?'active':''}" onclick="goTab('${t.id}')"><span class="dot"></span>${t.label}</button>`).join('');
  document.getElementById('pageDate').textContent = fmtDate(todayStr());
  render();
}
function goTab(id){
  if(!allowedTabs().some(tab=>tab.id===id)) return;
  currentTab = id;
  document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===id));
  render();
  if(id==='buying'){ syncCashflow();loadBuyingDraft(); }
  if(id==='users') loadUserAccounts();
}

function render(){
  const titles = {
    dashboard:['Admin overview, records & exports','Dashboard & reports'],
    rates:['Pricing control','Daily rate setup'],
    buying:['Record a purchase','Buying transactions'],
    inventory:['Current stock','Inventory'],
    liquidation:['Off-hand stock assigned to buyers','Liquidation'],
    refining:['Refining batches','Refining tracking'],
    retail:['Walk-in resale','Limited retail sales'],
    customers:['Sellers on file','Customer management'],
    users:['Access control','User accounts'],
  };
  document.getElementById('pageEyebrow').textContent = titles[currentTab][0];
  document.getElementById('pageTitle').textContent = titles[currentTab][1];
  const el = document.getElementById('content');
  const fns = {dashboard:renderDashboard, rates:renderRates, buying:renderBuying, inventory:renderInventory,
    liquidation:renderLiquidation, refining:renderRefining, retail:renderRetail, customers:renderCustomers,
    users:renderUsers};
  el.innerHTML = fns[currentTab]();
}

/* ============================= DASHBOARD ============================= */
let dashboardReportPanel='';
let purchaseHistoryFrom='';
let purchaseHistoryTo='';
let liquidationHistoryFrom='';
let liquidationHistoryTo='';
function shiftDateKey(dateKey,days){
  const date=new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}
let readinessFrom=shiftDateKey(todayStr(),-13);
let readinessTo=todayStr();
function toggleDashboardReport(panel){
  dashboardReportPanel=dashboardReportPanel===panel?'':panel;
  render();
  if(dashboardReportPanel) requestAnimationFrame(()=>document.getElementById('dashboard_report_content')?.scrollIntoView({behavior:'smooth',block:'start'}));
}
function filterDashboardReport(value){
  const query=String(value||'').trim().toLowerCase();
  const rows=Array.from(document.querySelectorAll('#dashboard_report_content [data-dashboard-search]'));
  let visible=0;
  rows.forEach(row=>{
    const matches=!query||String(row.dataset.dashboardSearch||'').includes(query);
    row.hidden=!matches;
    if(matches) visible+=1;
  });
  const count=document.getElementById('dashboard_search_result_count');
  if(count) count.textContent=`Showing ${visible} of ${rows.length}`;
  document.getElementById('dashboard_search_empty')?.classList.toggle('is-hidden',visible>0||!rows.length);
}
function dashboardReportSearch(placeholder,total){
  return `<div class="dashboard-report-search"><div class="field"><label for="dashboard_report_search">Search records</label><input id="dashboard_report_search" type="search" autocomplete="off" placeholder="${esc(placeholder)}" oninput="filterDashboardReport(this.value)"></div><span id="dashboard_search_result_count">Showing ${total} of ${total}</span></div><div id="dashboard_search_empty" class="empty-note is-hidden">No records match your search.</div>`;
}
function dashboardSearchValue(...values){ return esc(values.filter(value=>value!=null).join(' ').toLowerCase()); }
function purchaseHistoryDateMatch(item){
  return (!purchaseHistoryFrom||item.date>=purchaseHistoryFrom)&&(!purchaseHistoryTo||item.date<=purchaseHistoryTo);
}
function purchaseHistoryRecords(){
  return db.stock.filter(item=>!item.sourceRefiningBatchId&&purchaseHistoryDateMatch(item)).slice().sort((a,b)=>b.date.localeCompare(a.date));
}
function applyPurchaseHistoryDates(){
  const from=val('purchase_history_from'),to=val('purchase_history_to');
  if(from&&to&&from>to){ toast('The From date must be before the To date'); return; }
  purchaseHistoryFrom=from; purchaseHistoryTo=to; render();
  requestAnimationFrame(()=>document.getElementById('dashboard_report_content')?.scrollIntoView({behavior:'smooth',block:'start'}));
}
function setPurchaseHistoryDatePreset(preset){
  if(preset==='today'){ purchaseHistoryFrom=todayStr(); purchaseHistoryTo=todayStr(); }
  else if(preset==='month'){ purchaseHistoryFrom=`${monthStr()}-01`; purchaseHistoryTo=todayStr(); }
  else { purchaseHistoryFrom=''; purchaseHistoryTo=''; }
  render();
  requestAnimationFrame(()=>document.getElementById('dashboard_report_content')?.scrollIntoView({behavior:'smooth',block:'start'}));
}
function purchaseHistoryFilterLabel(){
  if(purchaseHistoryFrom&&purchaseHistoryTo) return purchaseHistoryFrom===purchaseHistoryTo?fmtDate(purchaseHistoryFrom):`${fmtDate(purchaseHistoryFrom)} to ${fmtDate(purchaseHistoryTo)}`;
  if(purchaseHistoryFrom) return `From ${fmtDate(purchaseHistoryFrom)}`;
  if(purchaseHistoryTo) return `Through ${fmtDate(purchaseHistoryTo)}`;
  return 'All purchase dates';
}
function liquidationHistoryDateMatch(item){
  return (!liquidationHistoryFrom||item.date>=liquidationHistoryFrom)&&(!liquidationHistoryTo||item.date<=liquidationHistoryTo);
}
function liquidationHistoryRecords(){
  return db.liquidations.filter(liquidationHistoryDateMatch).slice().sort((a,b)=>b.date.localeCompare(a.date));
}
function applyLiquidationHistoryDates(){
  const from=val('liquidation_history_from'),to=val('liquidation_history_to');
  if(from&&to&&from>to){ toast('The From date must be before the To date'); return; }
  liquidationHistoryFrom=from; liquidationHistoryTo=to; render();
  requestAnimationFrame(()=>document.getElementById('dashboard_report_content')?.scrollIntoView({behavior:'smooth',block:'start'}));
}
function setLiquidationHistoryDatePreset(preset){
  if(preset==='today'){ liquidationHistoryFrom=todayStr(); liquidationHistoryTo=todayStr(); }
  else if(preset==='month'){ liquidationHistoryFrom=`${monthStr()}-01`; liquidationHistoryTo=todayStr(); }
  else { liquidationHistoryFrom=''; liquidationHistoryTo=''; }
  render();
  requestAnimationFrame(()=>document.getElementById('dashboard_report_content')?.scrollIntoView({behavior:'smooth',block:'start'}));
}
function liquidationHistoryFilterLabel(){
  if(liquidationHistoryFrom&&liquidationHistoryTo) return liquidationHistoryFrom===liquidationHistoryTo?fmtDate(liquidationHistoryFrom):`${fmtDate(liquidationHistoryFrom)} to ${fmtDate(liquidationHistoryTo)}`;
  if(liquidationHistoryFrom) return `From ${fmtDate(liquidationHistoryFrom)}`;
  if(liquidationHistoryTo) return `Through ${fmtDate(liquidationHistoryTo)}`;
  return 'All liquidation dates';
}
function readinessDateMatch(item){
  return (!readinessFrom||item.date>=readinessFrom)&&(!readinessTo||item.date<=readinessTo);
}
function applyReadinessDates(){
  const from=val('readiness_from'),to=val('readiness_to');
  if(from&&to&&from>to){ toast('The From date must be before the To date'); return; }
  readinessFrom=from; readinessTo=to; render();
  requestAnimationFrame(()=>document.getElementById('dashboard_report_content')?.scrollIntoView({behavior:'smooth',block:'start'}));
}
function setReadinessDatePreset(preset){
  if(preset==='today'){ readinessFrom=todayStr(); readinessTo=todayStr(); }
  else if(preset==='two-weeks'){ readinessFrom=shiftDateKey(todayStr(),-13); readinessTo=todayStr(); }
  else { readinessFrom=''; readinessTo=''; }
  render();
  requestAnimationFrame(()=>document.getElementById('dashboard_report_content')?.scrollIntoView({behavior:'smooth',block:'start'}));
}
function readinessFilterLabel(){
  if(readinessFrom&&readinessTo) return readinessFrom===readinessTo?fmtDate(readinessFrom):`${fmtDate(readinessFrom)} to ${fmtDate(readinessTo)}`;
  if(readinessFrom) return `From ${fmtDate(readinessFrom)}`;
  if(readinessTo) return `Through ${fmtDate(readinessTo)}`;
  return 'All purchase dates';
}
function todayPurchaseMetalSummary(purchases,metal){
  const items=purchases.filter(item=>item.metal===metal);
  return {
    metal,
    items,
    count:items.length,
    weight:items.reduce((sum,item)=>sum+Number(item.netWeight||0),0),
    payout:items.reduce((sum,item)=>sum+Number(item.payout||0),0)
  };
}
function dailyMetalPurityBreakdownMarkup(items,metal){
  const totals=purchaseTotalsByPurity(items);
  return `<section class="daily-metal-purity-breakdown"><h3>${esc(metal)} totals by purity</h3>
    ${tableOrEmpty(totals,entry=>`<tr><td><strong>${esc(gradeLabel(entry.metal,entry.karat))}</strong></td><td class="num">${entry.count}</td><td class="num">${fmtWeight(entry.purchasedWeight)}</td><td class="num">${fmtMoney(entry.payout)}</td><td class="num">${fmtWeight(entry.remainingWeight)}</td></tr>`,['Karat / purity','Purchase lines','Purchased net weight','Total payout','Remaining weight'],'No '+metal.toLowerCase()+' purchases recorded today.')}
  </section>`;
}
function closeTodayMetalPurchases(){ document.getElementById('today_metal_purchases_modal')?.remove(); }
function openTodayMetalPurchases(metal){
  const items=db.stock.filter(item=>!item.sourceRefiningBatchId&&item.date===todayStr()&&item.metal===metal).slice().sort((a,b)=>String(b.recordedAt||'').localeCompare(String(a.recordedAt||'')));
  const summary=todayPurchaseMetalSummary(items,metal);
  closeTodayMetalPurchases();
  const modal=document.createElement('div'); modal.id='today_metal_purchases_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="summary-modal daily-metal-modal" role="dialog" aria-modal="true" aria-labelledby="today_metal_purchases_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Daily purchase report · ${fmtDate(todayStr())}</div><h2 id="today_metal_purchases_title">${esc(metal)} purchased today</h2></div><button class="modal-close" onclick="closeTodayMetalPurchases()" aria-label="Close">×</button></div>
    <div class="daily-metal-summary"><div><span>Items</span><strong>${summary.count}</strong></div><div><span>Total weight</span><strong>${fmtWeight(summary.weight)}</strong></div><div><span>Total payout</span><strong>${fmtMoney(summary.payout)}</strong></div></div>
    ${dailyMetalPurityBreakdownMarkup(items,metal)}
    <h3 class="daily-metal-transactions-heading">Individual purchases</h3>
    ${tableOrEmpty(items,item=>`<tr><td>${esc(item.customerName||'Walk-in')}</td><td><span class="metal-tag ${metal.toLowerCase()}">${esc(gradeLabel(metal,item.karat))}</span> · ${esc(item.itemType||'—')}</td><td class="num">${fmtWeight(item.netWeight)}</td><td class="num">${fmtMoney(item.payout)}</td><td>${esc(item.paymentMethod||'—')}</td></tr>`,['Seller','Grade / item','Net weight','Payout','Payment'],'No '+metal.toLowerCase()+' purchases recorded today.')}
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeTodayMetalPurchases();});
  document.body.appendChild(modal);
}
function renderDashboard(){
  const today = todayStr(), mon = monthStr();
  const purchases=db.stock.filter(s=>!s.sourceRefiningBatchId);
  const pToday = purchases.filter(s=>s.date===today);
  const pMonth = purchases.filter(s=>s.date.startsWith(mon));
  const payoutToday = pToday.reduce((a,s)=>a+Number(s.payout),0);
  const payoutMonth = pMonth.reduce((a,s)=>a+Number(s.payout),0);
  const monthLabel=new Date(`${mon}-01T00:00:00`).toLocaleDateString('en-PH',{month:'long',year:'numeric'});
  const inventoryMonth=db.stock.filter(s=>s.date.startsWith(mon)&&Number(s.currentWeight)>0&&!['For Liquidation','Liquidated','Refined','Sold'].includes(s.status));
  const inventoryAmountMonth=inventoryMonth.reduce((a,s)=>a+Number(s.cost),0);
  const inventoryWeightMonth=inventoryMonth.reduce((a,s)=>a+Number(s.currentWeight),0);
  const todayMetalSummaries=['Gold','Silver','Platinum'].map(metal=>todayPurchaseMetalSummary(pToday,metal));

  const liqMonth = db.liquidations.filter(l=>l.date.startsWith(mon));
  const liqMargin = liqMonth.reduce((a,l)=>a+Number(l.margin),0);
  const retailMonth = db.retailSales.filter(r=>r.date.startsWith(mon));
  const retailMargin = retailMonth.reduce((a,r)=>a+Number(r.margin),0);
  return `
  <section class="block">
    <h2 class="block-title">Today &amp; this month</h2>
    <div class="stat-row">
      <div class="stat"><div class="label">Purchases today</div><div class="value">${pToday.length}</div><div class="sub">${fmtMoney(payoutToday)} paid out</div></div>
      <div class="stat"><div class="label">${esc(monthLabel)} inventory amount</div><div class="value">${fmtMoney(inventoryAmountMonth)}</div><div class="sub">${inventoryMonth.length} active item${inventoryMonth.length===1?'':'s'} · ${fmtWeight(inventoryWeightMonth)}</div></div>
      <div class="stat"><div class="label">Purchases this month</div><div class="value">${pMonth.length}</div><div class="sub">${fmtMoney(payoutMonth)} paid out</div></div>
      ${isAdmin()?`<div class="stat"><div class="label">Liquidation margin (month)</div><div class="value">${fmtMoney(liqMargin)}</div><div class="sub">${liqMonth.length} batch(es) released</div></div>
      <div class="stat"><div class="label">Retail margin (month)</div><div class="value">${fmtMoney(retailMargin)}</div><div class="sub">${retailMonth.length} item(s) sold</div></div>`:''}
    </div>
  </section>

  <section class="block daily-metal-report">
    <div class="daily-metal-report-head"><div><h2 class="block-title">Today's purchases by metal</h2><p class="form-note">Select a metal to see every purchase recorded on ${fmtDate(today)}.</p></div><strong>${fmtMoney(payoutToday)} total payout</strong></div>
    <div class="daily-metal-grid">
      ${todayMetalSummaries.map(summary=>`<button type="button" class="daily-metal-card ${summary.metal.toLowerCase()}" onclick="openTodayMetalPurchases('${summary.metal}')">
        <span class="daily-metal-name"><span class="metal-dot ${summary.metal.toLowerCase()}"></span>${summary.metal}</span>
        <strong>${fmtMoney(summary.payout)}</strong>
        <small>${summary.count} item${summary.count===1?'':'s'} · ${fmtWeight(summary.weight)}</small>
        <span class="daily-metal-open">View purity breakdown →</span>
      </button>`).join('')}
    </div>
  </section>

  ${isAdmin()?renderReports():''}
  `;
}

function statusPill(status){
  const map = {'Available':'selling','For Liquidation':'liquidation','For Refining':'refining','On Hold':'hold','Liquidated':'liquidated','Refined':'liquidated','Sold':'sold'};
  return `<span class="pill ${map[status]||''}">${status}</span>`;
}
function tableOrEmpty(rows, rowFn, headers, emptyMsg){
  if(!rows.length) return `<div class="empty-note">${emptyMsg}</div>`;
  const numericHeaders=new Set([
    'Net weight','Weight','Current weight','Weight available','Gross weight','Available weight','Input wt','Output weight',
    'Rate','Payout','Cost','Input cost','Output value','Total cost','Total sold','Profit','Margin','Charges',
    'Items','Transactions','Selling history','Total weight sold','Total payout','Expected yield','Actual yield','Variance','Rank'
  ]);
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th class="${numericHeaders.has(h)||String(h).startsWith('Monthly ·')||String(h).startsWith('Yearly ·')?'num-head':''}${h==='Rank'?' customer-sales-rank-head':''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(rowFn).join('')}</tbody></table></div>`;
}

/* ============================= RATES ============================= */
function renderRates(){
  if(!canEditDailyRates()) return renderStaffRates();
  const admin=isAdmin(),staffUnlocked=staffRateEditingUnlocked();
  const goldGrid = GOLD_GRADES.filter(g=>g.key!=='24K');
  const auto=db.pricing.auto;
  const fetched=auto.lastFetchedAt?new Date(auto.lastFetchedAt).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'medium'}):'Not fetched yet';
  return `
  <section class="auto-panel">
    <div class="auto-panel-head">
      <div>
        <h3>${admin?'Philippine internet pricing':'Daily buying rates'}</h3>
        <div class="metal-section-desc" style="margin:0;">${admin?'Rates stay unchanged until an administrator manually refreshes or edits them. You can set today\'s exact PHP base rate for each metal.':'An administrator has temporarily unlocked daily buying-rate editing for staff. Changes apply immediately to new purchases.'}</div>
        <div class="auto-status">${pricingFetchBusy?'<span class="spinner"></span>Updating Philippine market data…':`Last checked: ${esc(fetched)}${auto.goldSource?` · Gold source: ${esc(auto.goldSource)}`:''}`}</div>
      </div>
      <div class="auto-controls">
        ${admin?`<button class="btn secondary small" onclick="toggleStaffRateEditing()" ${staffRateEditingToggleBusy?'disabled aria-busy="true"':''}>${staffRateEditingToggleBusy?`<span class="spinner"></span>${staffUnlocked?'Unlocking…':'Locking…'}`:staffUnlocked?'Lock staff rate editing':'Unlock staff rate editing'}</button>`:''}
        ${admin?`
        <button class="btn small" onclick="refreshPhilippineRates(false)" ${pricingFetchBusy?'disabled':''}>Refresh &amp; apply now</button>
        <button class="btn secondary small" onclick="openDailyBaseEditor('Gold')">Edit today's PHP base</button>
        <button class="btn secondary small" onclick="openGoldMultiplierEditor()">Edit Gold karat multipliers</button>`:''}
      </div>
    </div>
    <div class="stat-row" style="margin-top:16px">
      <div class="stat"><div class="label">Gold 24K buying rate</div><div class="value">${fmtMoney(configuredBaseRate('Gold'))}/g</div><div class="sub">Market: ${fmtMoney(auto.marketPhp?.Gold)}/g</div></div>
      <div class="stat"><div class="label">Silver 999 buying rate</div><div class="value">${fmtMoney(configuredBaseRate('Silver'))}/g</div><div class="sub">Market: ${fmtMoney(auto.marketPhp?.Silver)}/g</div></div>
      <div class="stat"><div class="label">Platinum 999 buying rate</div><div class="value">${fmtMoney(configuredBaseRate('Platinum'))}/g</div><div class="sub">Market: ${fmtMoney(auto.marketPhp?.Platinum)}/g</div></div>
    </div>
    <p class="source-note">The internet price supplies the PHP base rate. Gold grades use the saved karat multipliers. Gold uses <a href="https://www.livepriceofgold.com/philippines-gold-price-per-gram.html" target="_blank" rel="noopener">LivePriceOfGold Philippines</a> when available, with an automatic fallback. Verify high-value payouts independently.</p>
  </section>
  <section class="block">
    <div class="batch-head"><div><h2 class="block-title">How automated pricing works</h2><p class="metal-section-desc">Use <strong>Edit today's PHP base</strong> to set a metal's base rate for this Philippine date. Gold grades recalculate using the saved karat multipliers. Use <strong>Override PHP rate</strong> only when one specific grade needs a different exact rate.</p></div></div>
  </section>

  <section class="metal-section">
    <div class="rate-section-title-row"><div class="metal-section-head"><span class="metal-dot gold"></span><h3>Gold</h3><span class="count">${GOLD_GRADES.length} grades</span></div>${renderRateDownloadButton()}</div>
    <div class="base-row">
      <div class="base-box">
        <div class="base-label">24K rate — pure gold</div>
        <div class="base-input"><span>₱</span><input type="text" inputmode="numeric" value="${roundPeso(configuredBaseRate('Gold'))||''}" onchange="setBase('Gold', this.value)"></div>
      </div>
      ${admin?renderFeaturedBox():''}
    </div>
    <div class="grade-grid">${goldGrid.map(g=>renderGradeCard('Gold', g.key, g.label)).join('')}</div>
  </section>

  <section class="metal-section">
    <div class="metal-section-head"><span class="metal-dot silver"></span><h3>Silver</h3><span class="count">${SILVER_GRADES.length} grades</span></div>
    <div class="base-row">
      <div class="base-box">
        <div class="base-label">999 rate — independent silver rate</div>
        <div class="base-input"><span>₱</span><input type="text" inputmode="numeric" value="${roundPeso(configuredBaseRate('Silver'))||''}" onchange="setBase('Silver', this.value)"></div>
      </div>
      <div class="base-box">
        <div class="base-label">925 basis — calculates 900, 800, 75% and 60%</div>
        <div class="base-input"><span>₱</span><input type="text" inputmode="numeric" value="${configuredSilver925Rate()||''}" onchange="setSilver925Base(this.value)"></div>
      </div>
    </div>
    <div class="grade-grid">${SILVER_GRADES.filter(g=>g.key!=='999'&&g.key!=='925').map(g=>renderGradeCard('Silver', g.key, g.label)).join('')}</div>
  </section>

  <section class="metal-section">
    <div class="metal-section-head"><span class="metal-dot platinum"></span><h3>Platinum</h3><span class="count">${PLATINUM_GRADES.length} grades</span></div>
    <div class="base-row">
      <div class="base-box">
        <div class="base-label">999 rate — pure platinum</div>
        <div class="base-input"><span>₱</span><input type="text" inputmode="numeric" value="${roundPeso(configuredBaseRate('Platinum'))||''}" onchange="setBase('Platinum', this.value)"></div>
      </div>
    </div>
    <div class="grade-grid">${PLATINUM_GRADES.map(g=>renderGradeCard('Platinum', g.key, g.label)).join('')}</div>
  </section>

  ${admin?`<section class="block">
    <h2 class="block-title">Save today's rate sheet</h2>
    <div class="form-grid">
      <div class="field"><label>Effective date</label><input id="px_date" type="date" value="${db.pricing.effectiveDate||todayStr()}"></div>
      <div class="field"><label>Entered by</label><input id="px_by" placeholder="Staff name"></div>
    </div>
    <div class="form-actions">
      <button class="btn" onclick="savePricingSnapshot()">Save rate sheet</button>
      <span class="form-note">Rates above already apply to new purchases as you edit them. Saving records this sheet in the audit history below.</span>
    </div>
  </section>`:''}

  `;
}
function renderStaffRates(){
  const fetched=db.pricing.auto.lastFetchedAt?new Date(db.pricing.auto.lastFetchedAt).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'medium'}):'Not fetched yet';
  return `
  <section class="auto-panel">
    <div class="auto-panel-head"><div><h3>Active buying rates</h3><div class="metal-section-desc" style="margin:0;">Rates are locked by an administrator. Ask an administrator to unlock daily buying-rate editing when a staff update is needed.</div><div class="auto-status">Effective date: ${fmtDate(db.pricing.effectiveDate)} · Last checked: ${esc(fetched)}</div></div></div>
  </section>
  <section class="metal-section">
    <div class="rate-section-title-row"><div class="metal-section-head"><span class="metal-dot gold"></span><h3>Gold</h3><span class="count">${GOLD_GRADES.length} grades</span></div>${renderRateDownloadButton()}</div>
    <div class="grade-grid">${GOLD_GRADES.map(g=>renderGradeCard('Gold',g.key,g.label)).join('')}</div>
  </section>
  <section class="metal-section">
    <div class="metal-section-head"><span class="metal-dot silver"></span><h3>Silver</h3><span class="count">${SILVER_GRADES.length} grades</span></div>
    <div class="grade-grid">${SILVER_GRADES.map(g=>renderGradeCard('Silver',g.key,g.label)).join('')}</div>
  </section>
  <section class="metal-section">
    <div class="metal-section-head"><span class="metal-dot platinum"></span><h3>Platinum</h3><span class="count">${PLATINUM_GRADES.length} grades</span></div>
    <div class="grade-grid">${PLATINUM_GRADES.map(g=>renderGradeCard('Platinum',g.key,g.label)).join('')}</div>
  </section>`;
}
function renderRateDownloadButton(){
  const icon=`<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 15v4h14v-4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const button=(format:'desktop'|'phone')=>{
    const formatLabel=format==='phone'?'Phone':'Desktop';
    return `<button id="rate_download_${format}" type="button" class="btn secondary rate-download-btn" onclick="openRateSheetDownloadModal('${format}')" title="Choose JPG or PNG for the ${formatLabel.toLowerCase()} layout">${icon}<span class="rate-download-label">${formatLabel} Download</span></button>`;
  };
  return `<div class="rate-sheet-toolbar">${button('desktop')}${button('phone')}</div>`;
}

function closeRateSheetDownloadModal(){ document.getElementById('rate_sheet_download_modal')?.remove(); }
function openRateSheetDownloadModal(format:'desktop'|'phone'){
  closeRateSheetDownloadModal();
  const formatLabel=format==='phone'?'Phone':'Desktop';
  const modal=document.createElement('div'); modal.id='rate_sheet_download_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="summary-modal" role="dialog" aria-modal="true" aria-labelledby="rate_sheet_download_title">
    <div class="summary-modal-head"><div><div class="eyebrow">${formatLabel} rate sheet</div><h2 id="rate_sheet_download_title">Choose image format</h2></div><button type="button" class="modal-close" onclick="closeRateSheetDownloadModal()" aria-label="Close">×</button></div>
    <p class="form-note">Download the ${format==='phone'?'portrait phone':'landscape desktop'} layout as a JPG or PNG image.</p>
    <div class="form-actions"><button type="button" class="btn secondary" onclick="downloadRateSheetFromModal('${format}','jpg')">Download JPG</button><button type="button" class="btn" onclick="downloadRateSheetFromModal('${format}','png')">Download PNG</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeRateSheetDownloadModal();});
  document.body.appendChild(modal);
}
function downloadRateSheetFromModal(format:'desktop'|'phone',imageType:'jpg'|'png'){
  closeRateSheetDownloadModal();
  downloadRateSheetImage(format,imageType);
}

function rateSheetGoldGrades(){
  return GOLD_GRADES.filter(grade=>grade.key!=='24K'&&grade.key!=='18K-BUO'&&grade.key!=='73%');
}

function rateSheetSectionMargin(isPhone){
  return isPhone?56:30;
}

async function downloadRateSheetImage(format:'auto'|'desktop'|'phone'='auto',imageType:'jpg'|'png'='jpg'){
  const resolvedFormat=format==='auto'?(window.matchMedia('(max-width: 700px)').matches?'phone':'desktop'):format;
  const isPhone=resolvedFormat==='phone';
  const imageLabel=imageType.toUpperCase(),mimeType=imageType==='png'?'image/png':'image/jpeg';
  const button=document.getElementById(`rate_download_${resolvedFormat}`);
  const label=button?.querySelector('.rate-download-label');
  if(button){ button.disabled=true; button.setAttribute('aria-busy','true'); }
  if(label) label.textContent='Generating…';
  try{
    await document.fonts?.ready;
    const canvas=document.createElement('canvas');
    const width=isPhone?1080:1600,height=isPhone?2800:1120,pad=isPhone?44:28,columnGap=isPhone?16:7,cardHeight=isPhone?118:86;
    canvas.width=width; canvas.height=height;
    const ctx=canvas.getContext('2d');
    if(!ctx) throw new Error('Canvas is unavailable');
    const colors=isPhone
      ?{paper:'#FBF7ED',paper2:'#F2E8D2',card:'#FFFCF5',ink:'#292620',soft:'#514B40',line:'#CDBD93',gold:'#BA8317',goldDeep:'#654812',silver:'#687783',platinum:'#3F6F67',cream:'#FFF9ED',header:'#332E27'}
      :{paper:'#F7F2E6',paper2:'#EFE7D3',card:'#FBF8EF',ink:'#1C1B19',soft:'#655E50',line:'#D8CAA5',gold:'#D19A27',goldDeep:'#7C5A17',silver:'#7C8792',platinum:'#4F7A73',cream:'#F7F2E6',header:'#1C1B19'};
    ctx.fillStyle=colors.paper; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.textBaseline='alphabetic';
    const roundedRect=(x,y,w,h,r=5)=>{
      ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
    };
    const text=(value,x,y,font,color=colors.ink,align='left')=>{
      ctx.font=font; ctx.fillStyle=color; ctx.textAlign=align; ctx.fillText(String(value),x,y);
    };
    const clippedText=(value,maxWidth,font)=>{
      ctx.font=font;
      const source=String(value||'');
      if(ctx.measureText(source).width<=maxWidth) return source;
      let clipped=source;
      while(clipped&&ctx.measureText(clipped+'…').width>maxWidth) clipped=clipped.slice(0,-1);
      return clipped+'…';
    };
    const money=value=>Math.round(Number(value)||0).toLocaleString('en-PH');
    const logo=await new Promise(resolve=>{
      const image=new Image();
      image.onload=()=>resolve(image); image.onerror=()=>resolve(null);
      image.src='/zpp-logo.png';
    });
    const headerHeight=isPhone?200:132;
    ctx.fillStyle=colors.header; ctx.fillRect(0,0,width,headerHeight);
    ctx.fillStyle=colors.gold; ctx.fillRect(0,headerHeight-3,width,3);
    if(logo) ctx.drawImage(logo,pad,isPhone?20:10,isPhone?154:108,isPhone?154:108);
    text('ZPP GOLD TRADING',isPhone?220:154,isPhone?82:57,isPhone?'700 46px Georgia, serif':'700 31px Georgia, serif',colors.cream);
    text('DAILY BUYING PRICE GUIDE',isPhone?222:155,isPhone?126:87,isPhone?'700 22px Arial, sans-serif':'700 12px Arial, sans-serif',colors.gold);
    text('All prices shown in Philippine pesos per gram',isPhone?222:155,isPhone?158:108,isPhone?'20px Arial, sans-serif':'12px Arial, sans-serif',isPhone?'#E1D6BE':'#C9BE9F');
    text(fmtDate(db.pricing.effectiveDate||todayStr()).toUpperCase(),width-pad,isPhone?72:59,isPhone?'700 22px Arial, sans-serif':'700 13px Arial, sans-serif',colors.cream,'right');
    text('CURRENT RATE SHEET',width-pad,isPhone?108:84,isPhone?'18px Arial, sans-serif':'11px Arial, sans-serif',isPhone?'#E1D6BE':'#C9BE9F','right');
    const drawHeading=(metal,count,color,y)=>{
      const dotRadius=isPhone?9:6;
      ctx.beginPath(); ctx.fillStyle=color; ctx.arc(pad+dotRadius,y-(isPhone?10:6),dotRadius,0,Math.PI*2); ctx.fill();
      text(metal,pad+(isPhone?32:22),y,isPhone?'700 34px Georgia, serif':'700 21px Georgia, serif');
      const nameWidth=ctx.measureText(metal).width;
      text(`${count} GRADES`,pad+(isPhone?48:31)+nameWidth,y-(isPhone?4:2),isPhone?'700 18px Arial, sans-serif':'700 10px Arial, sans-serif',colors.soft);
      ctx.beginPath(); ctx.strokeStyle=colors.line; ctx.lineWidth=isPhone?2:1; ctx.moveTo(pad+(isPhone?48:31)+nameWidth+(isPhone?132:80),y-(isPhone?11:7)); ctx.lineTo(width-pad,y-(isPhone?11:7)); ctx.stroke();
    };
    const drawBase=(x,y,label,rate,w=250)=>{
      const boxHeight=isPhone?130:90;
      roundedRect(x,y,w,boxHeight,isPhone?10:7); ctx.fillStyle=colors.card; ctx.fill(); ctx.strokeStyle=colors.gold; ctx.lineWidth=isPhone?2:1.5; ctx.stroke();
      ctx.fillStyle=colors.gold; ctx.fillRect(x,y+(isPhone?10:7),isPhone?6:4,boxHeight-(isPhone?20:14));
      text(label.toUpperCase(),x+(isPhone?28:18),y+(isPhone?38:25),isPhone?'700 20px Arial, sans-serif':'700 10px Arial, sans-serif',colors.soft);
      text('₱',x+(isPhone?28:18),y+(isPhone?94:64),isPhone?'700 28px Georgia, serif':'700 17px Georgia, serif',colors.goldDeep);
      text(money(rate),x+(isPhone?66:39),y+(isPhone?96:65),isPhone?'700 40px Arial, sans-serif':'700 25px Arial, sans-serif');
      text('PER GRAM',x+w-(isPhone?26:16),y+(isPhone?93:64),isPhone?'700 17px Arial, sans-serif':'700 9px Arial, sans-serif',colors.soft,'right');
    };
    const drawFeatured=(x,y,w)=>{
      const boxHeight=isPhone?130:90;
      roundedRect(x,y,w,boxHeight,isPhone?10:7); ctx.fillStyle=isPhone?colors.paper2:colors.ink; ctx.fill();
      if(isPhone){ctx.strokeStyle=colors.line;ctx.lineWidth=2;ctx.stroke();}
      text('FEATURED BUYING RANGE',x+(isPhone?28:20),y+(isPhone?38:24),isPhone?'700 20px Arial, sans-serif':'700 10px Arial, sans-serif',isPhone?colors.soft:'#C9BE9F');
      const featured=db.pricing.featured;
      if(featured){
        const label=gradeLabel(featured.metal,featured.key);
        text(label,x+(isPhone?28:20),y+(isPhone?96:64),isPhone?'700 38px Georgia, serif':'700 24px Georgia, serif',isPhone?colors.ink:colors.cream);
        const labelWidth=ctx.measureText(label).width;
        text(`₱${money(featured.low)}–${money(featured.high)}`,x+(isPhone?48:34)+labelWidth,y+(isPhone?96:64),isPhone?'700 38px Arial, sans-serif':'700 24px Arial, sans-serif',isPhone?colors.goldDeep:colors.gold);
        if(featured.remarks){
          const remarksFont=isPhone?'italic 17px Arial, sans-serif':'italic 10px Arial, sans-serif';
          text(clippedText(`Remarks: ${featured.remarks}`,w-(isPhone?56:40),remarksFont),x+(isPhone?28:20),y+(isPhone?121:83),remarksFont,isPhone?colors.soft:'#C9BE9F');
        }
      }else{
        text('Featured buying range not set',x+(isPhone?28:20),y+(isPhone?91:61),isPhone?'italic 28px Georgia, serif':'italic 16px Georgia, serif',isPhone?colors.soft:'#C9BE9F');
      }
    };
    const drawGradeCard=(grade,metal,index,startY,columns)=>{
      const cardWidth=(width-pad*2-columnGap*(columns-1))/columns;
      const col=index%columns,row=Math.floor(index/columns),x=pad+col*(cardWidth+columnGap),y=startY+row*(cardHeight+columnGap);
      roundedRect(x,y,cardWidth,cardHeight,isPhone?10:6); ctx.fillStyle=colors.card; ctx.fill(); ctx.strokeStyle=colors.line; ctx.lineWidth=isPhone?2:1; ctx.stroke();
      text(grade.label,x+(isPhone?24:15),y+(isPhone?34:23),isPhone?'700 23px Arial, sans-serif':'700 12px Arial, sans-serif',colors.soft);
      if(metal==='Gold'){
        const pillWidth=isPhone?112:58,pillHeight=isPhone?34:20;
        roundedRect(x+cardWidth-pillWidth-(isPhone?20:14),y+(isPhone?14:10),pillWidth,pillHeight,pillHeight/2); ctx.fillStyle=colors.paper2; ctx.fill();
        text(`×${configuredGradeMultiplier(metal,grade.key).toFixed(3)}`,x+cardWidth-pillWidth/2-(isPhone?20:14),y+(isPhone?38:24),isPhone?'700 17px Arial, sans-serif':'700 9px Arial, sans-serif',colors.soft,'center');
      }
      text('₱',x+(isPhone?24:15),y+(isPhone?83:57),isPhone?'700 22px Arial, sans-serif':'700 13px Arial, sans-serif',colors.goldDeep);
      text(money(metalRate(metal,grade.key)),x+(isPhone?54:34),y+(isPhone?85:58),isPhone?'700 34px Arial, sans-serif':'700 20px Arial, sans-serif');
      const numberWidth=ctx.measureText(money(metalRate(metal,grade.key))).width;
      text('/g',x+(isPhone?64:40)+numberWidth,y+(isPhone?85:58),isPhone?'20px Arial, sans-serif':'11px Arial, sans-serif',colors.soft);
      text('BUYING RATE',x+(isPhone?24:15),y+(isPhone?108:76),isPhone?'700 16px Arial, sans-serif':'700 9px Arial, sans-serif',colors.goldDeep);
    };

    const goldGrades=rateSheetGoldGrades();
    let y=isPhone?254:172;
    drawHeading('Gold',goldGrades.length+1,colors.gold,y); y+=16;
    if(isPhone){
      y+=14;
      drawBase(pad,y,'24K rate — pure gold',configuredBaseRate('Gold'),width-pad*2);
      y+=146;
      drawFeatured(pad,y,width-pad*2);
      y+=146;
    }else{
      drawBase(pad,y,'24K rate — pure gold',configuredBaseRate('Gold'));
      drawFeatured(pad+258,y,520);
      y+=98;
    }
    const goldColumns=isPhone?2:6;
    goldGrades.forEach((grade,index)=>drawGradeCard(grade,'Gold',index,y,goldColumns));
    y+=Math.ceil(goldGrades.length/goldColumns)*(cardHeight+columnGap)+(isPhone?30:18);
    y+=rateSheetSectionMargin(isPhone);

    drawHeading('Silver',SILVER_GRADES.length,colors.silver,y); y+=16;
    if(isPhone){
      y+=14;
      const halfWidth=(width-pad*2-columnGap)/2;
      drawBase(pad,y,'999 rate',configuredBaseRate('Silver'),halfWidth);
      drawBase(pad+halfWidth+columnGap,y,'925 basis',configuredSilver925Rate(),halfWidth);
      y+=146;
    }else{
      drawBase(pad,y,'999 rate',configuredBaseRate('Silver'));
      drawBase(pad+258,y,'925 basis',configuredSilver925Rate(),300);
      y+=98;
    }
    const silverGrades=SILVER_GRADES.filter(grade=>grade.key!=='999'&&grade.key!=='925');
    const otherColumns=isPhone?2:4;
    silverGrades.forEach((grade,index)=>drawGradeCard(grade,'Silver',index,y,otherColumns));
    y+=Math.ceil(silverGrades.length/otherColumns)*(cardHeight+columnGap)+(isPhone?30:18);
    y+=rateSheetSectionMargin(isPhone);

    drawHeading('Platinum',PLATINUM_GRADES.length,colors.platinum,y); y+=16;
    if(isPhone){
      y+=14;
      drawBase(pad,y,'999 rate — pure platinum',configuredBaseRate('Platinum'),width-pad*2);
      y+=146;
    }else{
      drawBase(pad,y,'999 rate — pure platinum',configuredBaseRate('Platinum'));
      y+=98;
    }
    PLATINUM_GRADES.forEach((grade,index)=>drawGradeCard(grade,'Platinum',index,y,otherColumns));

    ctx.beginPath(); ctx.strokeStyle=colors.line; ctx.lineWidth=1; ctx.moveTo(pad,height-31); ctx.lineTo(width-pad,height-31); ctx.stroke();
    text('ZPP GOLD TRADING  ·  DAILY BUYING PRICE GUIDE',pad,height-(isPhone?18:13),isPhone?'700 16px Arial, sans-serif':'700 9px Arial, sans-serif',colors.soft);
    text(`Generated ${new Date().toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})}`,width-pad,height-(isPhone?18:13),isPhone?'16px Arial, sans-serif':'10px Arial, sans-serif',colors.soft,'right');

    const blob=await new Promise(resolve=>canvas.toBlob(resolve,mimeType,imageType==='jpg'?.94:undefined));
    if(!blob) throw new Error(`${imageLabel} generation failed`);
    const filename=`zpp-price-rates-${db.pricing.effectiveDate||todayStr()}-${resolvedFormat}.${imageType}`;
    const file=new File([blob],filename,{type:mimeType});
    if(isPhone&&navigator.share&&navigator.canShare?.({files:[file]})){
      try{
        await navigator.share({files:[file],title:'ZPP Gold Trading price rates'});
        toast(`Phone ${imageLabel} opened — choose Save Image or Photos`);
        return;
      }catch(error){
        if(error instanceof DOMException&&error.name==='AbortError'){
          toast(`Phone ${imageLabel} share cancelled`);
          return;
        }
      }
    }
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url; link.download=filename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast(`${isPhone?'Phone':'Desktop'} price rate ${imageLabel} downloaded${isPhone?' — open it and choose Save to Photos':''}`);
  }catch(error){
    console.error(`Price rate ${imageLabel} download failed`,error);
    toast(`Could not generate the price rate ${imageLabel}`);
  }finally{
    if(button){ button.disabled=false; button.removeAttribute('aria-busy'); }
    if(label) label.textContent=`${isPhone?'Phone':'Desktop'} Download`;
  }
}
function renderGradeCard(metal, key, label){
  const ov = isOverridden(metal, key);
  const editing = overrideEditors.has(overrideEditorId(metal,key));
  const rate = metalRate(metal, key);
  const editable=canEditDailyRates();
  const rateControl = editable&&(editing||ov)
    ? `<input data-rate-editor="${metal}-${key}" type="text" inputmode="decimal" value="${rate}" onchange="commitOverride('${metal}','${key}', this.value)">`
    : `<span class="gc-value">${rate}</span>`;
  const rateAction=!editable?'<span class="form-note">Locked by administrator</span>':ov? `<span class="ov-tag">overridden</span> · <button onclick="resetOverride('${metal}','${key}')">reset PHP rate</button>` : editing? `<button onclick="cancelOverride('${metal}','${key}')">cancel override</button>` : `<button onclick="beginOverride('${metal}','${key}')">Override PHP rate</button>`;
  return `<div class="grade-card ${ov?'is-override':''}">
    <div class="gc-top"><span>${esc(label)}</span>${metal==='Gold'?`<span>×${configuredGradeMultiplier(metal,key).toFixed(3)}</span>`:''}</div>
    <div class="gc-rate"><span class="unit">₱</span>${rateControl}<span class="unit">/g</span></div>
    <div class="gc-foot">${rateAction}</div>
  </div>`;
}
let formulaEditTarget=null;
function openDailyBaseEditor(metal){
  if(!canEditDailyRates()) return;
  if(!GRADES[metal]) return;
  formulaEditTarget={metal};
  document.getElementById('formula_edit_modal')?.remove();
  const liveBase=Number(bucketFor(metal).base)||0,base=configuredBaseRate(metal),silver925=configuredSilver925Rate(base);
  const customized=Math.abs(base-liveBase)>=0.005;
  const modal=document.createElement('div'); modal.id='formula_edit_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<form class="summary-modal" onsubmit="saveGradeFormula(event)" role="dialog" aria-modal="true" aria-labelledby="formula_edit_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Daily rate setup</div><h2 id="formula_edit_title">Today's PHP base rate</h2></div><button type="button" class="modal-close" onclick="closeGradeFormulaEditor()" aria-label="Close">×</button></div>
    <p class="form-note" style="margin:16px 0;">${metal==='Silver'?'Set the independent 999 rate and the 925 basis used to calculate 900, 800, 75%, and 60%.':'This exact PHP base rate applies to all '+esc(metal)+' grades.'} Rates are rounded to whole pesos with no centavos.</p>
    <div class="form-grid">
      <div class="field"><label>Metal</label><select id="formula_metal" onchange="changeFormulaEditorMetal(this.value)">${Object.keys(GRADES).map(name=>`<option value="${name}" ${name===metal?'selected':''}>${name}</option>`).join('')}</select></div>
      <div class="field"><label>Live PHP base rate</label><input value="${roundPeso(liveBase)}" readonly></div>
      <div class="field"><label>Today's ${metal==='Silver'?'999':'PHP base'} rate</label><input id="formula_base_rate" type="number" min="1" step="1" value="${roundPeso(base)}" oninput="updateGradeFormulaPreview()" required></div>
      ${metal==='Silver'?`<div class="field"><label>Today's 925 basis rate</label><input id="formula_silver_925_rate" type="number" min="1" step="1" value="${silver925}" oninput="updateGradeFormulaPreview()" required><span class="hint">900, 800, 75%, and 60% calculate from this rate.</span></div>`:''}
    </div>
    <div class="stat" style="margin-top:14px"><div class="label">Active rate${metal==='Silver'?'s':''} for today</div><div class="value" id="formula_preview">${metal==='Silver'?`999: ${fmtMoney(base)}/g · 925: ${fmtMoney(silver925)}/g`:fmtMoney(base)+'/g'}</div></div>
    <div class="form-actions">${customized?'<button type="button" class="btn secondary" onclick="resetGradeFormula()">Use live PHP base</button>':''}<button type="button" class="btn secondary" onclick="closeGradeFormulaEditor()">Cancel</button><button type="submit" class="btn">Save today's base rate</button></div>
  </form>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeGradeFormulaEditor();});
  document.body.appendChild(modal); document.getElementById('formula_base_rate')?.focus();
}
function changeFormulaEditorMetal(metal){ openDailyBaseEditor(metal); }
function updateGradeFormulaPreview(){
  if(!formulaEditTarget) return;
  const base=Number(val('formula_base_rate')),preview=document.getElementById('formula_preview');
  const silver925=Number(val('formula_silver_925_rate'));
  if(preview) preview.textContent=Number.isFinite(base)&&base>0?(formulaEditTarget.metal==='Silver'&&Number.isFinite(silver925)&&silver925>0?`999: ${fmtMoney(base)}/g · 925: ${fmtMoney(silver925)}/g`:`${fmtMoney(base)}/g`):'Enter a valid PHP base rate';
}
function closeGradeFormulaEditor(){ document.getElementById('formula_edit_modal')?.remove(); formulaEditTarget=null; }
async function saveGradeFormula(event){
  event.preventDefault(); if(!formulaEditTarget||!canEditDailyRates()) return;
  const baseRate=roundPeso(Number(val('formula_base_rate')));
  if(!Number.isFinite(baseRate)||baseRate<=0){ toast('Enter a valid PHP base rate'); return; }
  const {metal}=formulaEditTarget;
  const silver925=metal==='Silver'?roundPeso(Number(val('formula_silver_925_rate'))):0;
  if(metal==='Silver'&&(!Number.isFinite(silver925)||silver925<=0)){ toast('Enter a valid Silver 925 basis rate'); return; }
  if(db.pricing.dailyFormula.effectiveDate!==todayStr()) db.pricing.dailyFormula={effectiveDate:todayStr(),baseRates:{}};
  db.pricing.dailyFormula.baseRates[metal]=baseRate;
  if(metal==='Silver'){
    db.pricing.dailyFormula.baseRates.Silver925=silver925;
    delete db.pricing.silver.overrides['925'];
  }
  closeGradeFormulaEditor(); if(await savePricingDB()){ render(); toast(`${metal} PHP base rate updated for today`); }
}
async function resetGradeFormula(){
  if(!formulaEditTarget||!canEditDailyRates()) return;
  const {metal}=formulaEditTarget;
  if(db.pricing.dailyFormula?.baseRates) delete db.pricing.dailyFormula.baseRates[metal];
  if(metal==='Silver'&&db.pricing.dailyFormula?.baseRates) delete db.pricing.dailyFormula.baseRates.Silver925;
  closeGradeFormulaEditor(); if(await savePricingDB()){ render(); toast(`${metal} PHP base reset to the live rate`); }
}
let featuredRemarksDraft='';
function closeFeaturedRemarksEditor(){ document.getElementById('featured_remarks_modal')?.remove(); }
function openFeaturedRemarksEditor(){
  if(!isAdmin()) return;
  closeFeaturedRemarksEditor();
  const remarks=String(db.pricing.featured?.remarks??featuredRemarksDraft??'');
  const modal=document.createElement('div'); modal.id='featured_remarks_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<form class="summary-modal" onsubmit="saveFeaturedRemarks(event)" role="dialog" aria-modal="true" aria-labelledby="featured_remarks_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Featured buying range</div><h2 id="featured_remarks_title">Remarks</h2></div><button type="button" class="modal-close" onclick="closeFeaturedRemarksEditor()" aria-label="Close">×</button></div>
    <div class="field" style="margin-top:16px;"><label for="featured_remarks_text">Remark shown with the pinned range</label><textarea id="featured_remarks_text" maxlength="120" placeholder="Example: Clean items only">${esc(remarks)}</textarea><span class="hint">This remark also appears in downloaded JPG and PNG rate sheets.</span></div>
    <div class="form-actions"><button type="button" class="btn secondary" onclick="closeFeaturedRemarksEditor()">Cancel</button><button type="submit" class="btn">Save remarks</button></div>
  </form>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeFeaturedRemarksEditor();}); document.body.appendChild(modal);
  document.getElementById('featured_remarks_text')?.focus();
}
async function saveFeaturedRemarks(event){
  event.preventDefault();
  const remarks=val('featured_remarks_text').trim();
  if(db.pricing.featured){
    db.pricing.featured.remarks=remarks;
    if(!await savePricingDB()) return;
    closeFeaturedRemarksEditor(); render(); toast('Featured remarks saved');
    return;
  }
  featuredRemarksDraft=remarks;
  closeFeaturedRemarksEditor();
  const button=document.getElementById('featured_remarks_button');
  if(button) button.textContent=remarks?'Remarks ✓':'Remarks';
  toast(remarks?'Remarks ready to save with the pinned range':'Remarks cleared');
}
function renderFeaturedBox(){
  const f = db.pricing.featured;
  if(!f){
    return `<div class="featured-box">
      <span class="fx-label">Pin a grade to quote a buying range to staff</span>
      <div class="fx-edit">
        <select id="fx_metal" onchange="updateFxKeyOptions()">${['Gold','Silver','Platinum'].map(m=>`<option>${m}</option>`).join('')}</select>
        <select id="fx_key">${GRADES['Gold'].map(k=>`<option value="${k}">${gradeLabel('Gold',k)}</option>`).join('')}</select>
        <input id="fx_low" type="text" inputmode="decimal" placeholder="Low">
        <input id="fx_high" type="text" inputmode="decimal" placeholder="High">
        <button id="featured_remarks_button" class="btn small secondary" style="color:var(--cream-text);border-color:#45412F;" onclick="openFeaturedRemarksEditor()">Remarks${featuredRemarksDraft?' ✓':''}</button>
        <button class="btn small" onclick="saveFeaturedFromForm()">Pin</button>
      </div>
    </div>`;
  }
  return `<div class="featured-box">
    <span class="fx-grade">${esc(gradeLabel(f.metal,f.key))}</span>
    <span class="fx-range">₱${Number(f.low).toLocaleString()}–${Number(f.high).toLocaleString()}</span>
    ${f.remarks?`<span class="fx-label">${esc(f.remarks)}</span>`:''}
    <button class="btn small secondary" style="color:var(--cream-text);border-color:#45412F;" onclick="clearFeatured()">Unpin</button>
  </div>`;
}
function updateFxKeyOptions(){
  const m = val('fx_metal');
  const sel = document.getElementById('fx_key');
  if(sel) sel.innerHTML = GRADES[m].map(k=>`<option value="${k}">${gradeLabel(m,k)}</option>`).join('');
}
async function saveFeaturedFromForm(){
  const metal = val('fx_metal'), key = val('fx_key'), low = val('fx_low'), high = val('fx_high');
  if(low===''||high===''){ toast('Enter both a low and high value'); return; }
  const remarks=featuredRemarksDraft;
  featuredRemarksDraft='';
  await setFeatured(metal, key, low, high, remarks);
}
function val(id){ const e=document.getElementById(id); return e? e.value : ''; }

/* ============================= ADMIN EDIT MODALS ============================= */
function openAdminEditModal(title, formMarkup, saveAction, deleteAction=''){
  if(!isAdmin()){ toast('Administrator access required'); return; }
  closeAdminEditModal();
  const modal=document.createElement('div');
  modal.id='admin_edit_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="edit-modal" role="dialog" aria-modal="true" aria-labelledby="admin_edit_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Administrator edit</div><h2 id="admin_edit_title">${esc(title)}</h2></div><button class="modal-close" onclick="closeAdminEditModal()" aria-label="Close">×</button></div>
    ${formMarkup}
    <div class="form-actions">${deleteAction?`<button class="btn danger" onclick="${deleteAction}()">Delete record</button>`:''}<button class="btn secondary" onclick="closeAdminEditModal()">Cancel</button><button class="btn" onclick="${saveAction}()">Save changes</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeAdminEditModal();});
  document.body.appendChild(modal);
  modal.querySelector('input, select, textarea')?.focus();
}
function closeAdminEditModal(){ document.getElementById('admin_edit_modal')?.remove(); }
function adminEditButton(kind,id){ return isAdmin()?`<button class="btn secondary small" onclick="open${kind}Edit('${id}')">Edit</button>`:''; }
function adminEditGuard(){ if(!isAdmin()){ toast('Administrator access required'); return false; } return true; }

let deleteConfirmationResolve=null;
function closeDeleteConfirmation(confirmed=false){
  document.getElementById('delete_confirmation_modal')?.remove();
  const resolve=deleteConfirmationResolve;
  deleteConfirmationResolve=null;
  if(resolve) resolve(confirmed);
}
function confirmDeletion(title,message,details=[]){
  closeDeleteConfirmation(false);
  return new Promise(resolve=>{
    deleteConfirmationResolve=resolve;
    const modal=document.createElement('div');
    modal.id='delete_confirmation_modal'; modal.className='modal-backdrop delete-confirm-backdrop';
    modal.innerHTML=`<div class="delete-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete_confirmation_title" aria-describedby="delete_confirmation_message">
      <div class="delete-confirm-icon" aria-hidden="true">!</div>
      <div class="delete-confirm-copy"><div class="eyebrow">Administrator confirmation</div><h2 id="delete_confirmation_title">${esc(title)}</h2><p id="delete_confirmation_message">${esc(message)}</p></div>
      ${details.length?`<div class="delete-confirm-details">${details.map(detail=>`<div><span>${esc(detail.label)}</span><strong>${esc(detail.value)}</strong></div>`).join('')}</div>`:''}
      <div class="delete-confirm-warning"><strong>This action cannot be undone.</strong><span>Please verify the record before continuing.</span></div>
      <div class="form-actions delete-confirm-actions"><button class="btn secondary" onclick="closeDeleteConfirmation(false)">Cancel</button><button class="btn danger" id="confirm_delete_button" onclick="closeDeleteConfirmation(true)">Delete permanently</button></div>
    </div>`;
    modal.addEventListener('click',event=>{if(event.target===modal)closeDeleteConfirmation(false);});
    modal.addEventListener('keydown',event=>{if(event.key==='Escape')closeDeleteConfirmation(false);});
    document.body.appendChild(modal);
    requestAnimationFrame(()=>modal.querySelector('.btn.secondary')?.focus());
  });
}

/* ============================= CUSTOMERS ============================= */
let custSearch = '', custOpen = null;
let customerSalesMonth=todayStr().slice(0,7), customerSalesYear=todayStr().slice(0,4), customerSalesRankBy='monthly', customerSalesLeaderboardMinimized=false;
function customerStockHistory(customer){
  const normalizedName=String(customer?.name||'').trim().toLowerCase();
  return db.stock.filter(item=>item.customerId===customer.id||(!item.customerId&&normalizedName&&String(item.customerName||'').trim().toLowerCase()===normalizedName));
}
function customerSalesTotals(items){
  const transactionIds=new Set(items.map(item=>item.batchId||item.id));
  return {
    transactions:transactionIds.size,
    items:items.length,
    weight:roundWeight(items.reduce((sum,item)=>sum+Number(item.netWeight||0),0)),
    payout:roundMoney(items.reduce((sum,item)=>sum+Number(item.payout??item.cost??0),0))
  };
}
function customerSalesLeaderboard(month=customerSalesMonth,year=customerSalesYear,rankBy=customerSalesRankBy){
  return db.customers.map(customer=>{
    const history=customerStockHistory(customer);
    return {customer,monthly:customerSalesTotals(history.filter(item=>String(item.date||'').slice(0,7)===month)),yearly:customerSalesTotals(history.filter(item=>String(item.date||'').slice(0,4)===year))};
  }).sort((a,b)=>{
    const primary=Number(b[rankBy]?.payout||0)-Number(a[rankBy]?.payout||0);
    if(primary) return primary;
    const secondary=Number(b[rankBy]?.weight||0)-Number(a[rankBy]?.weight||0);
    return secondary||String(a.customer.name).localeCompare(String(b.customer.name));
  });
}
function customerSalesPeriodLabel(month){
  const [year,value]=String(month||'').split('-').map(Number);
  return Number.isFinite(year)&&Number.isFinite(value)?new Date(Date.UTC(year,value-1,1)).toLocaleString('en-PH',{month:'long',year:'numeric'}):month;
}
function customerSalesCell(total){
  return `<strong>${fmtMoney(total.payout)}</strong><br><span class="form-note">${total.transactions} transaction${total.transactions===1?'':'s'} · ${fmtWeight(total.weight)}</span>`;
}
function setCustomerSalesMonth(value){ if(/^\d{4}-\d{2}$/.test(value)){customerSalesMonth=value;render();} }
function setCustomerSalesYear(value){ if(/^\d{4}$/.test(value)){customerSalesYear=value;render();} }
function setCustomerSalesRankBy(value){ customerSalesRankBy=value==='yearly'?'yearly':'monthly';render(); }
function toggleCustomerSalesLeaderboard(){ customerSalesLeaderboardMinimized=!customerSalesLeaderboardMinimized; render(); }
function renderCustomers(){
  const list = db.customers.filter(c=> (c.name+c.contact).toLowerCase().includes(custSearch.toLowerCase()));
  const leaderboard=customerSalesLeaderboard();
  const topSeller=leaderboard[0];
  return `
  <section class="block">
    <div class="batch-head"><div><h2 class="block-title">Customer sales leaderboard</h2><p class="form-note">Compare monthly and yearly purchases from each customer. The highest payout is ranked first.</p></div><button class="btn secondary small" type="button" onclick="toggleCustomerSalesLeaderboard()">${customerSalesLeaderboardMinimized?'Expand':'Minimize'}</button></div>
    ${customerSalesLeaderboardMinimized?'<div class="empty-note">Customer sales rankings are minimized.</div>':`
    <div class="filter-row">
      <div class="field"><label for="customer_sales_month">Month</label><input id="customer_sales_month" type="month" value="${esc(customerSalesMonth)}" onchange="setCustomerSalesMonth(this.value)"></div>
      <div class="field"><label for="customer_sales_year">Year</label><input id="customer_sales_year" type="number" min="2000" max="2100" value="${esc(customerSalesYear)}" onchange="setCustomerSalesYear(this.value)"></div>
      <div class="field"><label for="customer_sales_rank">Rank customers by</label><select id="customer_sales_rank" onchange="setCustomerSalesRankBy(this.value)"><option value="monthly" ${customerSalesRankBy==='monthly'?'selected':''}>Monthly payout</option><option value="yearly" ${customerSalesRankBy==='yearly'?'selected':''}>Yearly payout</option></select></div>
    </div>
    ${topSeller&&topSeller[customerSalesRankBy].payout>0?`<div class="summary-grand"><div><span>Top seller by ${customerSalesRankBy==='monthly'?customerSalesPeriodLabel(customerSalesMonth):customerSalesYear}</span><strong>${esc(topSeller.customer.name)}</strong></div><div>${fmtMoney(topSeller[customerSalesRankBy].payout)}</div></div>`:'<div class="empty-note">No customer purchases were recorded for the selected ranking period.</div>'}
    ${tableOrEmpty(leaderboard,(entry,index)=>`<tr><td class="num customer-sales-rank"><strong>${index+1}</strong></td><td><strong>${esc(entry.customer.name)}</strong><br><span class="form-note">${esc(entry.customer.contact||'No contact')}</span></td><td class="num">${customerSalesCell(entry.monthly)}</td><td class="num">${customerSalesCell(entry.yearly)}</td></tr>`,['Rank','Customer',`Monthly · ${customerSalesPeriodLabel(customerSalesMonth)}`,`Yearly · ${customerSalesYear}`],'No customers on file yet.')}
    `}
  </section>

  <section class="block">
    <h2 class="block-title">Add a customer</h2>
    <div class="form-grid">
      <div class="field"><label>Name</label><input id="c_name" placeholder="Full name"></div>
      <div class="field"><label>Contact</label><input id="c_contact" placeholder="Phone / address"></div>
      <div class="field span-2"><label>Notes</label><textarea id="c_notes" placeholder="Optional remarks"></textarea></div>
    </div>
    <div class="form-actions"><button class="btn" onclick="addCustomer()">Save customer</button></div>
  </section>

  <section class="block">
    <h2 class="block-title">Customers on file</h2>
    <div class="filter-row">
      <div class="field"><label>Search</label><input id="customer_search" value="${esc(custSearch)}" oninput="updateCustomerSearch(this.value)" placeholder="Search name or contact"></div>
    </div>
    <div id="customer_results">${renderCustomerTable(list)}</div>
  </section>
  `;
}
function renderCustomerTable(list){
  return tableOrEmpty(list, c=>{
      const history = customerStockHistory(c);
      const totalPayout = history.reduce((a,s)=>a+Number(s.payout??s.cost??0),0);
      return `<tr><td>${esc(c.name)}</td><td>${esc(c.contact||'—')}</td><td>${esc(c.notes||'—')}</td>
      <td class="num">${history.length} sale(s) · ${fmtMoney(totalPayout)}</td>
      <td><div class="form-actions"><button class="btn secondary small" onclick="toggleCustHist('${c.id}')">${custOpen===c.id?'Hide':'View'} history</button>${adminEditButton('Customer',c.id)}</div></td></tr>
      ${custOpen===c.id ? `<tr><td colspan="5"><div class="customer-hist">${history.length? history.map(s=>`${fmtDate(s.date)} — ${s.metal} ${esc(s.karat)} ${esc(s.itemType)}, ${fmtWeight(s.netWeight)}, ${fmtMoney(s.payout)} (${s.status})`).join('<br>') : 'No purchases from this customer yet.'}</div></td></tr>` : ''}`;
    }, ['Name','Contact','Notes','Selling history',''], custSearch?'No customers match your search.':'No customers yet.');
}
function updateCustomerSearch(value){
  custSearch=value;
  const list=db.customers.filter(c=>(c.name+c.contact).toLowerCase().includes(custSearch.toLowerCase()));
  const results=document.getElementById('customer_results');
  if(results) results.innerHTML=renderCustomerTable(list);
}
function toggleCustHist(id){ custOpen = (custOpen===id? null : id); render(); }
function addCustomer(){
  const name=val('c_name').trim(), contact=val('c_contact').trim(), notes=val('c_notes').trim();
  if(!name){ toast('Enter a customer name'); return; }
  db.customers.push({id:uid('cust'), name, contact, notes});
  saveDB(); render(); toast('Customer added');
}
let editingCustomerId=null;
function openCustomerEdit(id){
  const customer=db.customers.find(c=>c.id===id); if(!customer||!adminEditGuard()) return;
  editingCustomerId=id;
  openAdminEditModal('Edit customer',`<div class="form-grid">
    <div class="field"><label>Name</label><input id="edit_customer_name" value="${esc(customer.name)}"></div>
    <div class="field"><label>Contact</label><input id="edit_customer_contact" value="${esc(customer.contact||'')}"></div>
    <div class="field span-2"><label>Notes</label><textarea id="edit_customer_notes">${esc(customer.notes||'')}</textarea></div>
  </div>`,'saveCustomerEdit','deleteCustomerRecord');
}
async function saveCustomerEdit(){
  if(!adminEditGuard()) return;
  const customer=db.customers.find(c=>c.id===editingCustomerId),name=val('edit_customer_name').trim();
  if(!customer) return; if(!name){ toast('Customer name is required'); return; }
  customer.name=name; customer.contact=val('edit_customer_contact').trim(); customer.notes=val('edit_customer_notes').trim();
  db.stock.filter(s=>s.customerId===customer.id).forEach(s=>s.customerName=name);
  closeAdminEditModal(); await saveDB(); render(); toast('Customer updated');
}
async function deleteCustomerRecord(){
  if(!adminEditGuard()) return;
  const customer=db.customers.find(c=>c.id===editingCustomerId); if(!customer) return;
  const history=db.stock.filter(item=>item.customerId===customer.id);
  const historyNote=history.length
    ? `${history.length} existing purchase${history.length===1?'':'s'} will remain in transaction and inventory history under the saved customer name.`
    : 'This customer has no purchase history.';
  if(!await confirmDeletion('Delete customer?',`Permanently remove ${customer.name} from customer management. ${historyNote}`,[
    {label:'Customer',value:customer.name},{label:'Contact',value:customer.contact||'No contact information'},
    {label:'Purchase history retained',value:String(history.length)}
  ])) return;
  const previousLinks=history.map(item=>({item,customerId:item.customerId}));
  history.forEach(item=>{ item.customerName=item.customerName||customer.name; delete item.customerId; });
  db.customers=db.customers.filter(c=>c.id!==customer.id);
  closeAdminEditModal();
  if(await saveDB()){
    render(); toast(history.length?'Customer deleted; purchase history retained':'Customer deleted');
  }else{
    db.customers.push(customer);
    previousLinks.forEach(({item,customerId})=>{ item.customerId=customerId; });
    render();
  }
}

/* ============================= BUYING ============================= */
let purchaseBatch=[];
let buyingDraftForm={};
let buyingDraftSaveTimer=null;
let buyingDraftSavedDate='';
let buyingDraftLoaded=false;
let buyingDraftLoading=false;
let cashflowCardMinimized=false;
function toggleCashflowCard(){
  cashflowCardMinimized=!cashflowCardMinimized;
  const card=document.getElementById('buying_cashflow_card');
  if(card) card.innerHTML=cashflowCardMarkup();
}
function cashflowCardMarkup(){
  const cashflowDate=cashflowDateStr();
  const snapshot=currentCashflow?.date===cashflowDate?currentCashflow:null;
  const configured=Boolean(snapshot?.configured)&&snapshot?.cashOnHand!==null&&Number.isFinite(Number(snapshot?.cashOnHand));
  const balance=configured?fmtMoney(snapshot.cashOnHand):'Not set';
  const updated=snapshot?.setAt?new Date(snapshot.setAt).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'}):'';
  return `<section class="cashflow-card ${configured&&Number(snapshot.cashOnHand)<0?'is-negative':''} ${cashflowCardMinimized?'is-minimized':''}">
    <div class="cashflow-main">
      <div class="cashflow-balance"><div class="cashflow-title-row"><span class="cashflow-eyebrow">Cash on hand · ${fmtDate(cashflowDate)}</span><button class="cashflow-toggle" onclick="toggleCashflowCard()" aria-expanded="${!cashflowCardMinimized}">${cashflowCardMinimized?'Expand':'Minimize'}</button></div><strong>${balance}</strong>${cashflowCardMinimized?'':`<small>${configured?`Live balance after cash purchases for this cashflow day${updated?` · adjusted ${esc(updated)} by ${esc(snapshot.setBy||'Admin')}`:''}`:'Waiting for an administrator to set the available cash'}</small>`}</div>
      ${cashflowCardMinimized?'':`<div class="cashflow-actions"><button class="btn secondary" onclick="openCashflowDetails()">View cash flow</button>${isAdmin()?`${configured?'<button class="btn secondary" onclick="openCashflowResetConfirmation()">Reset IN / OUT</button>':''}<button class="btn cashflow-edit" onclick="openCashflowEditor()">${configured?'Edit cash on hand':'Set cash on hand'}</button>`:'<span class="cashflow-readonly">Admin controlled</span>'}</div>`}
    </div>
    <div class="cashflow-flow-strip"><strong>${new Date(cashflowDate+'T00:00:00').toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'2-digit'})}</strong><span class="cashflow-in">IN ${fmtMoney(snapshot?.cashIn||0)}</span><span class="cashflow-out">OUT ${fmtMoney(snapshot?.cashOut||0)}</span></div>
    ${cashflowCardMinimized?'':`<div class="cashflow-stats">
      <div><span>Bought today</span><strong>${fmtMoney(snapshot?.totalPurchases||0)}</strong><small>${snapshot?.purchaseCount||0} item${snapshot?.purchaseCount===1?'':'s'} · all payment methods</small></div>
      <div><span>Cash paid today</span><strong>${fmtMoney(snapshot?.cashPurchases||0)}</strong><small>Deducted from cash on hand</small></div>
      <div><span>Non-cash today</span><strong>${fmtMoney(snapshot?.nonCashPurchases||0)}</strong><small>Bank transfer and GCash</small></div>
    </div>`}
  </section>`;
}
async function syncCashflow(){
  if(cashflowSyncBusy||!currentUser||!(location.protocol==='http:'||location.protocol==='https:')) return;
  cashflowSyncBusy=true;
  try{
    const requestedDate=cashflowDateStr();
    const previousDate=currentCashflow?.date||'';
    const response=await fetch(`/api/cashflow?date=${encodeURIComponent(requestedDate)}`,{cache:'no-store'});
    if(response.status===401){ showLogin(); return; }
    const result=await response.json().catch(()=>null);
    if(!response.ok) throw new Error(result?.error||'Cashflow sync failed');
    if(!result||result.date!==requestedDate||(result.configured&&(result.cashOnHand===null||!Number.isFinite(Number(result.cashOnHand))))) throw new Error('Cashflow sync returned an invalid balance');
    currentCashflow=result;
    if(!cashflowHistoryDate||cashflowHistoryDate===previousDate||cashflowHistoryDate===requestedDate){
      cashflowHistoryDate=requestedDate; cashflowHistorySnapshot=result;
    }
    const card=document.getElementById('buying_cashflow_card');
    if(card) card.innerHTML=cashflowCardMarkup();
    renderCashflowDetailsContent();
    renderCashflowAdjustmentDetailsContent();
  }catch(error){ console.error('Cashflow sync failed',error); }
  finally{ cashflowSyncBusy=false; }
}
function closeCashflowEditor(){ document.getElementById('cashflow_editor_modal')?.remove(); }
function closeCashflowResetConfirmation(){ document.getElementById('cashflow_reset_modal')?.remove(); }
function closeCashflowDetails(){ document.getElementById('cashflow_details_modal')?.remove(); }
function cashflowDetailSnapshot(){ return cashflowHistorySnapshot||currentCashflow||{}; }
function cashflowTime(value){
  if(!value) return 'Time unavailable';
  return new Date(value).toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit'});
}
function cashflowPagination(kind,total,page){
  const pages=Math.max(1,Math.ceil(total/CASHFLOW_PAGE_SIZE));
  if(pages<=1) return '';
  return `<div class="cashflow-pagination"><span>Page ${page} of ${pages} · ${total} records</span><div><button class="btn secondary small" onclick="changeCashflowPage('${kind}',-1)" ${page<=1?'disabled':''}>Previous</button><button class="btn secondary small" onclick="changeCashflowPage('${kind}',1)" ${page>=pages?'disabled':''}>Next</button></div></div>`;
}
function changeCashflowPage(kind,direction){
  const total=kind==='purchases'?filteredCashflowTransactions().length:filteredCashflowAdjustments().length;
  const pages=Math.max(1,Math.ceil(total/CASHFLOW_PAGE_SIZE));
  if(kind==='purchases') cashflowPurchasePage=Math.min(Math.max(cashflowPurchasePage+direction,1),pages);
  else cashflowAdjustmentPage=Math.min(Math.max(cashflowAdjustmentPage+direction,1),pages);
  if(kind==='purchases') renderCashflowDetailsContent(); else renderCashflowAdjustmentDetailsContent();
}
function cashflowMatches(values){
  const query=cashflowSearch.trim().toLowerCase();
  return !query||values.filter(value=>value!=null).join(' ').toLowerCase().includes(query);
}
function filteredCashflowTransactions(){
  return (cashflowDetailSnapshot().transactions||[]).filter(transaction=>cashflowMatches([
    cashflowTime(transaction.recordedAt),transaction.customerName,transaction.paymentMethod,transaction.payout,
    fmtMoney(transaction.payout),transaction.itemCount,...(transaction.items||[]),
    String(transaction.paymentMethod).toLowerCase()==='cash'?'cash deduction':'no cash effect'
  ]));
}
function filteredCashflowAdjustments(){
  const labels={set:'Set balance',add:'Cash added',deduct:'Cash deducted',reset:'IN / OUT reset'};
  const query=cashflowAdjustmentSearch.trim().toLowerCase();
  return (cashflowDetailSnapshot().adjustments||[]).filter(adjustment=>!query||[
    cashflowTime(adjustment.createdAt),labels[adjustment.operation],adjustment.operation,adjustment.note,
    adjustment.createdBy,adjustment.amount,fmtMoney(adjustment.amount),adjustment.balanceAfter,fmtMoney(adjustment.balanceAfter)
  ].filter(value=>value!=null).join(' ').toLowerCase().includes(query));
}
function updateCashflowSearch(value){
  cashflowSearch=String(value||''); cashflowPurchasePage=1; cashflowAdjustmentPage=1; renderCashflowDetailsContent();
  requestAnimationFrame(()=>{ const input=document.getElementById('cashflow_search'); if(input){ input.focus(); input.setSelectionRange?.(input.value.length,input.value.length); } });
}
function updateCashflowAdjustmentSearch(value){
  cashflowAdjustmentSearch=String(value||''); cashflowAdjustmentPage=1; renderCashflowAdjustmentDetailsContent();
  requestAnimationFrame(()=>{ const input=document.getElementById('cashflow_adjustment_search'); if(input){ input.focus(); input.setSelectionRange?.(input.value.length,input.value.length); } });
}
function cashflowDetailRows(){
  const snapshot=cashflowDetailSnapshot();
  const transactions=filteredCashflowTransactions();
  if(!transactions.length) return `<div class="empty-note">${cashflowSearch?'No buying transactions match your search.':`No buying transactions recorded on ${fmtDate(cashflowHistoryDate||cashflowDateStr())}.`}</div>`;
  const matchingIds=new Set(transactions.map(transaction=>transaction.id));
  let running=Number(snapshot.cashOnHand);
  const setAt=Date.parse(snapshot.setAt||'');
  const prepared=snapshot.transactions.map(transaction=>{
    const isCash=String(transaction.paymentMethod).toLowerCase()==='cash';
    const recordedAt=Date.parse(transaction.recordedAt||'');
    const afterLatestSet=isCash&&snapshot.configured&&Number.isFinite(recordedAt)&&Number.isFinite(setAt)&&recordedAt>setAt;
    const balanceAfter=afterLatestSet?running:null;
    if(afterLatestSet) running=roundMoney(running+Number(transaction.payout));
    return {transaction,isCash,afterLatestSet,balanceAfter};
  }).filter(entry=>matchingIds.has(entry.transaction.id));
  const pages=Math.max(1,Math.ceil(prepared.length/CASHFLOW_PAGE_SIZE));
  cashflowPurchasePage=Math.min(Math.max(cashflowPurchasePage,1),pages);
  const start=(cashflowPurchasePage-1)*CASHFLOW_PAGE_SIZE;
  const rows=prepared.slice(start,start+CASHFLOW_PAGE_SIZE).map(({transaction,isCash,afterLatestSet,balanceAfter})=>`<tr><td>${esc(cashflowTime(transaction.recordedAt))}</td><td><strong>${esc(transaction.customerName)}</strong><br><span class="hint">${esc(transaction.items.join(' · '))} · ${transaction.itemCount} item${transaction.itemCount===1?'':'s'}</span></td><td>${esc(transaction.paymentMethod)}</td><td class="num">${fmtMoney(transaction.payout)}</td><td class="num ${isCash?'cashflow-out':'cashflow-no-effect'}">${isCash?`−${fmtMoney(transaction.payout)}`:'No cash effect'}</td><td class="num">${afterLatestSet?fmtMoney(balanceAfter):(isCash&&snapshot.configured?'Included in latest set':'—')}</td></tr>`).join('');
  return `<div class="table-wrap cashflow-ledger"><table><thead><tr><th>Time</th><th>Buying transaction</th><th>Payment</th><th class="num-head">Purchased</th><th class="num-head">Cash movement</th><th class="num-head">Cash remaining</th></tr></thead><tbody>${rows}</tbody></table></div>${cashflowPagination('purchases',prepared.length,cashflowPurchasePage)}`;
}
function cashflowAdjustmentRows(){
  const adjustments=filteredCashflowAdjustments();
  if(!adjustments.length) return `<div class="empty-note">${cashflowAdjustmentSearch?'No Admin cash adjustments match your search.':`No cash adjustments recorded on ${fmtDate(cashflowHistoryDate||cashflowDateStr())}.`}</div>`;
  const labels={set:'Set balance',add:'Cash added',deduct:'Cash deducted',reset:'IN / OUT reset'};
  const pages=Math.max(1,Math.ceil(adjustments.length/CASHFLOW_PAGE_SIZE));
  cashflowAdjustmentPage=Math.min(Math.max(cashflowAdjustmentPage,1),pages);
  const start=(cashflowAdjustmentPage-1)*CASHFLOW_PAGE_SIZE;
  const rows=adjustments.slice(start,start+CASHFLOW_PAGE_SIZE).map(adjustment=>`<tr><td>${esc(cashflowTime(adjustment.createdAt))}</td><td><span class="pill ${adjustment.operation==='deduct'?'cashflow-deduct-pill':adjustment.operation==='add'?'cashflow-add-pill':''}">${esc(labels[adjustment.operation]||adjustment.operation)}</span></td><td>${esc(adjustment.note||'—')}</td><td>${esc(adjustment.createdBy||'Admin')}</td><td class="num ${adjustment.operation==='deduct'?'cashflow-out':adjustment.operation==='add'?'cashflow-in':''}">${adjustment.operation==='add'?'+':adjustment.operation==='deduct'?'−':''}${fmtMoney(adjustment.amount)}</td><td class="num">${fmtMoney(adjustment.balanceAfter)}</td></tr>`).join('');
  return `<div class="table-wrap cashflow-adjustment-ledger"><table><thead><tr><th>Time</th><th>Action</th><th>Notes</th><th>Admin</th><th class="num-head">Amount</th><th class="num-head">Balance after</th></tr></thead><tbody>${rows}</tbody></table></div>${cashflowPagination('adjustments',adjustments.length,cashflowAdjustmentPage)}`;
}
function renderCashflowDetailsContent(){
  const container=document.getElementById('cashflow_details_content');
  if(!container) return;
  const snapshot=cashflowDetailSnapshot(),viewDate=cashflowHistoryDate||cashflowDateStr(),currentDate=cashflowDateStr();
  const title=document.getElementById('cashflow_details_title'); if(title) title.textContent=`Cash movement · ${fmtDate(viewDate)}`;
  const adjustmentTitle=document.getElementById('cashflow_adjustment_details_title'); if(adjustmentTitle) adjustmentTitle.textContent=`Admin cash adjustments · ${fmtDate(viewDate)}`;
  container.innerHTML=`<div class="cashflow-history-picker"><button class="btn secondary small" onclick="changeCashflowHistoryDay(-1)">Previous day</button><div class="field"><label for="cashflow_history_date">Retrieve cashflow date</label><input id="cashflow_history_date" type="date" max="${currentDate}" value="${esc(viewDate)}" onchange="changeCashflowHistoryDate(this.value)"></div><button class="btn secondary small" onclick="changeCashflowHistoryDay(1)" ${viewDate>=currentDate?'disabled':''}>Next day</button></div>
  ${cashflowHistoryLoading?'<div class="empty-note">Loading saved cashflow…</div>':`<div class="stat-row cashflow-modal-stats">
    <div class="stat"><div class="label">Cash on hand</div><div class="value">${snapshot.configured?fmtMoney(snapshot.cashOnHand):'Not set'}</div></div>
    <div class="stat"><div class="label">Bought on this date</div><div class="value">${fmtMoney(snapshot.totalPurchases||0)}</div><div class="sub">${snapshot.purchaseCount||0} item${snapshot.purchaseCount===1?'':'s'}</div></div>
    <div class="stat"><div class="label">Cash paid</div><div class="value">${fmtMoney(snapshot.cashPurchases||0)}</div></div>
    <div class="stat"><div class="label">Non-cash</div><div class="value">${fmtMoney(snapshot.nonCashPurchases||0)}</div></div>
  </div>
  <div class="cashflow-modal-flow"><span>Daily physical cash movement</span><div><strong class="cashflow-in">IN ${fmtMoney(snapshot.cashIn||0)}</strong><strong class="cashflow-out">OUT ${fmtMoney(snapshot.cashOut||0)}</strong></div><small>IN is Admin-added cash. OUT is Cash buying payouts plus manual deductions.</small></div>
  ${snapshot.configured?`<div class="cashflow-set-note"><strong>Cash-on-hand formula:</strong> ${fmtMoney(snapshot.balanceBase)} latest balance − ${fmtMoney(snapshot.cashPurchasesAfterSetting||0)} Cash purchases after ${esc(cashflowTime(snapshot.setAt))} = ${fmtMoney(snapshot.cashOnHand)}. Purchases marked “Included in latest set” are not deducted again.</div>`:'<div class="cashflow-set-note"><strong>Cash on hand is not set.</strong> An administrator must enter the current physical cash before a running balance can be shown.</div>'}
  <div class="cashflow-search"><div class="field"><label for="cashflow_search">Search buying transactions</label><input id="cashflow_search" type="search" autocomplete="off" value="${esc(cashflowSearch)}" placeholder="Seller, item, payment, amount, or time" oninput="updateCashflowSearch(this.value)"></div>${cashflowSearch?'<button class="btn secondary small" onclick="updateCashflowSearch(\'\')">Clear</button>':''}</div>
  <h3 class="cashflow-ledger-title">Buying transactions</h3>${cashflowDetailRows()}
  <div class="cashflow-adjustment-launch"><div><strong>Admin cash adjustments</strong><span>Review cash added, deducted, or reconciled separately.</span></div><button class="btn secondary" onclick="openCashflowAdjustmentDetails()">View adjustments <span class="badge-count">${snapshot.adjustments?.length||0}</span></button></div>`}`;
}
async function changeCashflowHistoryDate(date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>cashflowDateStr()){toast('Choose the current cashflow day or an earlier date');return;}
  const previousDate=cashflowHistoryDate,previousSnapshot=cashflowHistorySnapshot;
  cashflowHistoryDate=date; cashflowPurchasePage=1; cashflowAdjustmentPage=1; cashflowSearch=''; cashflowAdjustmentSearch=''; cashflowHistoryLoading=true; renderCashflowDetailsContent();
  try{
    const response=await fetch(`/api/cashflow?date=${encodeURIComponent(date)}`,{cache:'no-store'});
    if(response.status===401){showLogin();return;}
    const result=await response.json().catch(()=>null);
    if(!response.ok) throw new Error(result?.error||'Could not retrieve cashflow');
    if(!result||result.date!==date) throw new Error('Cashflow history returned an invalid date');
    cashflowHistorySnapshot=result;
  }catch(error){cashflowHistoryDate=previousDate;cashflowHistorySnapshot=previousSnapshot;toast(error.message||'Could not retrieve cashflow');}
  finally{cashflowHistoryLoading=false;renderCashflowDetailsContent();renderCashflowAdjustmentDetailsContent();}
}
function changeCashflowHistoryDay(offset){
  const current=cashflowHistoryDate||cashflowDateStr(),next=dateKeyPlusDays(current,offset);
  if(next<=cashflowDateStr()) changeCashflowHistoryDate(next);
}
async function openCashflowDetails(){
  closeCashflowDetails();
  const cashflowDate=cashflowDateStr();
  cashflowPurchasePage=1; cashflowAdjustmentPage=1; cashflowSearch=''; cashflowAdjustmentSearch=''; cashflowHistoryDate=cashflowDate; cashflowHistorySnapshot=currentCashflow;
  const modal=document.createElement('div'); modal.id='cashflow_details_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="inventory-move-modal" role="dialog" aria-modal="true" aria-labelledby="cashflow_details_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Buying cashflow history</div><h2 id="cashflow_details_title">Cash movement · ${fmtDate(cashflowDate)}</h2><p class="form-note">Daily totals start a new day at 4:00 AM Manila time. Earlier cashflow days remain available here.</p></div><button class="modal-close" onclick="closeCashflowDetails()" aria-label="Close">×</button></div>
    <div id="cashflow_details_content"></div>
    <div class="form-actions" style="justify-content:flex-end;"><button class="btn secondary" onclick="changeCashflowHistoryDate(cashflowHistoryDate||cashflowDateStr())">Refresh</button><button class="btn" onclick="closeCashflowDetails()">Close</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeCashflowDetails();});
  document.body.appendChild(modal); renderCashflowDetailsContent(); await changeCashflowHistoryDate(cashflowDate);
}
function closeCashflowAdjustmentDetails(){ document.getElementById('cashflow_adjustment_details_modal')?.remove(); }
function renderCashflowAdjustmentDetailsContent(){
  const container=document.getElementById('cashflow_adjustment_details_content'); if(!container) return;
  container.innerHTML=`<div class="cashflow-search"><div class="field"><label for="cashflow_adjustment_search">Search adjustments</label><input id="cashflow_adjustment_search" type="search" autocomplete="off" value="${esc(cashflowAdjustmentSearch)}" placeholder="Action, amount, note, Admin, balance, or time" oninput="updateCashflowAdjustmentSearch(this.value)"></div>${cashflowAdjustmentSearch?'<button class="btn secondary small" onclick="updateCashflowAdjustmentSearch(\'\')">Clear</button>':''}</div>${cashflowAdjustmentRows()}`;
}
function openCashflowAdjustmentDetails(){
  closeCashflowAdjustmentDetails(); cashflowAdjustmentPage=1; cashflowAdjustmentSearch='';
  const modal=document.createElement('div'); modal.id='cashflow_adjustment_details_modal'; modal.className='modal-backdrop cashflow-adjustment-backdrop';
  modal.innerHTML=`<div class="inventory-move-modal cashflow-adjustment-modal" role="dialog" aria-modal="true" aria-labelledby="cashflow_adjustment_details_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Cashflow history</div><h2 id="cashflow_adjustment_details_title">Admin cash adjustments · ${fmtDate(cashflowHistoryDate||cashflowDateStr())}</h2><p class="form-note">Cash added is green, cash deducted is red, and exact balance reconciliation is neutral.</p></div><button class="modal-close" onclick="closeCashflowAdjustmentDetails()" aria-label="Close">×</button></div>
    <div id="cashflow_adjustment_details_content"></div>
    <div class="form-actions" style="justify-content:flex-end;"><button class="btn secondary" onclick="changeCashflowHistoryDate(cashflowHistoryDate||cashflowDateStr())">Refresh</button><button class="btn" onclick="closeCashflowAdjustmentDetails()">Close</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeCashflowAdjustmentDetails();});
  document.body.appendChild(modal); renderCashflowAdjustmentDetailsContent();
}
function openCashflowEditor(){
  if(!isAdmin()) return;
  closeCashflowEditor();
  const current=currentCashflow?.configured?Number(currentCashflow.cashOnHand):NaN;
  const modal=document.createElement('div'); modal.id='cashflow_editor_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<form class="summary-modal" onsubmit="saveCashflowOverride(event)" role="dialog" aria-modal="true" aria-labelledby="cashflow_editor_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Admin cash control</div><h2 id="cashflow_editor_title">Edit cash on hand</h2></div><button type="button" class="modal-close" onclick="closeCashflowEditor()" aria-label="Close">×</button></div>
    <p class="form-note" style="margin:16px 0;">Set the exact physical balance, add incoming cash, or record a cash deduction. Buying transactions paid by Cash continue to deduct automatically.</p>
    <div class="form-grid">
      <div class="field"><label>Action</label><select id="cashflow_operation" onchange="updateCashflowEditorFields()"><option value="set">Set exact balance</option>${currentCashflow?.configured?'<option value="add">Add cash</option><option value="deduct">Deduct cash</option>':''}</select></div>
      <div class="field"><label id="cashflow_amount_label">Current cash on hand (PHP)</label><input id="cashflow_amount" type="number" min="0" step="0.01" value="${Number.isFinite(current)?current:''}" placeholder="0" required><span class="hint" id="cashflow_action_hint">Replace the current balance with this exact amount.</span></div>
      <div class="field span-2"><label>Notes <span class="hint">(optional)</span></label><textarea id="cashflow_note" maxlength="500" placeholder="Example: Added cash from business reserve, petty cash expense, bank withdrawal"></textarea><span class="hint">The note, amount, time, and Admin name will appear in cashflow history.</span></div>
    </div>
    <div class="cashflow-current-line">Current cash on hand: <strong>${currentCashflow?.configured?fmtMoney(currentCashflow.cashOnHand):'Not set'}</strong></div>
    <div class="form-actions"><button type="button" class="btn secondary" onclick="closeCashflowEditor()">Cancel</button><button type="submit" class="btn">Save cash adjustment</button></div>
  </form>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeCashflowEditor();});
  document.body.appendChild(modal); document.getElementById('cashflow_amount')?.focus();
}
function openCashflowResetConfirmation(){
  if(!isAdmin()||!currentCashflow?.configured) return;
  closeCashflowResetConfirmation();
  const modal=document.createElement('div'); modal.id='cashflow_reset_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="summary-modal" role="dialog" aria-modal="true" aria-labelledby="cashflow_reset_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Admin cash control</div><h2 id="cashflow_reset_title">Reset IN and OUT to PHP 0</h2></div><button type="button" class="modal-close" onclick="closeCashflowResetConfirmation()" aria-label="Close">×</button></div>
    <p class="form-note" style="margin:16px 0;">This starts new IN and OUT counters from this moment. It does not delete buying transactions, adjustment history, or inventory, and it does not change Cash on Hand.</p>
    <div class="move-confirmation-summary"><div><span>Cash on hand</span><strong>${fmtMoney(currentCashflow.cashOnHand)}</strong></div><div><span>Current IN</span><strong class="cashflow-in">${fmtMoney(currentCashflow.cashIn||0)}</strong></div><div><span>Current OUT</span><strong class="cashflow-out">${fmtMoney(currentCashflow.cashOut||0)}</strong></div></div>
    <div class="form-actions"><button type="button" class="btn secondary" onclick="closeCashflowResetConfirmation()">Cancel</button><button type="button" class="btn" onclick="resetCashflowMovements()">Confirm reset</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeCashflowResetConfirmation();}); document.body.appendChild(modal);
}
async function resetCashflowMovements(){
  if(!isAdmin()) return;
  try{
    const cashflowDate=cashflowDateStr();
    const response=await fetch('/api/cashflow',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:cashflowDate,operation:'reset',amount:0,note:'IN and OUT counters reset'})});
    const result=await response.json().catch(()=>null);
    if(!response.ok) throw new Error(result?.error||'Could not reset IN and OUT');
    currentCashflow=result; closeCashflowResetConfirmation();
    if(!cashflowHistoryDate||cashflowHistoryDate===cashflowDate){cashflowHistoryDate=cashflowDate;cashflowHistorySnapshot=result;renderCashflowDetailsContent();renderCashflowAdjustmentDetailsContent();}
    const card=document.getElementById('buying_cashflow_card'); if(card) card.innerHTML=cashflowCardMarkup();
    toast('IN and OUT reset to PHP 0');
  }catch(error){ toast(error.message||'Could not reset IN and OUT'); }
}
function updateCashflowEditorFields(){
  const operation=val('cashflow_operation'),label=document.getElementById('cashflow_amount_label'),hint=document.getElementById('cashflow_action_hint'),input=document.getElementById('cashflow_amount');
  const copy={set:['Exact cash balance (PHP)','Replace the current balance with this exact amount.'],add:['Cash to add (PHP)','Increase cash on hand by this amount.'],deduct:['Cash to deduct (PHP)','Decrease cash on hand by this amount.']};
  if(label) label.textContent=copy[operation][0]; if(hint) hint.textContent=copy[operation][1];
  if(input){ input.value=operation==='set'&&currentCashflow?.configured?String(currentCashflow.cashOnHand):''; input.focus(); }
}
async function saveCashflowOverride(event){
  event.preventDefault(); if(!isAdmin()) return;
  const operation=val('cashflow_operation'),amount=Number(val('cashflow_amount')),note=val('cashflow_note').trim();
  if(!Number.isFinite(amount)||amount<0){ toast('Enter a valid non-negative cash amount'); return; }
  try{
    const cashflowDate=cashflowDateStr();
    const response=await fetch('/api/cashflow',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:cashflowDate,operation,amount,note})});
    const result=await response.json().catch(()=>null);
    if(!response.ok) throw new Error(result?.error||'Could not save cash on hand');
    currentCashflow=result; closeCashflowEditor();
    if(!cashflowHistoryDate||cashflowHistoryDate===cashflowDate){cashflowHistoryDate=cashflowDate;cashflowHistorySnapshot=result;renderCashflowDetailsContent();renderCashflowAdjustmentDetailsContent();}
    const card=document.getElementById('buying_cashflow_card'); if(card) card.innerHTML=cashflowCardMarkup();
    toast(operation==='add'?'Cash added':operation==='deduct'?'Cash deducted':'Cash on hand updated');
  }catch(error){ toast(error.message||'Could not save cash on hand'); }
}
function buyingDraftValue(key,fallback=''){
  const element=document.getElementById(key);
  return element?element.value:String(buyingDraftForm[key]??fallback);
}
function captureBuyingDraftForm(){
  ['b_seller_name','b_date','b_pay','b_metal','b_itemtype','b_karat','b_custom_purity','b_gross','b_ded','b_rate','b_payout','b_staff','b_status','b_remarks'].forEach(key=>{
    const element=document.getElementById(key); if(element) buyingDraftForm[key]=element.type==='checkbox'?(element.checked?'true':'false'):element.value;
  });
}
async function loadBuyingDraft(){
  if(buyingDraftLoaded||buyingDraftLoading)return;
  buyingDraftLoading=true;
  try{
    const response=await fetch('/api/buying-draft',{cache:'no-store'});
    if(!response.ok) return;
    const draft=await response.json();
    purchaseBatch=Array.isArray(draft.items)?draft.items:[];
    buyingDraftForm=draft.form&&typeof draft.form==='object'?draft.form:{};
    buyingDraftSavedDate=String(draft.savedDate||buyingDraftForm.b_date||'');
    rollDefaultBuyingDraftDateForward();
    buyingDraftLoaded=true;
  }catch(error){ console.error('Buying draft load failed',error); }
  finally{buyingDraftLoading=false;}
  if(currentTab==='buying') render();
}
function rollDefaultBuyingDraftDateForward(){
  const today=todayStr(),draftDate=String(buyingDraftForm.b_date||'');
  if(!draftDate||draftDate!==buyingDraftSavedDate||draftDate===today) return false;
  buyingDraftForm.b_date=today;
  buyingDraftSavedDate=today;
  return true;
}
async function saveBuyingDraft(){
  captureBuyingDraftForm();
  try{
    const response=await fetch('/api/buying-draft',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:purchaseBatch,form:buyingDraftForm})});
    if(!response.ok) throw new Error('Draft save failed');
    const result=await response.json().catch(()=>null);
    buyingDraftSavedDate=String(result?.savedDate||todayStr());
  }catch(error){ console.error('Buying draft save failed',error); toast('Could not save the current payout draft'); }
}
function scheduleBuyingDraftSave(){
  captureBuyingDraftForm(); clearTimeout(buyingDraftSaveTimer);
  buyingDraftSaveTimer=setTimeout(()=>saveBuyingDraft(),450);
}
async function clearBuyingDraft(){
  clearTimeout(buyingDraftSaveTimer); buyingDraftForm={}; buyingDraftSavedDate='';buyingDraftLoaded=true;
  const defaults={b_seller_name:'',b_date:'',b_pay:'Cash',b_metal:'Gold',b_itemtype:'Scrap',b_karat:'',b_custom_purity:'',b_gross:'',b_ded:'',b_rate:'',b_payout:'',b_staff:'',b_status:'Available',b_remarks:''};
  Object.entries(defaults).forEach(([id,value])=>{const input=document.getElementById(id);if(!input)return;if(input.type==='checkbox')input.checked=value==='true';else input.value=value;});
  try{ await fetch('/api/buying-draft',{method:'DELETE'}); }catch(error){ console.error('Buying draft clear failed',error); }
}
function renderBuying(){
  rollDefaultBuyingDraftDateForward();
  const sellerName=buyingDraftValue('b_seller_name');
  const savedCustomer=db.customers.find(customer=>String(customer.name).trim().toLowerCase()===sellerName.trim().toLowerCase());
  const customerStatus=!sellerName?'Leave blank for a walk-in seller.':savedCustomer?`Using saved customer: ${savedCustomer.name}`:`No exact match — “${sellerName}” will be saved as a new customer.`;
  const metal = buyingDraftValue('b_metal','Gold') || 'Gold';
  const karats = distinctKarats(metal);
  const requestedKarat=buyingDraftValue('b_karat');
  const customPurityValue=buyingDraftValue('b_custom_purity');
  const customSelected=requestedKarat==='__custom__';
  const karatSelection = customSelected?'__custom__':(karats.includes(requestedKarat)?requestedKarat:karats[0]) || '';
  const karat = customSelected?customPurityGradeKey(customPurityValue):karatSelection;
  const rateObj = karat ? activeRate(metal, karat) : null;
  const grossValue=buyingDraftValue('b_gross'),deductionValue=buyingDraftValue('b_ded');
  const gross = parseFloat(grossValue)||0, ded = parseFloat(deductionValue)||0;
  const net = Math.max(roundWeight(gross-ded),0);
  const systemRate = rateObj ? roundPeso(rateObj.rate) : 0;
  const enteredRate = buyingDraftValue('b_rate');
  const parsedRate = Number(enteredRate);
  const rateOverrideAllowed=canOverrideBuyingRate();
  const savedRateOverride=rateOverrideAllowed&&buyingDraftForm.b_rate_overridden==='true';
  const rate = savedRateOverride&&enteredRate!==''&&Number.isFinite(parsedRate) ? roundPeso(parsedRate) : systemRate;
  const rateOverridden = Boolean(rateObj&&savedRateOverride&&rate!==systemRate);
  const suggested = roundPeso(net*rate);

  return `
  <div id="buying_cashflow_card">${cashflowCardMarkup()}</div>
  <section class="block buying-workflow">
    <div class="buying-step" id="buying_customer_step">
      <div class="step-number">1</div>
      <div class="step-content">
        <h2>Customer Information</h2>
        <p>Start typing a name. Matching saved customers will appear automatically.</p>
        <div class="form-grid buying-customer-grid">
          <div class="field customer-combobox"><label for="b_seller_name">Customer name <span class="hint">(optional)</span></label><input id="b_seller_name" value="${esc(sellerName)}" placeholder="Type a customer name" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="b_customer_suggestions" aria-expanded="false" oninput="updateBuyingCustomerSuggestions(this.value);scheduleBuyingDraftSave()" onfocus="updateBuyingCustomerSuggestions(this.value)" onblur="closeBuyingCustomerSuggestionsSoon()"><div id="b_customer_suggestions" class="customer-suggestions is-hidden" role="listbox"></div><span id="b_customer_match_status" class="customer-match-status ${savedCustomer?'is-existing':sellerName?'is-new':''}">${esc(customerStatus)}</span></div>
          <div class="field"><label>Purchase date</label><input id="b_date" type="date" value="${esc(buyingDraftValue('b_date',todayStr())||todayStr())}" onchange="scheduleBuyingDraftSave()"></div>
          <div class="field"><label>Payment method</label><select id="b_pay" onchange="scheduleBuyingDraftSave()">${['Cash','Bank transfer','GCash'].map(method=>`<option ${buyingDraftValue('b_pay','Cash')===method?'selected':''}>${method}</option>`).join('')}</select></div>
        </div>
      </div>
    </div>

    <div class="buying-step buying-item-step">
      <div class="step-number">2</div>
      <div class="step-content">
        <h2>Add an item</h2>
        <p>Choose the grade and enter its weight. The amount calculates automatically.</p>
        <div class="form-grid buying-item-grid">
      <div class="field"><label>Metal</label>
        <select id="b_metal" onchange="updateBuyingGrades();scheduleBuyingDraftSave()">
          <option value="Gold" ${metal==='Gold'?'selected':''}>Gold</option>
          <option value="Silver" ${metal==='Silver'?'selected':''}>Silver</option>
          <option value="Platinum" ${metal==='Platinum'?'selected':''}>Platinum</option>
        </select>
      </div>
      <div class="field"><label>Item type</label>
        <select id="b_itemtype" onchange="scheduleBuyingDraftSave()">${['Scrap','Jewelry'].map(type=>`<option ${buyingDraftValue('b_itemtype','Scrap')===type?'selected':''}>${type}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Karat / purity</label>
        <select id="b_karat" onchange="handleBuyingGradeChange();scheduleBuyingDraftSave()">
          ${karats.length? karats.map(k=>`<option value="${k}" ${k===karatSelection?'selected':''}>${esc(gradeLabel(metal,k))}</option>`).join('') : `<option value="">No rate set</option>`}
          <option value="__custom__" ${customSelected?'selected':''}>Custom purity (%)</option>
        </select>
        <div id="b_custom_purity_field" class="custom-purity-field ${customSelected?'':'is-hidden'}">
          <label for="b_custom_purity">Custom ${esc(metal)} purity (%)</label>
          <div class="custom-purity-input"><input id="b_custom_purity" type="number" min="0.01" max="100" step="0.01" value="${esc(customPurityValue)}" placeholder="Example: 89" oninput="resetBuyingRate();scheduleBuyingDraftSave()"><span>%</span></div>
          <span class="hint">Example: 89% uses 0.89 × today's ${esc(metal)} base rate.</span>
        </div>
        ${!karats.length? `<span class="hint">Add a buying rate for ${metal} first.</span>`:''}
      </div>
      <div class="field"><label>Gross weight (g)</label><input id="b_gross" type="number" min="0" step="0.01" value="${esc(grossValue)}" oninput="recalcBuying();scheduleBuyingDraftSave()"></div>
      <div class="field"><label>Deductions (g)</label><input id="b_ded" type="number" min="0" step="0.01" value="${esc(deductionValue)}" oninput="recalcBuying();scheduleBuyingDraftSave()"></div>
        </div>

        <div class="payout-calculator">
          <div><span>Net weight</span><strong id="b_net_display">${fmtWeight(net)}</strong></div>
          <div class="buying-rate ${rateOverridden?'is-overridden':''}" id="b_rate_panel"><label id="b_rate_label" for="b_rate">${rateOverridden?'Buying rate override (this item only)':rateOverrideAllowed?'Buying rate (uses Daily Rate Setup)':'Buying rate (Daily Rate Setup · locked)'}</label><div><span>₱</span><input id="b_rate" type="number" min="1" step="1" value="${rateObj?rate:''}" placeholder="0" ${rateOverrideAllowed?'onfocus="selectBuyingOverrideValue(this)" oninput="markBuyingRateOverride();recalcBuying();scheduleBuyingDraftSave()"':'readonly aria-readonly="true"'}><span>/g</span></div>${rateOverrideAllowed?`<span id="b_daily_rate_reference" class="daily-rate-reference ${rateOverridden?'':'is-hidden'}">Daily rate: ${fmtMoney(systemRate)}/g</span><button type="button" id="b_rate_reset" class="rate-reset ${rateOverridden?'':'is-hidden'}" onclick="resetBuyingRate();scheduleBuyingDraftSave()">Use daily rate</button>`:'<span class="form-note">Rate override is locked by administrator</span>'}</div>
          <div class="suggested"><span>Calculated amount</span><strong id="b_suggested_display">${fmtMoney(suggested)}</strong></div>
          <div class="final-payout"><label for="b_payout">Final payout</label><div><span>₱</span><input id="b_payout" type="number" min="0" step="1" value="${esc(buyingDraftValue('b_payout'))}" placeholder="${suggested}" onfocus="selectBuyingOverrideValue(this)" oninput="scheduleBuyingDraftSave()"></div></div>
        </div>

        <details class="buying-more">
          <summary>More details <span>optional</span></summary>
          <div class="form-grid buying-more-grid">
            <div class="field"><label>Staff member</label><input id="b_staff" value="${esc(buyingDraftValue('b_staff'))}" placeholder="Name" oninput="scheduleBuyingDraftSave()"></div>
            <div class="field"><label>Initial status</label><select id="b_status" onchange="scheduleBuyingDraftSave()">${['Available','For Refining','On Hold'].map(status=>`<option ${buyingDraftValue('b_status','Available')===status?'selected':''}>${status}</option>`).join('')}</select></div>
            <div class="field"><label>Remarks</label><textarea id="b_remarks" placeholder="Optional notes" oninput="scheduleBuyingDraftSave()">${esc(buyingDraftValue('b_remarks'))}</textarea></div>
          </div>
        </details>

        <div class="form-actions buying-add-action">
          <button class="btn" onclick="addPurchaseItem()">Add this item</button>
          <span class="form-note">You can add more items before paying.</span>
        </div>
      </div>
    </div>

  </section>

  <section class="block" id="purchase_batch_panel">${renderPurchaseBatchPanelMarkup()}</section>

  `;
}
function matchingBuyingCustomers(query){
  const normalized=String(query||'').trim().toLowerCase();
  if(!normalized) return [];
  return db.customers.filter(customer=>String(customer.name||'').toLowerCase().includes(normalized)).sort((a,b)=>String(a.name).localeCompare(String(b.name))).slice(0,6);
}
function updateBuyingCustomerSuggestions(value){
  const query=String(value||'').trim(),matches=matchingBuyingCustomers(query),suggestions=document.getElementById('b_customer_suggestions'),input=document.getElementById('b_seller_name'),status=document.getElementById('b_customer_match_status');
  const exact=db.customers.find(customer=>String(customer.name).trim().toLowerCase()===query.toLowerCase());
  if(status){
    status.textContent=!query?'Leave blank for a walk-in seller.':exact?`Using saved customer: ${exact.name}`:`No exact match — “${query}” will be saved as a new customer.`;
    status.className=`customer-match-status ${exact?'is-existing':query?'is-new':''}`;
  }
  if(!suggestions||!input) return;
  suggestions.innerHTML=query&&matches.length?matches.map(customer=>`<button type="button" role="option" onclick="selectBuyingCustomer('${esc(customer.id)}')"><strong>${esc(customer.name)}</strong><span>Saved customer</span></button>`).join(''):query?'<div class="customer-no-match">No saved customer matches. Continue typing to create a new customer.</div>':'';
  const visible=Boolean(query);
  suggestions.classList.toggle('is-hidden',!visible);
  input.setAttribute('aria-expanded',String(visible));
}
function selectBuyingCustomer(customerId){
  const customer=db.customers.find(item=>item.id===customerId),input=document.getElementById('b_seller_name');
  if(!customer||!input) return;
  input.value=customer.name;
  updateBuyingCustomerSuggestions(customer.name);
  closeBuyingCustomerSuggestions();
  scheduleBuyingDraftSave();
}
function closeBuyingCustomerSuggestions(){
  document.getElementById('b_customer_suggestions')?.classList.add('is-hidden');
  document.getElementById('b_seller_name')?.setAttribute('aria-expanded','false');
}
function closeBuyingCustomerSuggestionsSoon(){ setTimeout(closeBuyingCustomerSuggestions,160); }
function updateBuyingGrades(){
  const metal=val('b_metal'), select=document.getElementById('b_karat'), grades=distinctKarats(metal);
  select.innerHTML=grades.map(k=>`<option value="${k}">${esc(gradeLabel(metal,k))}</option>`).join('')+'<option value="__custom__">Custom purity (%)</option>';
  document.getElementById('b_custom_purity_field')?.classList.add('is-hidden');
  resetBuyingRate();
}
function handleBuyingGradeChange(){
  const custom=val('b_karat')==='__custom__';
  document.getElementById('b_custom_purity_field')?.classList.toggle('is-hidden',!custom);
  resetBuyingRate();
  if(custom) document.getElementById('b_custom_purity')?.focus();
}
function selectedBuyingGrade(){
  if(val('b_karat')==='__custom__') return customPurityGradeKey(val('b_custom_purity'));
  return val('b_karat');
}
function markBuyingRateOverride(){
  if(!canOverrideBuyingRate()){
    resetBuyingRate();
    toast('Buying-rate overrides are locked by administrator');
    return;
  }
  buyingDraftForm.b_rate_overridden='true';
}
function selectBuyingOverrideValue(input){ if(input?.value) input.select(); }
function resetBuyingRate(){
  const metal=val('b_metal'),karat=selectedBuyingGrade(),active=karat?activeRate(metal,karat):null,input=document.getElementById('b_rate');
  if(input) input.value=active?String(roundPeso(active.rate)):'';
  buyingDraftForm.b_rate_overridden='false';
  recalcBuying();
}
function recalcBuying(){
  const metal=val('b_metal'),karat=selectedBuyingGrade(),gross=parseFloat(val('b_gross'))||0,ded=parseFloat(val('b_ded'))||0;
  const net=Math.max(roundWeight(gross-ded),0), rateObj=karat?activeRate(metal,karat):null, systemRate=rateObj?roundPeso(rateObj.rate):0;
  const rateOverrideAllowed=canOverrideBuyingRate(),rateInput=document.getElementById('b_rate');
  if(!rateOverrideAllowed&&rateInput) rateInput.value=systemRate?String(systemRate):'';
  const enteredRate=Number(rateInput?.value),rate=rateInput?.value!==''&&Number.isFinite(enteredRate)?roundPeso(enteredRate):0;
  const rateOverridden=Boolean(rateOverrideAllowed&&rateObj&&Number.isFinite(rate)&&rate!==systemRate);
  buyingDraftForm.b_rate_overridden=rateOverridden?'true':'false';
  const netEl=document.getElementById('b_net_display'),rateLabel=document.getElementById('b_rate_label'),ratePanel=document.getElementById('b_rate_panel'),dailyRateReference=document.getElementById('b_daily_rate_reference'),rateReset=document.getElementById('b_rate_reset'),suggestedEl=document.getElementById('b_suggested_display'),payoutEl=document.getElementById('b_payout');
  if(netEl) netEl.textContent=fmtWeight(net);
  if(rateLabel) rateLabel.textContent=rateOverridden?'Buying rate override (this item only)':!rateOverrideAllowed?'Buying rate (Daily Rate Setup · locked)':karat&&customPurityFromKey(karat)!==null?`Buying rate (${gradeLabel(metal,karat)} × ${metal} base)`:'Buying rate (uses Daily Rate Setup)';
  ratePanel?.classList.toggle('is-overridden',rateOverridden);
  if(dailyRateReference) dailyRateReference.textContent=`Daily rate: ${fmtMoney(systemRate)}/g`;
  dailyRateReference?.classList.toggle('is-hidden',!rateOverridden);
  rateReset?.classList.toggle('is-hidden',!rateOverridden);
  const suggested=roundPeso(net*rate);
  if(suggestedEl) suggestedEl.textContent=fmtMoney(suggested);
  if(payoutEl) payoutEl.placeholder=String(suggested);
}
function purchaseItemFromForm(){
  const metal = val('b_metal'), karat = selectedBuyingGrade();
  if(val('b_karat')==='__custom__'&&!karat){ toast(`Enter a custom ${metal} purity between 0.01% and 100%`); return null; }
  if(!karat){ toast('Add a buying rate for this metal first'); return null; }
  const gross = parseFloat(val('b_gross'))||0, ded = parseFloat(val('b_ded'))||0;
  const net = Math.max(roundWeight(gross-ded),0);
  if(net<=0){ toast('Enter a valid gross weight'); return null; }
  const rateObj = activeRate(metal, karat);
  const systemRate = rateObj? roundPeso(rateObj.rate) : 0;
  const rate = canOverrideBuyingRate()?roundPeso(Number(val('b_rate'))):systemRate;
  if(!Number.isFinite(rate)||rate<=0){ toast('Enter a valid buying rate'); return null; }
  const rateOverridden = Boolean(canOverrideBuyingRate()&&rateObj && rate!==systemRate);
  const suggested = roundPeso(net*rate);
  const payoutInput = val('b_payout');
  const payout = payoutInput? roundPeso(parseFloat(payoutInput)) : suggested;
  const payoutOverridden = payout!==suggested;
  if(!Number.isFinite(payout)||payout<0){ toast('Enter a valid final payout'); return null; }
  return {id:uid('line'),metal,itemType:val('b_itemtype'),karat,grossWeight:gross,deductions:ded,
    netWeight:net,currentWeight:net,rate,systemRate,rateOverridden,payoutOverridden,suggestedAmount:suggested,payout,remarks:val('b_remarks').trim(),overrideReason:''};
}
async function addPurchaseItem(){
  const item=purchaseItemFromForm();
  if(!item) return;
  captureBuyingDraftForm();
  purchaseBatch.push(item);
  ['b_gross','b_ded','b_payout','b_remarks'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  buyingDraftForm.b_gross=''; buyingDraftForm.b_ded=''; buyingDraftForm.b_payout=''; buyingDraftForm.b_remarks='';
  resetBuyingRate();
  renderPurchaseBatchPanel();
  await saveBuyingDraft();
  toast(`${item.metal} ${gradeLabel(item.metal,item.karat)} added to current payout`);
}
function continueAddingPurchaseItems(){
  document.querySelector('.buying-item-step')?.scrollIntoView({behavior:'smooth',block:'start'});
  setTimeout(()=>document.getElementById('b_gross')?.focus(),250);
}
async function requestPurchaseItemRemoval(id){
  const item=purchaseBatch.find(line=>line.id===id); if(!item) return;
  purchaseBatch=purchaseBatch.filter(line=>line.id!==id);
  renderPurchaseBatchPanel();
  await saveBuyingDraft();
  toast(`${item.metal} ${gradeLabel(item.metal,item.karat)} removed from the current payout`);
}
function renderPurchaseBatchPanel(){
  const panel=document.getElementById('purchase_batch_panel');
  if(panel) panel.innerHTML=renderPurchaseBatchPanelMarkup();
}
function updatePurchaseBatchItemRemarks(id,value){
  const item=purchaseBatch.find(line=>line.id===id);
  if(!item) return;
  // Keep this on the queued item rather than the shared buying form so every
  // stock record receives only the note entered for that item.
  item.remarks=String(value??'');
  scheduleBuyingDraftSave();
}
function renderPurchaseBatchPanelMarkup(){
  const total=roundMoney(purchaseBatch.reduce((sum,item)=>sum+Number(item.payout),0));
  if(!purchaseBatch.length) return `<h2 class="block-title">Current payout</h2><div class="empty-note">Add the first item above. Every added item will remain visible here.</div>`;
  return `<section class="current-payout-card"><div class="current-payout-compact"><div><span>Current payout · ${purchaseBatch.length} item${purchaseBatch.length===1?'':'s'}</span><strong>${fmtMoney(total)}</strong></div></div>
    <div class="purchase-batch-list"><h3>Items in this payout</h3><div class="table-wrap"><table class="purchase-batch-table"><thead><tr><th>Item</th><th>Metal / grade</th><th class="num-col">Net weight</th><th class="num-col">Rate</th><th class="num-col">Payout</th><th></th></tr></thead><tbody>
    ${purchaseBatch.map((item,index)=>`<tr><td>${index+1}</td><td><span class="metal-tag ${item.metal.toLowerCase()}">${item.metal}</span> ${esc(gradeLabel(item.metal,item.karat))} · ${esc(item.itemType)}<label class="purchase-item-remarks" for="purchase_item_remarks_${esc(item.id)}"><span>Remarks for this item</span><textarea id="purchase_item_remarks_${esc(item.id)}" rows="2" placeholder="Optional item remarks" oninput="updatePurchaseBatchItemRemarks('${item.id}',this.value)">${esc(item.remarks||'')}</textarea></label></td><td class="num">${fmtWeight(item.netWeight)}</td><td class="num">${fmtMoney(item.rate)}/g${item.rateOverridden?'<br><span class="override-note">Overridden</span>':''}</td><td class="num">${fmtMoney(item.payout)}</td><td><button class="btn secondary small" onclick="requestPurchaseItemRemoval('${item.id}')">Remove</button></td></tr>`).join('')}
    </tbody></table></div></div>
    <div class="form-actions purchase-batch-actions"><button class="btn secondary" onclick="continueAddingPurchaseItems()">Add another item</button><button class="btn" onclick="openPurchaseSummary()">Proceed to payout</button></div></section>`;
}
function purchaseCustomer(){
  const name=val('b_seller_name').trim();
  if(!name) return {id:'',name:'',isNew:false};
  const existing=db.customers.find(customer=>customer.name.trim().toLowerCase()===name.toLowerCase());
  if(existing) return {id:existing.id,name,isNew:false};
  return {id:'',name,isNew:true};
}
function focusPurchaseSeller(){
  closePurchaseSummary();
  document.getElementById('buying_customer_step')?.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(()=>document.getElementById('b_seller_name')?.focus(),250);
}
function openPurchaseSummary(){
  if(!purchaseBatch.length){ toast('Add at least one item'); return; }
  const customer=purchaseCustomer();
  closePurchaseSummary();
  const total=roundMoney(purchaseBatch.reduce((sum,item)=>sum+Number(item.payout),0));
  const totalWeight=purchaseBatch.reduce((sum,item)=>sum+Number(item.netWeight),0);
  const modal=document.createElement('div'); modal.id='purchase_summary_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="summary-modal" role="dialog" aria-modal="true" aria-labelledby="purchase_summary_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Combined payout</div><h2 id="purchase_summary_title">${customer.name?esc(customer.name):'Walk-in seller'}</h2></div><button class="modal-close" onclick="closePurchaseSummary()" aria-label="Close">×</button></div>
    <div class="summary-lines">${purchaseBatch.map((item,index)=>`<div class="summary-line"><div><strong>${index+1}. ${esc(item.metal)} ${esc(gradeLabel(item.metal,item.karat))}</strong><span>${esc(item.itemType)} · ${fmtWeight(item.netWeight)} × ${fmtMoney(item.rate)}/g</span></div><strong>${fmtMoney(item.payout)}</strong></div>`).join('')}</div>
    <div class="summary-grand"><div><span>${purchaseBatch.length} item${purchaseBatch.length===1?'':'s'} · ${fmtWeight(totalWeight)}</span><strong>Grand total</strong></div><div>${fmtMoney(total)}</div></div>
    <div class="summary-meta">Seller: ${customer.name?esc(customer.name):'<strong>Not provided</strong>'} · ${fmtDate(val('b_date')||todayStr())} · ${esc(val('b_pay'))}${val('b_staff').trim()?` · Staff: ${esc(val('b_staff').trim())}`:''}</div>
    <div class="form-actions"><button class="btn secondary" onclick="closePurchaseSummary()">Back to items</button><button class="btn secondary" onclick="commitPurchaseBatch(false)">Record only</button><button class="btn" onclick="commitPurchaseBatch(true)">Confirm &amp; view receipt</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closePurchaseSummary();});
  document.body.appendChild(modal);
}
function closePurchaseSummary(){ document.getElementById('purchase_summary_modal')?.remove(); }
async function commitPurchaseBatch(printAfter=false){
  if(!purchaseBatch.length) return;
  captureBuyingDraftForm();
  const customer=purchaseCustomer();
  const previousCustomerCount=db.customers.length,previousStockCount=db.stock.length;
  let customerId=customer.id;
  if(customer.isNew){ customerId=uid('cust'); db.customers.push({id:customerId,name:customer.name,contact:'',notes:''}); }
  const batchId=uid('buy');
  const shared={date:val('b_date')||todayStr(),recordedAt:new Date().toISOString(),customerId,customerName:customer.name,paymentMethod:val('b_pay'),staff:val('b_staff').trim(),
    status:val('b_status'),batchId};
  purchaseBatch.forEach(item=>db.stock.push({...item,...shared,id:uid('stk'),cost:item.payout,remarks:String(item.remarks??val('b_remarks')).trim()}));
  const count=purchaseBatch.length,total=roundMoney(purchaseBatch.reduce((sum,item)=>sum+Number(item.payout),0));
  const saved=await saveDB();
  if(!saved){ db.customers.splice(previousCustomerCount); db.stock.splice(previousStockCount); toast('The purchase was not recorded. Your payout draft is still saved.'); return; }
  purchaseBatch=[]; closePurchaseSummary(); await clearBuyingDraft(); render();
  await syncCashflow();
  if(printAfter) openPurchaseReceipt(batchId);
  toast(`${count} items recorded · ${fmtMoney(total)}`);
}

function receiptWeightNumber(value){ return Number(value||0).toLocaleString('en-PH',{minimumFractionDigits:0,maximumFractionDigits:2}); }
function receiptMoneyNumber(value){ return Math.round(Number(value)||0).toLocaleString('en-PH',{maximumFractionDigits:0}); }
function purchaseReceiptMarkup(items){
  const first=items[0],total=roundMoney(items.reduce((sum,item)=>sum+Number(item.payout),0));
  const transactionNumber=first.batchId||first.id;
  const itemLines=items.map(item=>`<tr class="receipt-item"><td class="receipt-description"><span class="receipt-item-title">${esc(item.metal)} ${esc(gradeLabel(item.metal,item.karat))}</span><small class="receipt-item-detail">${esc(item.itemType)}</small><small class="receipt-item-rate">Rate: PHP ${receiptMoneyNumber(item.rate)}/g</small></td><td class="receipt-qty">1</td><td class="receipt-weight">${receiptWeightNumber(item.netWeight)}g</td><td class="receipt-amount">${receiptMoneyNumber(item.payout)}</td></tr>`).join('');
  return `<header class="receipt-header"><div class="receipt-shop">ZP GOLD &amp; SILVER</div><div class="receipt-address">Barcelona St, Zone II<br>Zamboanga City</div></header><div class="receipt-rule"></div>
    <div class="receipt-meta"><span>Date:</span><strong>${esc(fmtDate(first.date))}</strong><span>Customer:</span><strong>${esc(first.customerName||'Walk-in')}</strong><span>Transaction No.:</span><strong>${esc(transactionNumber)}</strong>${first.staff?`<span>Staff:</span><strong>${esc(first.staff)}</strong>`:''}</div><div class="receipt-rule"></div>
    <table class="receipt-items"><colgroup><col class="receipt-col-description"><col class="receipt-col-qty"><col class="receipt-col-weight"><col class="receipt-col-amount"></colgroup><thead><tr><th>ITEM</th><th>QTY</th><th>WT (g)</th><th>AMOUNT</th></tr></thead><tbody>${itemLines}</tbody></table>
    <div class="receipt-rule receipt-rule-strong"></div><div class="receipt-total"><span>TOTAL</span><span>PHP ${receiptMoneyNumber(total)}</span></div><div class="receipt-rule"></div>
    <div class="receipt-payment"><span>PAID:</span><strong>PHP ${receiptMoneyNumber(total)}</strong><span>METHOD:</span><strong>${esc(first.paymentMethod||'—')}</strong></div>
    <div class="receipt-thanks">Thank you!</div><div class="receipt-quote">“Because gold is honest money it is disliked by dishonest men.”</div>`;
}
function cleanupThermalPrintState(){
  document.body.classList.remove('printing-thermal-receipt');
  document.getElementById('thermal_print_page_style')?.remove();
}
function closePurchaseReceipt(){ cleanupThermalPrintState(); document.getElementById('purchase_receipt_modal')?.remove(); }
function setReceiptPaperSize(value){
  const receipt=document.getElementById('receipt_preview_paper');
  receipt?.classList.toggle('paper-80',String(value)==='80');
  try{localStorage.setItem('thermalReceiptPaperWidth',String(value)==='80'?'80':'58');}catch{}
}
function openPurchaseReceipt(batchId){
  const items=db.stock.filter(item=>(item.batchId||item.id)===batchId);
  if(!items.length){ toast('Receipt record not found'); return; }
  closePurchaseReceipt();
  let savedPaperWidth='58';try{savedPaperWidth=localStorage.getItem('thermalReceiptPaperWidth')==='80'?'80':'58';}catch{}
  const modal=document.createElement('div'); modal.id='purchase_receipt_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="receipt-preview-modal" role="dialog" aria-modal="true" aria-labelledby="receipt_preview_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Thermal receipt preview</div><h2 id="receipt_preview_title">Buying receipt</h2></div><button class="modal-close" onclick="closePurchaseReceipt()" aria-label="Close">×</button></div>
    <div class="receipt-preview-stage"><div class="thermal-receipt ${savedPaperWidth==='80'?'paper-80':''}" id="receipt_preview_paper">${purchaseReceiptMarkup(items)}</div></div>
    <div class="receipt-preview-controls"><div class="field"><label for="receipt_paper_size">Thermal paper width</label><select id="receipt_paper_size" onchange="setReceiptPaperSize(this.value)"><option value="58" ${savedPaperWidth==='58'?'selected':''}>58 mm (VOZY P50)</option><option value="80" ${savedPaperWidth==='80'?'selected':''}>80 mm</option></select></div>
    <div class="form-actions"><button class="btn secondary" onclick="closePurchaseReceipt()">Close</button><button class="btn" onclick="printPurchaseReceipt('${batchId}')">Print receipt</button></div></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closePurchaseReceipt();});
  document.body.appendChild(modal);
}
function measureThermalReceiptHeight(receipt,paperWidth,receiptWidth,paperPadding){
  const probe=receipt.cloneNode(true);
  probe.removeAttribute('id');probe.setAttribute('aria-hidden','true');probe.classList.toggle('paper-80',paperWidth===80);
  Object.assign(probe.style,{position:'fixed',left:'-10000px',top:'0',visibility:'hidden',boxSizing:'border-box',width:`${receiptWidth}mm`,maxWidth:'none',height:'auto',minHeight:'0',margin:'0',padding:`${paperPadding}mm`,boxShadow:'none',fontFamily:'"Courier New", Courier, monospace',fontSize:paperWidth===80?'11.5px':'10.5px',fontWeight:'900',lineHeight:'1.22',transform:'none',writingMode:'horizontal-tb'});
  const table=probe.querySelector('.receipt-items');if(table)table.style.fontSize=paperWidth===80?'10px':'9px';
  const total=probe.querySelector('.receipt-total');if(total)total.style.fontSize=paperWidth===80?'14px':'13px';
  document.body.appendChild(probe);
  const contentHeight=Math.ceil(probe.getBoundingClientRect().height*25.4/96+3);
  probe.remove();
  return Math.max(35,contentHeight);
}
function thermalReceiptPrintDocument(markup,paperWidth,receiptHeight){
  const receiptWidth=paperWidth===80?72:48,paperPadding=paperWidth===80?2:1;
  return `<!doctype html><html><head><meta charset="UTF-8"><title>ZP Gold &amp; Silver receipt</title><style>
    @page{size:${paperWidth}mm ${receiptHeight}mm;margin:0}
    *{box-sizing:border-box}
    html,body{width:${paperWidth}mm;height:auto;min-height:0;margin:0!important;padding:0!important;background:#fff;color:#000}
    body{font-family:Arial,Helvetica,sans-serif;font-size:${paperWidth===80?11.5:10.5}px;font-weight:900;font-synthesis:weight;text-rendering:optimizeLegibility;line-height:1.22;-webkit-text-stroke:.24px #000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .thermal-receipt{width:${receiptWidth}mm;height:auto;min-height:0;margin:0!important;padding:${paperPadding}mm!important;background:#fff;color:#000;transform:none!important;rotate:none!important;writing-mode:horizontal-tb!important;direction:ltr!important}
    .thermal-receipt,.thermal-receipt *{font-weight:900}
    .receipt-header,.receipt-meta,.receipt-total,.receipt-payment,.receipt-thanks,.receipt-quote,.receipt-item{break-inside:avoid;page-break-inside:avoid}
    .receipt-shop{text-align:center;font-size:${paperWidth===80?17:15}px;font-weight:900;letter-spacing:.1px;line-height:1.08}
    .receipt-address{text-align:center;font-size:${paperWidth===80?10.5:9.5}px;line-height:1.2;margin-top:1px}
    .receipt-rule{border-top:1px dashed #000;margin:4px 0}.receipt-rule-strong{border-top-style:solid}
    .receipt-meta,.receipt-payment{display:grid;grid-template-columns:max-content minmax(0,1fr);column-gap:4px;row-gap:2px;align-items:start}
    .receipt-meta span,.receipt-payment span{white-space:nowrap}.receipt-meta strong{min-width:0;overflow-wrap:anywhere}.receipt-payment strong{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
    .receipt-items{width:100%;border-collapse:collapse;table-layout:fixed;font-size:${paperWidth===80?10:9}px;font-weight:900;line-height:1.16;font-variant-numeric:tabular-nums}
    .receipt-col-description{width:40%}.receipt-col-qty{width:10%}.receipt-col-weight{width:20%}.receipt-col-amount{width:30%}
    .receipt-items th{padding:0 1px 3px;text-align:right;vertical-align:bottom;font-family:Arial,Helvetica,sans-serif;font-size:${paperWidth===80?9:8}px;font-weight:900;line-height:1;letter-spacing:0;white-space:nowrap;-webkit-text-stroke:0}.receipt-items th:first-child{text-align:left}
    .receipt-items td{padding:4px 1px;vertical-align:top;border-bottom:1px dotted #000}.receipt-description{text-align:left;overflow-wrap:anywhere;word-break:normal}
    .receipt-item-title,.receipt-item-detail,.receipt-item-rate{display:block}.receipt-item-title,.receipt-qty,.receipt-weight,.receipt-amount{font-family:Arial,Helvetica,sans-serif;font-size:${paperWidth===80?11:10}px;font-weight:900;line-height:1.1;-webkit-text-stroke:.16px #000}.receipt-item-detail{margin-top:1px}.receipt-item-rate{margin-top:1px;font-family:Arial,Helvetica,sans-serif;font-size:${paperWidth===80?10:9}px;font-weight:900;line-height:1.1;-webkit-text-stroke:.12px #000;white-space:normal}
    .receipt-qty,.receipt-weight,.receipt-amount{text-align:right;white-space:nowrap}
    .receipt-total{display:flex;justify-content:space-between;align-items:baseline;gap:3px;font-size:${paperWidth===80?14:13}px;font-weight:900}.receipt-total span:last-child{margin-left:auto;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
    .receipt-thanks{text-align:center;font-weight:900;margin-top:6px}.receipt-quote{margin-top:5px;padding-top:4px;border-top:1px dashed #000;text-align:center;font-size:${paperWidth===80?9:8}px;font-style:italic;line-height:1.2}
  </style></head><body><main class="thermal-receipt">${markup}</main></body></html>`;
}
function printPurchaseReceipt(batchId){
  const items=db.stock.filter(item=>(item.batchId||item.id)===batchId);
  if(!items.length){ toast('Receipt record not found'); return; }
  const paperWidth=Number(val('receipt_paper_size'))===80?80:58;
  const receiptWidth=paperWidth===80?72:46;
  const paperPadding=paperWidth===80?2:2;
  document.getElementById('thermal_print_page_style')?.remove();
  const pageStyle=document.createElement('style');pageStyle.id='thermal_print_page_style';
  pageStyle.textContent=`@page{size:${paperWidth}mm auto;margin:0}body.printing-thermal-receipt .thermal-receipt,body.printing-thermal-receipt .thermal-receipt.paper-80{box-sizing:border-box;width:${receiptWidth}mm;max-width:${receiptWidth}mm;margin:0!important;padding:${paperPadding}mm!important}`;
  document.head.appendChild(pageStyle);
  document.body.classList.add('printing-thermal-receipt');
  window.addEventListener('afterprint',cleanupThermalPrintState,{once:true});
  window.print();
}

/* ============================= INVENTORY ============================= */
let invFilter = {metal:'All', karat:'All', type:'All', status:'All'};
let inventoryBulkStatus='Available';
let inventoryWeekOffset=0;
let inventorySelectedDate='All';
let inventorySearch='';
let inventorySort='newest';
const inventoryMoveSelection=new Set();
const inventoryPoolRowSelection=new Set();
let inventoryPoolMergeSaving=false;
let pendingInventoryMove=null;
let pendingLiquidationBatchSetup=null;
let combineLiquidationMetal='';
const combineLiquidationDates=new Set();
const POOLED_LIQUIDATION_METALS=['Gold','Silver'];
const LOW_KARAT_GOLD_KEYS=new Set(['17K','16K','14K','12K','10K','9K','8K','5K','73%']);
function inventoryWeekRange(offset=inventoryWeekOffset){
  const today=new Date(todayStr()+'T00:00:00');
  const mondayIndex=(today.getDay()+6)%7;
  const start=new Date(today); start.setDate(today.getDate()-mondayIndex+(offset*7));
  const end=new Date(start); end.setDate(start.getDate()+6);
  const asKey=date=>{ const local=new Date(date.getTime()-date.getTimezoneOffset()*60000); return local.toISOString().slice(0,10); };
  return {start:asKey(start),end:asKey(end)};
}
function clearInventoryLiquidationSelection(){ inventoryMoveSelection.clear(); }
function dateKeyPlusDays(dateKey,days){
  const date=new Date(dateKey+'T00:00:00'); date.setDate(date.getDate()+days);
  const local=new Date(date.getTime()-date.getTimezoneOffset()*60000); return local.toISOString().slice(0,10);
}
function changeInventoryWeek(delta){
  inventoryWeekOffset+=delta;
  inventorySelectedDate=inventoryWeekRange().start; render();
}
function selectInventoryDate(date){
  inventorySelectedDate=date; render();
  requestAnimationFrame(()=>openInventoryFilterModal());
}
function selectAllInventoryDates(){
  inventorySelectedDate='All'; inventoryMoveSelection.clear(); render();
  requestAnimationFrame(()=>document.getElementById('inventory_stock_list')?.scrollIntoView({behavior:'smooth',block:'start'}));
}
function inventoryDateScope(item){ return inventorySelectedDate==='All'||item.date===inventorySelectedDate; }
function inventoryDateLabel(){ return inventorySelectedDate==='All'?'all purchase dates':fmtDate(inventorySelectedDate); }
function inventorySearchText(item){
  return [item.date,fmtDate(item.date),item.customerName,item.metal,item.karat,gradeLabel(item.metal,item.karat),item.itemType,item.status,item.remarks,item.staff]
    .filter(Boolean).join(' ').toLowerCase();
}
function inventorySearchMatch(item){ const query=inventorySearch.trim().toLowerCase(); return !query||inventorySearchText(item).includes(query); }
function updateInventorySearch(value){
  inventorySearch=String(value||'');
  render();
  requestAnimationFrame(()=>{
    const input=document.getElementById('inventory_stock_search');
    if(input){ input.focus(); input.setSelectionRange?.(input.value.length,input.value.length); }
  });
}
function updateInventorySort(value){
  inventorySort=value==='oldest'?'oldest':'newest';
  render();
}
function closeInventoryFilterModal(){ document.getElementById('inventory_filter_modal')?.remove(); }
function activeInventoryRecord(item){ return Number(item.currentWeight)>0&&!['For Liquidation','Liquidated','Refined','Sold'].includes(item.status); }
function inventoryFilterKaratsForDate(metal){
  return Array.from(new Set(db.stock.filter(item=>inventoryDateScope(item)&&activeInventoryRecord(item)&&(metal==='All'||item.metal===metal)).map(item=>item.karat)));
}
function updateInventoryFilterModalKarats(){
  const metal=val('modal_inv_metal'),select=document.getElementById('modal_inv_karat');
  if(!select) return;
  const current=select.value||invFilter.karat,karats=inventoryFilterKaratsForDate(metal);
  select.innerHTML=`<option value="All">All purities</option>${karats.map(karat=>`<option value="${esc(karat)}">${esc(karat)}</option>`).join('')}`;
  select.value=karats.includes(current)?current:'All';
}
function openInventoryFilterModal(){
  closeInventoryFilterModal();
  const dayStock=db.stock.filter(item=>inventoryDateScope(item)&&activeInventoryRecord(item));
  const available=dayStock.filter(selectableInventory);
  const karats=inventoryFilterKaratsForDate(invFilter.metal);
  const modal=document.createElement('div'); modal.id='inventory_filter_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="summary-modal inventory-filter-modal" role="dialog" aria-modal="true" aria-labelledby="inventory_filter_title">
    <div class="summary-modal-head"><div><div class="eyebrow">${inventorySelectedDate==='All'?'Complete current inventory':`${new Date(inventorySelectedDate+'T00:00:00').toLocaleDateString('en-PH',{weekday:'long'})} · ${fmtDate(inventorySelectedDate)}`}</div><h2 id="inventory_filter_title">Filter ${inventorySelectedDate==='All'?'all stock':"this day's stock"}</h2></div><button class="modal-close" onclick="closeInventoryFilterModal()" aria-label="Close">×</button></div>
    <p class="move-confirmation-intro">This view has <strong>${dayStock.length} stock record${dayStock.length===1?'':'s'}</strong>, with <strong>${available.length} currently available</strong>. Choose what you want to see.</p>
    <div class="form-grid inventory-filter-modal-grid">
      <div class="field"><label for="modal_inv_metal">Metal</label><select id="modal_inv_metal" onchange="updateInventoryFilterModalKarats()">${['All','Gold','Silver','Platinum'].map(metal=>`<option value="${metal}" ${invFilter.metal===metal?'selected':''}>${metal==='All'?'All metals':metal}</option>`).join('')}</select></div>
      <div class="field"><label for="modal_inv_karat">Karat / purity</label><select id="modal_inv_karat"><option value="All">All purities</option>${karats.map(karat=>`<option value="${esc(karat)}" ${invFilter.karat===karat?'selected':''}>${esc(karat)}</option>`).join('')}</select></div>
      <div class="field"><label for="modal_inv_type">Item type</label><select id="modal_inv_type">${['All','Jewelry','Scrap'].map(type=>`<option value="${type}" ${invFilter.type===type?'selected':''}>${type==='All'?'All item types':type}</option>`).join('')}</select></div>
      <div class="field"><label for="modal_inv_status">Status</label><select id="modal_inv_status">${['All','Available','For Refining','On Hold'].map(status=>`<option value="${status}" ${invFilter.status===status?'selected':''}>${status==='All'?'All statuses':status}</option>`).join('')}</select></div>
    </div>
    <div class="inventory-filter-help"><strong>Tip:</strong> Choose “All” to include every current record from ${inventoryDateLabel()}.</div>
    <div class="form-actions inventory-filter-modal-actions"><button class="btn secondary" onclick="showAllInventoryForSelectedDate()">Show all stock</button><button class="btn" onclick="applyInventoryDateFilters()">Apply filters</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeInventoryFilterModal();});
  document.body.appendChild(modal);
}
function finishInventoryDateFilter(){
  closeInventoryFilterModal(); render();
  requestAnimationFrame(()=>document.getElementById('inventory_stock_list')?.scrollIntoView({behavior:'smooth',block:'start'}));
}
function showAllInventoryForSelectedDate(){
  invFilter={metal:'All',karat:'All',type:'All',status:'All'};
  finishInventoryDateFilter();
}
function applyInventoryDateFilters(){
  invFilter={metal:val('modal_inv_metal'),karat:val('modal_inv_karat'),type:val('modal_inv_type'),status:val('modal_inv_status')};
  finishInventoryDateFilter();
}
function selectInventoryMetalCategory(metal){
  invFilter.metal=metal;
  invFilter.karat='All';
  inventoryMoveSelection.clear();
  render();
}
function showTodayInventoryTotals(metal){
  inventoryWeekOffset=0;
  inventorySelectedDate=todayStr();
  invFilter={metal,karat:'All',type:'All',status:'All'};
  inventorySearch='';
  inventoryMoveSelection.clear();
  render();
  requestAnimationFrame(()=>document.getElementById('inventory_daily_totals')?.scrollIntoView({behavior:'smooth',block:'start'}));
}
function purchaseTotalsByPurity(records){
  const groups=new Map();
  records.forEach(item=>{
    const key=`${item.metal}|${item.karat}`;
    const entry=groups.get(key)||{metal:item.metal,karat:item.karat,count:0,purchasedWeight:0,payout:0,remainingWeight:0};
    entry.count+=1;
    entry.purchasedWeight+=Number(item.netWeight||0);
    entry.payout+=Number(item.payout||0);
    entry.remainingWeight+=Number(item.currentWeight||0);
    groups.set(key,entry);
  });
  return Array.from(groups.values()).sort((a,b)=>a.metal.localeCompare(b.metal)||(GRADE_META[a.metal]?.findIndex(grade=>grade.key===a.karat)??99)-(GRADE_META[b.metal]?.findIndex(grade=>grade.key===b.karat)??99));
}
function selectableInventory(item){ return Number(item.currentWeight)>0&&!item.inventoryPoolId&&(item.status==='Available'||item.status==='For Refining'); }
function movableInventory(item){ return selectableInventory(item); }
function categorizableInventory(item){ return activeInventoryRecord(item)&&!item.inventoryPoolId; }
function lowKaratGoldInventory(item){ return item.metal==='Gold'&&LOW_KARAT_GOLD_KEYS.has(item.karat)&&activeInventoryRecord(item); }
function selectedInventoryForCategory(){ return db.stock.filter(item=>inventoryMoveSelection.has(item.id)&&categorizableInventory(item)); }
function selectedInventoryForMove(){ return db.stock.filter(item=>inventoryMoveSelection.has(item.id)&&movableInventory(item)); }
function inventoryPercentagePool(){
  return db.stock.filter(item=>inventoryDateScope(item)&&movableInventory(item)&&
    (invFilter.metal==='All'||item.metal===invFilter.metal)&&
    (invFilter.karat==='All'||item.karat===invFilter.karat)&&
    (invFilter.type==='All'||item.itemType===invFilter.type)&&
    (invFilter.status==='All'||item.status===invFilter.status));
}
function percentageStockCount(percentage,total){ return total?Math.max(1,Math.ceil(total*(Number(percentage)/100))):0; }
function toggleInventoryForLiquidation(id,checked){
  const item=db.stock.find(stock=>stock.id===id); if(!item||!categorizableInventory(item)) return;
  if(checked) inventoryMoveSelection.add(id); else inventoryMoveSelection.delete(id);
  const selected=selectedInventoryForCategory();
  const buttons=document.querySelectorAll('.inventory-move-liquidation');
  const count=document.getElementById('inventory_liq_count');
  buttons.forEach(button=>button.disabled=!inventoryPercentagePool().length);
  document.querySelectorAll('[data-inventory-selection-required]').forEach(button=>{button.disabled=!selected.length;});
  const moveButton=document.getElementById('inventory_move_selected');
  if(moveButton) moveButton.disabled=!inventoryPoolRowSelection.size&&(!selected.length||selected.some(record=>!movableInventory(record)));
  const poolButton=document.getElementById('inventory_pool_selected');
  if(poolButton) poolButton.disabled=!inventoryPoolingSelection().valid;
  const clearButton=document.getElementById('inventory_clear_selected');
  if(clearButton) clearButton.disabled=!selected.length&&!inventoryPoolRowSelection.size;
  if(count) count.textContent=String(selected.length);
}
function syncInventoryMoveCheckboxes(){
  document.querySelectorAll('[data-inventory-move-id]').forEach(input=>{
    input.checked=inventoryMoveSelection.has(input.dataset.inventoryMoveId);
  });
  const count=document.getElementById('inventory_liq_count');
  const selected=selectedInventoryForCategory();
  document.querySelectorAll('[data-inventory-selection-required]').forEach(button=>{button.disabled=!selected.length;});
  const moveButton=document.getElementById('inventory_move_selected');
  if(moveButton) moveButton.disabled=!inventoryPoolRowSelection.size&&(!selected.length||selected.some(record=>!movableInventory(record)));
  const poolButton=document.getElementById('inventory_pool_selected');
  if(poolButton) poolButton.disabled=!inventoryPoolingSelection().valid;
  const clearButton=document.getElementById('inventory_clear_selected');
  if(clearButton) clearButton.disabled=!selected.length&&!inventoryPoolRowSelection.size;
  if(count) count.textContent=String(selected.length);
}
function syncVisibleInventorySelections(){
  // Mobile browsers can preserve a checked checkbox while a preceding row is
  // re-rendered. Capture the visible checked state immediately before opening
  // the review so the selected pool cannot be dropped from the move.
  if(typeof document.querySelectorAll!=='function') return;
  document.querySelectorAll('[data-inventory-move-id]:checked').forEach(input=>{
    if(!input.disabled&&input.dataset.inventoryMoveId) inventoryMoveSelection.add(input.dataset.inventoryMoveId);
  });
  document.querySelectorAll('[data-inventory-pool-id]:checked').forEach(input=>{
    if(input.dataset.inventoryPoolId) inventoryPoolRowSelection.add(input.dataset.inventoryPoolId);
  });
}
function visibleInventoryRecords(){
  return db.stock.filter(item=>inventoryDateScope(item)&&activeInventoryRecord(item)&&
    (invFilter.metal==='All'||item.metal===invFilter.metal)&&
    (invFilter.karat==='All'||item.karat===invFilter.karat)&&
    (invFilter.type==='All'||item.itemType===invFilter.type)&&
    (invFilter.status==='All'||item.status===invFilter.status)&&inventorySearchMatch(item));
}
function selectAllVisibleInventory(){
  visibleInventoryRecords().filter(categorizableInventory).forEach(item=>inventoryMoveSelection.add(item.id));
  render();
}
function selectAllLowKaratGold(){
  if(!adminEditGuard()) return;
  const records=db.stock.filter(item=>lowKaratGoldInventory(item)&&categorizableInventory(item));
  if(!records.length){ toast('There are no available low-karat Gold items to select'); return; }
  inventoryMoveSelection.clear();
  records.forEach(item=>inventoryMoveSelection.add(item.id));
  inventoryBulkStatus='For Refining';
  inventorySelectedDate='All';
  invFilter={...invFilter,metal:'Gold',karat:'All',status:'All'};
  render();
  requestAnimationFrame(()=>document.getElementById('inventory_stock_list')?.scrollIntoView({behavior:'smooth',block:'start'}));
  toast(`${records.length} low-karat Gold ${records.length===1?'item':'items'} selected across all dates`);
}
function clearInventorySelection(){ inventoryMoveSelection.clear(); inventoryPoolRowSelection.clear(); render(); }
async function categorizeCheckedInventory(){
  if(!adminEditGuard()) return;
  const selected=selectedInventoryForCategory(),status=val('inventory_bulk_status');
  if(!selected.length){ toast('Select at least one inventory record'); return; }
  if(!['Available','For Refining','On Hold'].includes(status)){ toast('Choose a valid category'); return; }
  if(!confirm(`Change ${selected.length} selected inventory ${selected.length===1?'record':'records'} to “${status}”?`)) return;
  selected.forEach(item=>{item.status=status;});
  inventoryMoveSelection.clear();
  await saveDB(); render(); toast(`${selected.length} inventory ${selected.length===1?'record':'records'} changed to ${status}`);
}
function closeInventoryMoveConfirmation(){
  document.getElementById('inventory_move_confirmation')?.remove();
  pendingInventoryMove=null;
}
function moveInventorySelectionToLiquidation(percentage){
  const portion=Number(percentage);
  if(![50,100].includes(portion)){ toast('Choose Move 50% or Move 100%'); return; }
  const pool=inventoryPercentagePool();
  const required=percentageStockCount(portion,pool.length);
  if(!pool.length){ toast('There are no eligible stock records for this date and filter'); return; }
  inventoryMoveSelection.clear();
  pool.slice(0,required).forEach(item=>inventoryMoveSelection.add(item.id));
  const selected=selectedInventoryForMove();
  if(selected.length!==required){ toast('The requested stock records are no longer available. Refresh Inventory and try again.'); return; }
  if(selected.some(item=>!pool.some(poolItem=>poolItem.id===item.id))){ toast('All selected records must belong to the displayed date and filter'); return; }
  syncInventoryMoveCheckboxes();
  requestAnimationFrame(()=>requestAnimationFrame(()=>openInventoryMoveReview(selected,{percentage:portion,total:pool.length,automatic:true})));
}
function moveCheckedInventoryToLiquidation(){
  syncVisibleInventorySelections();
  const checked=selectedInventoryForCategory();
  const pools=selectedExistingPoolsForPooling();
  if(!checked.length&&!pools.length){ toast('Check at least one inventory record or pool first'); return; }
  if(checked.some(item=>!movableInventory(item))){ toast('On Hold records must be categorized as Available or For Refining before liquidation'); return; }
  const poolRows=pools.map(pool=>inventoryPoolReviewRow(pool)).filter(Boolean);
  const selected=[...checked,...poolRows];
  openInventoryMoveReview(selected,{total:selected.length,automatic:false,itemIds:checked.map(item=>item.id),poolIds:pools.map(pool=>pool.id)});
}
function availableCombineDates(metal){
  const groups=new Map();
  db.stock.filter(item=>movableInventory(item)&&item.metal===metal).forEach(item=>{
    const group=groups.get(item.date)||{date:item.date,count:0,weight:0,cost:0};
    group.count+=1; group.weight+=Number(item.currentWeight); group.cost+=Number(item.cost);
    groups.set(item.date,group);
  });
  return Array.from(groups.values()).sort((a,b)=>b.date.localeCompare(a.date));
}
function closeCombineLiquidationDateSelection(){
  document.getElementById('combine_liquidation_dates')?.remove();
  combineLiquidationDates.clear();
}
function toggleCombineLiquidationDate(date,checked){
  if(checked) combineLiquidationDates.add(date); else combineLiquidationDates.delete(date);
  renderCombineLiquidationDateChoices();
}
function changeCombineLiquidationMetal(metal){
  combineLiquidationMetal=metal;
  combineLiquidationDates.clear();
  const choices=availableCombineDates(metal);
  if(choices.some(choice=>choice.date===inventorySelectedDate)) combineLiquidationDates.add(inventorySelectedDate);
  renderCombineLiquidationDateChoices();
}
function renderCombineLiquidationDateChoices(){
  const container=document.getElementById('combine_liquidation_date_choices');
  if(!container) return;
  const choices=availableCombineDates(combineLiquidationMetal);
  const chosen=choices.filter(choice=>combineLiquidationDates.has(choice.date));
  const count=chosen.reduce((sum,choice)=>sum+choice.count,0);
  const weight=chosen.reduce((sum,choice)=>sum+choice.weight,0);
  container.innerHTML=`
    <div class="combine-date-list">
      ${choices.map(choice=>`<label class="combine-date-option ${combineLiquidationDates.has(choice.date)?'selected':''}">
        <input type="checkbox" ${combineLiquidationDates.has(choice.date)?'checked':''} onchange="toggleCombineLiquidationDate('${choice.date}',this.checked)">
        <span><strong>${new Date(choice.date+'T00:00:00').toLocaleDateString('en-PH',{weekday:'long'})}</strong><small>${fmtDate(choice.date)}</small></span>
        <span class="num"><strong>${choice.count} record${choice.count===1?'':'s'}</strong><small>${fmtWeight(choice.weight)} · ${fmtMoney(choice.cost)}</small></span>
      </label>`).join('')||'<div class="empty-note">No eligible inventory dates are available for this metal.</div>'}
    </div>
    <div class="move-confirmation-summary combine-date-summary">
      <div><span>Dates selected</span><strong>${chosen.length}</strong></div>
      <div><span>Stock records</span><strong>${count}</strong></div>
      <div><span>Total weight</span><strong>${fmtWeight(weight)}</strong></div>
    </div>`;
  const button=document.getElementById('confirm_combine_dates');
  if(button) button.disabled=!chosen.length;
}
function openCombineLiquidationDateSelection(){
  const available=db.stock.filter(movableInventory);
  if(!available.length){ toast('There are no eligible inventory records to combine'); return; }
  const selected=selectedInventoryForMove();
  const selectedMetals=Array.from(new Set(selected.map(item=>item.metal)));
  const metals=Array.from(new Set(available.map(item=>item.metal)));
  combineLiquidationMetal=selectedMetals.length===1?selectedMetals[0]:(invFilter.metal!=='All'&&metals.includes(invFilter.metal)?invFilter.metal:metals[0]);
  combineLiquidationDates.clear();
  selected.filter(item=>item.metal===combineLiquidationMetal).forEach(item=>combineLiquidationDates.add(item.date));
  const choices=availableCombineDates(combineLiquidationMetal);
  if(!combineLiquidationDates.size){
    if(choices.some(choice=>choice.date===inventorySelectedDate)) combineLiquidationDates.add(inventorySelectedDate);
    else if(choices[0]) combineLiquidationDates.add(choices[0].date);
  }
  const modal=document.createElement('div');
  modal.id='combine_liquidation_dates'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="inventory-move-modal combine-date-modal" role="dialog" aria-modal="true" aria-labelledby="combine_liquidation_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Combine for liquidation</div><h2 id="combine_liquidation_title">Select purchase dates</h2></div><button class="modal-close" onclick="closeCombineLiquidationDateSelection()" aria-label="Close">×</button></div>
    <p class="move-confirmation-intro">Choose one or more dates. The system will automatically select every available stock record for the chosen metal on those dates and combine them into one liquidation batch.</p>
    <div class="field combine-metal-field"><label for="combine_liquidation_metal">Metal</label><select id="combine_liquidation_metal" onchange="changeCombineLiquidationMetal(this.value)">${metals.map(metal=>`<option value="${esc(metal)}" ${metal===combineLiquidationMetal?'selected':''}>${esc(metal)}</option>`).join('')}</select></div>
    <div id="combine_liquidation_date_choices"></div>
    <div class="move-confirmation-note"><strong>Nothing is sold yet.</strong><span>You can review every automatically selected item before creating the Liquidation batch.</span></div>
    <div class="form-actions"><button class="btn secondary" onclick="closeCombineLiquidationDateSelection()">Cancel</button><button class="btn" id="confirm_combine_dates" onclick="confirmCombineLiquidationDates()">Review selected dates</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeCombineLiquidationDateSelection();});
  document.body.appendChild(modal);
  renderCombineLiquidationDateChoices();
}
function confirmCombineLiquidationDates(){
  const dates=new Set(combineLiquidationDates);
  if(!dates.size){ toast('Select at least one purchase date'); return; }
  const selected=db.stock.filter(item=>movableInventory(item)&&item.metal===combineLiquidationMetal&&dates.has(item.date));
  if(!selected.length){ toast('The chosen dates no longer have eligible stock records'); return; }
  inventoryMoveSelection.clear();
  selected.forEach(item=>inventoryMoveSelection.add(item.id));
  closeCombineLiquidationDateSelection();
  openInventoryMoveReview(selected,{total:selected.length,automatic:true,combineDates:true});
}
function inventoryPoolItems(pool){
  const ids=new Set(pool?.itemIds||[]);
  return db.stock.filter(item=>ids.has(item.id));
}
function inventoryPoolSnapshot(pool){
  const items=inventoryPoolItems(pool);
  const weight=roundWeight(items.reduce((sum,item)=>sum+Number(item.currentWeight||0),0));
  const cost=roundMoney(items.reduce((sum,item)=>sum+Number(item.cost||0),0));
  return {items,weight,cost,averageCost:weight?cost/weight:0};
}
function inventoryPoolReviewRow(pool){
  const snapshot=inventoryPoolSnapshot(pool);
  if(snapshot.weight<=0) return null;
  const composition=inventoryPoolComposition(snapshot.items);
  const types=Array.from(new Set(snapshot.items.map(item=>item.itemType).filter(Boolean)));
  const dates=snapshot.items.map(item=>item.date).filter(Boolean).sort();
  return {
    id:pool.id,
    date:dates.at(-1)||String(pool.createdAt||'').slice(0,10)||todayStr(),
    customerName:pool.name||pool.id,
    metal:composition.metal,
    karat:composition.karat,
    itemType:types.length===1?types[0]:'Mixed',
    status:poolInventoryClassification(pool,snapshot),
    currentWeight:snapshot.weight,
    cost:snapshot.cost,
    remarks:pool.notes||`${pool.itemIds.length} pooled inventory records`,
    inventoryPoolId:pool.id,
    isInventoryPool:true
  };
}
function inventoryPoolStatus(pool,snapshot=inventoryPoolSnapshot(pool)){
  if(snapshot.weight<=0) return 'FULLY LIQUIDATED';
  if(pool.onHold) return 'ON HOLD';
  if(snapshot.weight<Number(pool.originalWeight||snapshot.weight)-0.005) return 'PARTIALLY LIQUIDATED';
  return 'ACTIVE';
}
function poolInventoryClassification(pool,snapshot=inventoryPoolSnapshot(pool)){
  if(pool.onHold) return 'On Hold';
  if(pool.inventoryStatus==='For Refining') return 'For Refining';
  const activeItems=snapshot.items.filter(item=>Number(item.currentWeight||0)>0);
  return activeItems.length&&activeItems.every(item=>item.status==='For Refining')?'For Refining':'Available';
}
function setInventoryPoolClassification(pool,status){
  if(!pool||!['Available','For Refining','On Hold'].includes(status)) return false;
  pool.onHold=status==='On Hold';
  pool.inventoryStatus=status==='For Refining'?'For Refining':'Available';
  inventoryPoolItems(pool).forEach(item=>{
    if(Number(item.currentWeight||0)>0) item.status=status;
  });
  pool.updatedAt=new Date().toISOString();
  syncInventoryPool(pool);
  return true;
}
function syncInventoryPool(pool){
  const snapshot=inventoryPoolSnapshot(pool);
  pool.remainingWeight=snapshot.weight; pool.remainingCost=snapshot.cost; pool.status=inventoryPoolStatus(pool,snapshot);
  pool.updatedAt=pool.updatedAt||pool.createdAt||new Date().toISOString();
  return snapshot;
}
function syncAllInventoryPools(){
  (db.inventoryPools||[]).forEach(pool=>syncInventoryPool(pool));
}
function inventoryDisplayRows(records){
  const rows=[],seenPools=new Set();
  records.forEach(item=>{
    if(!item.inventoryPoolId){rows.push({...item,isInventoryPool:false});return;}
    if(seenPools.has(item.inventoryPoolId)) return;
    seenPools.add(item.inventoryPoolId);
    const pool=db.inventoryPools.find(candidate=>candidate.id===item.inventoryPoolId);
    if(!pool){rows.push({...item,isInventoryPool:false});return;}
    const snapshot=inventoryPoolSnapshot(pool);
    if(snapshot.weight<=0) return;
    const composition=inventoryPoolComposition(snapshot.items);
    const types=Array.from(new Set(snapshot.items.map(source=>source.itemType).filter(Boolean)));
    const dates=snapshot.items.map(source=>source.date).filter(Boolean).sort();
    const recordedAt=snapshot.items.map(source=>String(source.recordedAt||source.date||'')).filter(Boolean).sort().at(-1)||'';
    rows.push({
      id:pool.id,
      date:dates.at(-1)||String(pool.createdAt||'').slice(0,10)||todayStr(),
      customerName:pool.name||pool.id,
      metal:composition.metal,
      karat:composition.karat,
      itemType:types.length===1?types[0]:'Mixed',
      status:poolInventoryClassification(pool,snapshot),
      currentWeight:snapshot.weight,
      cost:snapshot.cost,
      remarks:pool.notes||`${pool.itemIds.length} pooled inventory records`,
      recordedAt,
      inventoryPoolId:pool.id,
      isInventoryPool:true
    });
  });
  return rows;
}
function inventoryTransactionSortKey(record){ return String(record?.recordedAt||record?.date||''); }
function poolableInventoryItem(item){
  return activeInventoryRecord(item)&&!item.inventoryPoolId&&!item.liquidationBatchId;
}
function selectedInventoryForPool(){ return db.stock.filter(item=>inventoryMoveSelection.has(item.id)&&poolableInventoryItem(item)); }
function selectedExistingPoolsForPooling(){
  return (db.inventoryPools||[]).filter(pool=>inventoryPoolRowSelection.has(pool.id)&&inventoryPoolSnapshot(pool).weight>0);
}
function inventoryPoolingSelection(){
  const items=selectedInventoryForPool(),pools=selectedExistingPoolsForPooling();
  if(pools.length>1) return {items,pools,valid:false};
  return {items,pools,valid:pools.length===1?items.length>=1:items.length>=2};
}
function inventoryPoolMergeSelection(){
  const pools=Array.from(inventoryPoolRowSelection,id=>db.inventoryPools.find(pool=>pool.id===id)).filter(pool=>pool&&inventoryPoolSnapshot(pool).weight>0);
  return {pools,valid:pools.length>=2};
}
function toggleInventoryPoolSelection(id,checked){
  const pool=db.inventoryPools.find(item=>item.id===id);
  if(!pool||inventoryPoolSnapshot(pool).weight<=0) return;
  if(checked) inventoryPoolRowSelection.add(id); else inventoryPoolRowSelection.delete(id);
  render();
}
function closeInventoryPoolMergeModal(){document.getElementById('inventory_pool_merge_modal')?.remove();}
function remapMergedPoolReferences(sourcePoolIds,targetPoolId){
  const sources=new Set(sourcePoolIds.filter(id=>id&&id!==targetPoolId));
  const remapRecord=record=>{
    if(!record) return;
    if(sources.has(record.poolId)){
      record.originalPoolId=record.originalPoolId||record.poolId;
      record.poolId=targetPoolId;
    }
    if(Array.isArray(record.poolIds)) record.poolIds=Array.from(new Set(record.poolIds.map(id=>sources.has(id)?targetPoolId:id)));
    (record.lines||[]).forEach(line=>{
      if(!sources.has(line.sourcePoolId)) return;
      line.originalSourcePoolId=line.originalSourcePoolId||line.sourcePoolId;
      line.sourcePoolId=targetPoolId;
    });
  };
  (db.liquidationBatches||[]).forEach(remapRecord);
  (db.liquidations||[]).forEach(remapRecord);
}
function mergeInventoryPoolRecords(pools,name=''){
  const selected=Array.from(new Map((pools||[]).filter(Boolean).map(pool=>[pool.id,pool])).values());
  if(selected.length<2||selected.some(pool=>!db.inventoryPools.includes(pool)||inventoryPoolSnapshot(pool).weight<=0)) return null;
  const target=selected[0],selectedIds=selected.map(pool=>pool.id),selectedIdSet=new Set(selectedIds);
  const items=Array.from(new Map(selected.flatMap(pool=>inventoryPoolItems(pool)).map(item=>[item.id,item])).values());
  if(!items.length) return null;
  const originalItems=Array.from(new Map(selected.flatMap(pool=>{
    if(pool.originalItems?.length) return pool.originalItems;
    return inventoryPoolItems(pool).map(item=>({itemId:item.id,originalWeight:roundWeight(Number(item.netWeight||item.currentWeight||0)),originalCost:roundMoney(Number(item.payout??item.cost??0)),statusAtPooling:item.status}));
  }).map(item=>[item.itemId,item])).values());
  const originalWeight=roundWeight(selected.reduce((sum,pool)=>{
    const recorded=Number(pool.originalWeight);
    return sum+(Number.isFinite(recorded)&&recorded>0?recorded:(pool.originalItems||[]).reduce((total,item)=>total+Number(item.originalWeight||0),0)||inventoryPoolSnapshot(pool).weight);
  },0));
  const originalCost=roundMoney(selected.reduce((sum,pool)=>{
    const recorded=Number(pool.originalCost);
    return sum+(Number.isFinite(recorded)&&recorded>=0?recorded:(pool.originalItems||[]).reduce((total,item)=>total+Number(item.originalCost||0),0)||inventoryPoolSnapshot(pool).cost);
  },0));
  const composition=inventoryPoolComposition(items),mergedFromPoolIds=Array.from(new Set(selected.flatMap(pool=>[...(pool.mergedFromPoolIds||[]),pool.id])));
  const mergedPoolHistory=selected.flatMap(pool=>[
    ...(pool.mergedPoolHistory||[]),
    {id:pool.id,name:pool.name||'',metal:pool.metal||'',karat:pool.karat||'',itemIds:[...(pool.itemIds||[])],originalItems:JSON.parse(JSON.stringify(pool.originalItems||[])),originalWeight:Number(pool.originalWeight||0),originalCost:Number(pool.originalCost||0),remainingWeight:inventoryPoolSnapshot(pool).weight,remainingCost:inventoryPoolSnapshot(pool).cost,status:inventoryPoolStatus(pool),onHold:pool.onHold===true,notes:pool.notes||'',createdAt:pool.createdAt||'',createdBy:pool.createdBy||'',mergedAt:new Date().toISOString()}
  ]);
  target.name=String(name||'').trim()||target.name||`${composition.label} pool`;
  target.metal=composition.metal;target.karat=composition.karat;target.itemIds=items.map(item=>item.id);target.originalItems=originalItems;
  target.originalWeight=originalWeight;target.originalCost=originalCost;target.mergedFromPoolIds=mergedFromPoolIds;target.mergedPoolHistory=mergedPoolHistory;target.onHold=false;target.updatedAt=new Date().toISOString();
  items.forEach(item=>{item.inventoryPoolId=target.id;if(Number(item.currentWeight||0)>0)item.status='Available';});
  remapMergedPoolReferences(selectedIds,target.id);
  db.inventoryPools=db.inventoryPools.filter(pool=>!selectedIdSet.has(pool.id)||pool.id===target.id);
  syncInventoryPool(target);
  return target;
}
function openInventoryPoolMergeModal(){
  if(!adminEditGuard()) return;
  const selection=inventoryPoolMergeSelection();
  if(!selection.valid){toast('Select at least two inventory pools to merge');return;}
  const snapshots=selection.pools.map(pool=>({pool,snapshot:inventoryPoolSnapshot(pool)}));
  const totalWeight=roundWeight(snapshots.reduce((sum,entry)=>sum+entry.snapshot.weight,0)),totalCost=roundMoney(snapshots.reduce((sum,entry)=>sum+entry.snapshot.cost,0));
  const modal=document.createElement('div');modal.id='inventory_pool_merge_modal';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="inventory-move-modal" role="dialog" aria-modal="true" aria-labelledby="inventory_pool_merge_title"><div class="summary-modal-head"><div><div class="eyebrow">Combine pooled inventory</div><h2 id="inventory_pool_merge_title">Merge ${selection.pools.length} selected pools</h2></div><button class="modal-close" onclick="closeInventoryPoolMergeModal()" aria-label="Close">×</button></div><p class="move-confirmation-intro">The selected pools will become one Available pool in Stock Records. Original inventory records and liquidation history remain traceable.</p><div class="field"><label for="inventory_pool_merge_name">Merged pool name</label><input id="inventory_pool_merge_name" value="${esc(selection.pools[0].name||'')}" placeholder="Combined inventory pool"></div><div class="move-confirmation-summary"><div><span>Selected pools</span><strong>${selection.pools.length}</strong></div><div><span>Total weight</span><strong>${fmtWeight(totalWeight)}</strong></div><div><span>Total cost</span><strong>${fmtMoney(totalCost)}</strong></div><div><span>Status after merge</span><strong>Available</strong></div></div><div class="table-wrap move-confirmation-items"><table><thead><tr><th>Pool</th><th>Contents</th><th class="num-head">Weight</th><th class="num-head">Cost</th></tr></thead><tbody>${snapshots.map(({pool,snapshot})=>`<tr><td><strong>${esc(pool.name||pool.id)}</strong><br><span class="form-note">${esc(pool.id)}</span></td><td>${snapshot.items.length} item${snapshot.items.length===1?'':'s'}</td><td class="num">${fmtWeight(snapshot.weight)}</td><td class="num">${fmtMoney(snapshot.cost)}</td></tr>`).join('')}</tbody></table></div><div class="move-confirmation-note"><strong>Confirm merge</strong><span>${esc(selection.pools[0].id)} will remain as the pool ID. The other selected pool IDs will be retained in trace history.</span></div><div class="form-actions"><button class="btn secondary" onclick="closeInventoryPoolMergeModal()">Cancel</button><button class="btn" id="confirm_inventory_pool_merge" onclick="confirmInventoryPoolMerge()">Confirm merge</button></div></div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeInventoryPoolMergeModal();});document.body.appendChild(modal);
}
async function confirmInventoryPoolMerge(){
  if(inventoryPoolMergeSaving) return;
  const selection=inventoryPoolMergeSelection();
  if(!selection.valid){closeInventoryPoolMergeModal();toast('The pool selection changed. Select at least two pools again.');return;}
  const button=document.getElementById('confirm_inventory_pool_merge');inventoryPoolMergeSaving=true;if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
  const beforeState=JSON.parse(JSON.stringify(db));
  try{
    const target=mergeInventoryPoolRecords(selection.pools,val('inventory_pool_merge_name'));
    if(!target){db=beforeState;toast('The selected pools could not be merged');return;}
    if(!await saveDB()){db=beforeState;render();toast('The selected pools were not merged');return;}
    inventoryMoveSelection.clear();inventoryPoolRowSelection.clear();closeInventoryPoolMergeModal();render();toast(`${selection.pools.length} pools merged into ${target.id}`);
  } finally {
    inventoryPoolMergeSaving=false;
    const currentButton=document.getElementById('confirm_inventory_pool_merge');if(currentButton){currentButton.disabled=false;currentButton.removeAttribute('aria-busy');}
  }
}
function inventoryPoolComposition(items){
  const metals=Array.from(new Set(items.map(item=>String(item.metal||''))));
  const grades=Array.from(new Set(items.map(item=>String(item.karat||''))));
  const mixedMetals=metals.length!==1,mixedPurities=grades.length!==1;
  const metal=mixedMetals?'Mixed':metals[0]||'Mixed';
  const karat=mixedMetals||mixedPurities?'Mixed':grades[0]||'Mixed';
  const label=mixedMetals?'Mixed metals / purities':mixedPurities?`${metal} · Mixed purities`:`${metal} ${gradeLabel(metal,karat)}`;
  return {metal,karat,label};
}
function preparePooledInventoryAllocation(items,requestedWeight,costBasisOverride=null){
  const weight=roundWeight(Number(requestedWeight));
  const totalWeight=roundWeight(items.reduce((sum,item)=>sum+Number(item.currentWeight||0),0));
  const totalCost=roundMoney(items.reduce((sum,item)=>sum+Number(item.cost||0),0));
  if(!weight||weight<0.01||weight>totalWeight) return null;
  const full=weight>=totalWeight-0.005;
  const automaticCost=roundMoney(totalCost*(weight/totalWeight));
  const hasCostBasisOverride=costBasisOverride!==null&&costBasisOverride!==''&&costBasisOverride!==undefined;
  const requestedCost=Number(costBasisOverride);
  if(hasCostBasisOverride&&(!Number.isFinite(requestedCost)||requestedCost<0||(!full&&requestedCost>totalCost+0.01))) return null;
  const cost=hasCostBasisOverride?roundMoney(full?requestedCost:Math.min(requestedCost,totalCost)):automaticCost;
  const averageCost=totalCost/totalWeight;
  let weightLeft=weight,costAssigned=0;
  const allocations=[];
  for(const item of items){
    if(weightLeft<=0) break;
    const portion=roundWeight(Math.min(Number(item.currentWeight||0),weightLeft));
    if(portion<=0) continue;
    weightLeft=roundWeight(weightLeft-portion);
    const portionCost=weightLeft<=0?roundMoney(cost-costAssigned):roundMoney(cost*(portion/weight));
    costAssigned=roundMoney(costAssigned+portionCost);
    allocations.push({itemId:item.id,previousStatus:item.status,weight:portion,cost:portionCost,automaticCost:roundMoney(automaticCost*(portion/weight)),costBasisOverridden:hasCostBasisOverride,pooledAllocation:true});
  }
  if(weightLeft>0.005) return null;
  return {weight,cost,automaticCost,costBasisOverridden:hasCostBasisOverride,totalWeight,totalCost,averageCost,remainingWeight:roundWeight(totalWeight-weight),remainingCost:full?0:roundMoney(totalCost-cost),allocations};
}
function applyPooledInventoryAllocation(prepared){
  if(!prepared) return false;
  const resolved=prepared.allocations.map(line=>({line,item:db.stock.find(stock=>stock.id===line.itemId)}));
  if(resolved.some(({line,item})=>!item||Number(item.currentWeight)+0.005<Number(line.weight))) return false;
  for(const {line,item} of resolved){
    item.currentWeight=roundWeight(Number(item.currentWeight)-Number(line.weight));
  }
  const pooledIds=new Set(prepared.allocations.map(line=>line.itemId));
  const sourceItems=db.stock.filter(item=>pooledIds.has(item.id)||prepared.sourceIds?.includes(item.id));
  const poolItems=prepared.poolItems||sourceItems;
  const remainingItems=poolItems.filter(item=>Number(item.currentWeight)>0);
  let assignedCost=0;
  poolItems.filter(item=>Number(item.currentWeight)<=0).forEach(item=>{item.cost=0;});
  remainingItems.forEach((item,index)=>{
    const cost=index===remainingItems.length-1?roundMoney(prepared.remainingCost-assignedCost):roundMoney(prepared.remainingCost*(Number(item.currentWeight)/prepared.remainingWeight));
    item.cost=Math.max(0,cost); assignedCost=roundMoney(assignedCost+item.cost);
  });
  return true;
}
function restorePooledLiquidationLine(line){
  const item=db.stock.find(stock=>stock.id===line.itemId);
  if(!item) return false;
  item.currentWeight=roundWeight(Number(item.currentWeight)+Number(line.weight||0));
  item.cost=roundMoney(Number(item.cost)+Number(line.cost??line.costPortion??0));
  if(item.currentWeight>0&&['Liquidated','Refined','Sold'].includes(item.status)) item.status=line.previousStatus||'Available';
  return true;
}
function closeInventoryPoolModal(){ document.getElementById('inventory_pool_modal')?.remove(); }
function openManualInventoryPoolModal(){
  if(!adminEditGuard()) return;
  const selection=inventoryPoolingSelection(),existingPool=selection.pools[0]||null;
  if(!selection.valid){toast(existingPool?'Select at least one unpooled item to add to this pool':'Select at least two unpooled items, or select one pool and more inventory');return;}
  const items=[...(existingPool?inventoryPoolItems(existingPool):[]),...selection.items];
  const weight=items.reduce((sum,item)=>sum+Number(item.currentWeight||0),0),cost=items.reduce((sum,item)=>sum+Number(item.cost||0),0);
  const nextId=existingPool?.id||nextSequenceId('POOL',db.inventoryPools),composition=inventoryPoolComposition(items);
  const modal=document.createElement('div');modal.id='inventory_pool_modal';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="inventory-move-modal" role="dialog" aria-modal="true" aria-labelledby="inventory_pool_title"><div class="summary-modal-head"><div><div class="eyebrow">Manual inventory grouping</div><h2 id="inventory_pool_title">${existingPool?'Add inventory to':'Create'} ${esc(nextId)}</h2></div><button class="modal-close" onclick="closeInventoryPoolModal()" aria-label="Close">×</button></div><p class="move-confirmation-intro">${existingPool?'The selected records will be added to this pool, which remains one row in Stock Records.':'The selected records will become one Available pool in Stock Records.'} Their original purchase history remains traceable.</p><div class="form-grid"><div class="field"><label>Pool name (optional)</label><input id="inventory_pool_name" value="${esc(existingPool?.name||'')}" placeholder="${esc(composition.label)} pool"></div><div class="field"><label>Status after pooling</label><input value="${existingPool?.onHold?'On Hold':'Available'}" disabled></div><div class="field span-2"><label>Notes</label><input id="inventory_pool_notes" value="${esc(existingPool?.notes||'')}" placeholder="Optional"></div></div><div class="move-confirmation-summary"><div><span>${existingPool?'New records':'Selected records'}</span><strong>${selection.items.length}</strong></div><div><span>Pool contents</span><strong>${esc(composition.label)}</strong></div><div><span>Total weight</span><strong>${fmtWeight(weight)}</strong></div><div><span>Total cost</span><strong>${fmtMoneyExact(cost)}</strong></div></div><div class="table-wrap move-confirmation-items"><table><thead><tr><th>Item</th><th>Seller</th><th>Date</th><th class="num-head">Weight</th><th class="num-head">Cost</th></tr></thead><tbody>${items.map(item=>`<tr><td>${esc(item.metal)} ${esc(gradeLabel(item.metal,item.karat))}</td><td>${esc(item.customerName||'—')}</td><td>${fmtDate(item.date)}</td><td class="num">${fmtWeight(item.currentWeight)}</td><td class="num">${fmtMoneyExact(item.cost)}</td></tr>`).join('')}</tbody></table></div><div class="form-actions"><button class="btn secondary" onclick="closeInventoryPoolModal()">Cancel</button><button class="btn" onclick="createManualInventoryPool()">${existingPool?'Add to Pool':'Create Available Pool'}</button></div></div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeInventoryPoolModal();});document.body.appendChild(modal);
}
async function createManualInventoryPool(){
  const selection=inventoryPoolingSelection(),existingPool=selection.pools[0]||null;
  if(!selection.valid){closeInventoryPoolModal();toast('The pooling selection changed. Select the pool and inventory again.');return;}
  const items=selection.items,beforeState=JSON.parse(JSON.stringify(db)),id=existingPool?.id||nextSequenceId('POOL',db.inventoryPools);
  const combinedItems=[...(existingPool?inventoryPoolItems(existingPool):[]),...items],composition=inventoryPoolComposition(combinedItems);
  const addedOriginalItems=items.map(item=>({itemId:item.id,originalWeight:roundWeight(item.currentWeight),originalCost:roundMoney(item.cost),statusAtPooling:item.status}));
  const addedWeight=roundWeight(addedOriginalItems.reduce((sum,item)=>sum+item.originalWeight,0)),addedCost=roundMoney(addedOriginalItems.reduce((sum,item)=>sum+item.originalCost,0));
  const onHold=existingPool?.onHold||false;
  const pool=existingPool||{id,itemIds:[],originalItems:[],originalWeight:0,originalCost:0,onHold,createdAt:new Date().toISOString(),createdBy:currentUser?.displayName||''};
  pool.name=val('inventory_pool_name').trim()||pool.name||`${composition.label} pool`;pool.metal=composition.metal;pool.karat=composition.karat;
  pool.itemIds=[...(pool.itemIds||[]),...items.map(item=>item.id)];pool.originalItems=[...(pool.originalItems||[]),...addedOriginalItems];
  pool.originalWeight=roundWeight(Number(pool.originalWeight||0)+addedWeight);pool.originalCost=roundMoney(Number(pool.originalCost||0)+addedCost);
  pool.notes=val('inventory_pool_notes').trim();pool.updatedAt=new Date().toISOString();
  items.forEach(item=>{item.inventoryPoolId=id;item.status=onHold?'On Hold':'Available';});if(!existingPool)db.inventoryPools.push(pool);syncInventoryPool(pool);
  if(!await saveDB()){db=beforeState;render();toast('The inventory pool was not created');return;}
  inventoryMoveSelection.clear();inventoryPoolRowSelection.clear();closeInventoryPoolModal();render();toast(existingPool?`${items.length} ${items.length===1?'item':'items'} added to ${id}`:`${id} created from ${items.length} selected items`);
}
async function toggleInventoryPoolHold(id){
  const pool=db.inventoryPools.find(item=>item.id===id);if(!pool||inventoryPoolStatus(pool)==='FULLY LIQUIDATED'||!adminEditGuard())return;
  const before=pool.onHold,items=inventoryPoolItems(pool),previousStatuses=new Map(items.map(item=>[item.id,item.status]));
  pool.onHold=!pool.onHold;items.forEach(item=>{item.status=pool.onHold?'On Hold':'Available';});pool.updatedAt=new Date().toISOString();syncInventoryPool(pool);
  if(!await saveDB()){pool.onHold=before;items.forEach(item=>{item.status=previousStatuses.get(item.id)||item.status;});syncInventoryPool(pool);render();return;}render();toast(`${pool.id} is now ${pool.onHold?'ON HOLD':'AVAILABLE'}`);
}
function closePoolLiquidationModal(){document.getElementById('pool_liquidation_modal')?.remove();}
function poolLiquidationRequestedWeight(pool){
  const snapshot=inventoryPoolSnapshot(pool),type=document.querySelector('input[name="pool_liquidation_type"]:checked')?.value||'partial';
  return type==='entire'?snapshot.weight:roundWeight(Number(val('pool_liquidation_weight'))||0);
}
function poolLiquidationCostBasis(){
  const input=document.getElementById('pool_liquidation_cost');
  if(!input||input.dataset.automatic==='true'||!String(input.value||'').trim()) return null;
  return Number(input.value);
}
function markPoolLiquidationCostOverride(){
  const input=document.getElementById('pool_liquidation_cost');
  if(input) input.dataset.automatic='false';
  updatePoolLiquidationPreview();
}
function resetPoolLiquidationCostBasis(){
  const input=document.getElementById('pool_liquidation_cost');
  if(input){input.dataset.automatic='true';input.value='';}
  updatePoolLiquidationPreview();
}
function updatePoolLiquidationPreview(){
  const pool=db.inventoryPools.find(item=>item.id===val('pool_liquidation_id'));if(!pool)return;
  const snapshot=inventoryPoolSnapshot(pool),entire=document.querySelector('input[name="pool_liquidation_type"]:checked')?.value==='entire';
  const input=document.getElementById('pool_liquidation_weight');if(input){input.disabled=entire;if(entire)input.value=String(snapshot.weight);}
  const costInput=document.getElementById('pool_liquidation_cost');
  const requested=poolLiquidationRequestedWeight(pool),automatic=preparePooledInventoryAllocation(snapshot.items,requested);
  if(costInput&&(costInput.dataset.automatic==='true'||!String(costInput.value||'').trim())){costInput.value=automatic?String(automatic.cost):'';costInput.dataset.automatic='true';}
  const prepared=preparePooledInventoryAllocation(snapshot.items,requested,poolLiquidationCostBasis());
  const fullWeight=automatic&&Math.abs(Number(automatic.weight)-Number(snapshot.weight))<0.005;
  if(costInput) costInput.setCustomValidity(prepared?'':fullWeight?'Enter a non-negative cost basis.':'Enter a cost basis from PHP 0 to the total pool cost.');
  const values={
    pool_liquidation_available:fmtWeight(snapshot.weight),pool_liquidation_average:snapshot.weight?`${fmtMoneyExact(snapshot.averageCost)}/g`:'—',pool_liquidation_automatic_cost:automatic?fmtMoneyExact(automatic.cost):'—',pool_liquidation_remaining:prepared?`${fmtWeight(prepared.remainingWeight)} · ${fmtMoneyExact(prepared.remainingCost)}`:`${fmtWeight(snapshot.weight)} · ${fmtMoneyExact(snapshot.cost)}`
  };
  Object.entries(values).forEach(([id,value])=>{const element=document.getElementById(id);if(element)element.textContent=value;});
  const button=document.getElementById('confirm_pool_liquidation');
  if(button) button.disabled=!prepared||!val('pool_liquidation_destination');
}
function changePoolLiquidationDestination(value){
  const creating=value==='new';
  const details=document.getElementById('pool_liquidation_new_batch_fields');
  if(details)details.classList.toggle('is-hidden',!creating);
  const button=document.getElementById('confirm_pool_liquidation'),batch=!creating?db.liquidationBatches.find(item=>item.id===value):null;
  if(button) button.textContent=batch?`Add to ${batch.id}`:'Move to Liquidation';
  updatePoolLiquidationPreview();
}
function openPoolLiquidationModal(id){
  const pool=db.inventoryPools.find(item=>item.id===id);if(!pool||!adminEditGuard())return;const snapshot=inventoryPoolSnapshot(pool);if(!snapshot.weight){toast('This pool is fully liquidated');return;}
  const openBatches=db.liquidationBatches||[];
  closePoolLiquidationModal();const modal=document.createElement('div');modal.id='pool_liquidation_modal';modal.className='modal-backdrop';
  modal.innerHTML=`<div class="summary-modal" role="dialog" aria-modal="true" aria-labelledby="pool_liquidation_title"><div class="summary-modal-head"><div><div class="eyebrow">${esc(pool.id)} · Available</div><h2 id="pool_liquidation_title">Move ${esc(pool.name)} to Liquidation</h2></div><button class="modal-close" onclick="closePoolLiquidationModal()" aria-label="Close">×</button></div><p class="move-confirmation-intro">Choose a partial weight or the entire pool, then choose whether to create a new batch or add it to an existing open batch.</p><input id="pool_liquidation_id" type="hidden" value="${esc(pool.id)}"><div class="field"><label for="pool_liquidation_destination">Liquidation destination</label><select id="pool_liquidation_destination" required onchange="changePoolLiquidationDestination(this.value)"><option value="" selected disabled>Select a liquidation destination</option><option value="new">Create new liquidation batch</option>${openBatches.map(batch=>`<option value="${esc(batch.id)}">Add to existing open batch · ${esc(batch.id)} · ${esc(batch.name)}</option>`).join('')}</select>${openBatches.length?'':'<span class="form-note">No open batch is currently available. Select “Create new liquidation batch”.</span>'}</div><div class="field"><label>Liquidation type</label><div class="pool-liquidation-types"><label><input type="radio" name="pool_liquidation_type" value="partial" onchange="updatePoolLiquidationPreview()" checked> Partial</label><label><input type="radio" name="pool_liquidation_type" value="entire" onchange="updatePoolLiquidationPreview()"> Entire pool</label></div></div><div class="form-grid"><div class="field"><label>Weight for liquidation (g)</label><input id="pool_liquidation_weight" type="number" min="0.01" max="${snapshot.weight}" step="0.01" oninput="updatePoolLiquidationPreview()"></div><div class="field"><label>Cost basis (PHP)</label><input id="pool_liquidation_cost" type="number" min="0" step="0.01" data-automatic="true" oninput="markPoolLiquidationCostOverride()"><span class="form-note">Automatic from the pool mean cost. You may override it.</span><button class="link-button" type="button" onclick="resetPoolLiquidationCostBasis()">Reset automatic cost</button></div></div><div id="pool_liquidation_new_batch_fields" class="form-grid"><div class="field"><label>Assigned buyer</label><input id="pool_liquidation_buyer" placeholder="Buyer name"></div><div class="field"><label>Batch name</label><input id="pool_liquidation_name" value="${esc(pool.name)} liquidation"></div><div class="field span-2"><label>Notes</label><textarea id="pool_liquidation_notes"></textarea></div></div><div class="move-confirmation-summary"><div><span>Available in pool</span><strong id="pool_liquidation_available">${fmtWeight(snapshot.weight)}</strong></div><div><span>Mean cost / g</span><strong id="pool_liquidation_average">${fmtMoneyExact(snapshot.averageCost)}/g</strong></div><div><span>Automatic cost</span><strong id="pool_liquidation_automatic_cost">—</strong></div><div><span>Remaining in inventory</span><strong id="pool_liquidation_remaining">—</strong></div></div><div class="form-actions"><button class="btn secondary" onclick="closePoolLiquidationModal()">Cancel</button><button class="btn" id="confirm_pool_liquidation" onclick="confirmPoolLiquidation()" disabled>Move to Liquidation</button></div></div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closePoolLiquidationModal();});document.body.appendChild(modal);updatePoolLiquidationPreview();
}
function stagePoolLiquidationBatch(pool,prepared,details){
  prepared.poolItems=inventoryPoolItems(pool);
  if(!applyPooledInventoryAllocation(prepared)) return null;
  const id=nextSequenceId('LB',db.liquidationBatches),createdAt=new Date().toISOString();
  const lines=prepared.allocations.map(line=>{
    const source=db.stock.find(item=>item.id===line.itemId);
    return {...line,metal:source?.metal||pool.metal,assay:source?.karat||pool.karat,cost:line.cost};
  });
  const batch={id,name:details.name,buyer:details.buyer,metal:pool.metal,poolId:pool.id,poolName:pool.name,lines,notes:details.notes,createdAt,createdBy:currentUser?.displayName||''};
  db.liquidationBatches.push(batch);
  const remaining=syncInventoryPool(pool);pool.updatedAt=createdAt;
  return {batch,remaining};
}
function prepareEntirePoolMove(pool){
  return preparePoolMove(pool,inventoryPoolSnapshot(pool).weight);
}
function preparePoolMove(pool,requestedWeight,costBasisOverride=null){
  const snapshot=inventoryPoolSnapshot(pool),prepared=preparePooledInventoryAllocation(snapshot.items,requestedWeight,costBasisOverride);
  if(!prepared) return null;
  return {poolId:pool.id,prepared,allocations:prepared.allocations.map(line=>({...line,sourcePoolId:pool.id}))};
}
function refreshLiquidationBatchMetal(batch){
  const metals=Array.from(new Set((batch.lines||[]).map(line=>db.stock.find(item=>item.id===line.itemId)?.metal).filter(Boolean)));
  batch.metal=metals.length===1?metals[0]:'Mixed';
}
function appendPoolMovesToLiquidationBatch(batch,poolMoves){
  for(const move of poolMoves||[]){
    const pool=db.inventoryPools.find(item=>item.id===move.poolId);
    if(!pool) return false;
    move.prepared.poolItems=inventoryPoolItems(pool);
    if(!applyPooledInventoryAllocation(move.prepared)) return false;
    batch.lines.push(...move.allocations.map(line=>({...line})));
    syncInventoryPool(pool);pool.updatedAt=new Date().toISOString();
  }
  refreshLiquidationBatchMetal(batch);
  return true;
}
function syncPoolsForLiquidationLines(lines,extraPoolId=''){
  const ids=new Set([extraPoolId,...(lines||[]).map(line=>line.sourcePoolId)].filter(Boolean));
  ids.forEach(id=>{const pool=db.inventoryPools.find(item=>item.id===id);if(pool)syncInventoryPool(pool);});
  return Array.from(ids);
}
async function confirmPoolLiquidation(){
  const pool=db.inventoryPools.find(item=>item.id===val('pool_liquidation_id'));if(!pool)return;const snapshot=inventoryPoolSnapshot(pool),requested=poolLiquidationRequestedWeight(pool),costBasisOverride=poolLiquidationCostBasis(),prepared=preparePooledInventoryAllocation(snapshot.items,requested,costBasisOverride);
  const destination=val('pool_liquidation_destination')||'new';
  const buyer=val('pool_liquidation_buyer').trim(),name=val('pool_liquidation_name').trim(),notes=val('pool_liquidation_notes').trim();
  if(!val('pool_liquidation_destination')){toast('Select a liquidation destination');document.getElementById('pool_liquidation_destination')?.focus();return;}
  if(!prepared){toast(`Enter a valid weight and a cost basis from PHP 0 to ${fmtMoneyExact(snapshot.cost)}`);return;}
  if(destination!=='new'){
    const batch=db.liquidationBatches.find(record=>record.id===destination);
    if(!batch){toast('The selected liquidation batch is no longer available');return;}
    const beforeState=JSON.parse(JSON.stringify(db)),move=preparePoolMove(pool,requested,costBasisOverride);
    if(!move||!appendPoolMovesToLiquidationBatch(batch,[move])){db=beforeState;toast('The pool could not be added to this liquidation batch');return;}
    delete batch.buyerOffer;refreshLiquidationBatchMetal(batch);
    if(!await saveDB()){db=beforeState;render();toast('The pool was not added to the liquidation batch');return;}
    closePoolLiquidationModal();goTab('liquidation');toast(`${fmtWeight(prepared.weight)} added to ${batch.id} at ${fmtMoneyExact(prepared.cost)} cost`);return;
  }
  if(!buyer||!name){toast('Enter a batch name and assigned buyer');return;}
  const beforeState=JSON.parse(JSON.stringify(db)),result=stagePoolLiquidationBatch(pool,prepared,{buyer,name,notes});
  if(!result){toast('The pool balance changed. Review it and try again.');return;}
  if(!await saveDB()){db=beforeState;render();toast('The pool was not moved to Liquidation');return;}
  closePoolLiquidationModal();goTab('liquidation');toast(`${fmtWeight(prepared.weight)} moved to ${result.batch.id} at ${fmtMoneyExact(prepared.cost)} cost`);
}
function liquidateInventoryItem(id){
  const item=db.stock.find(stock=>stock.id===id);
  if(!item||!movableInventory(item)){ toast('This inventory item is no longer available'); return; }
  inventoryMoveSelection.clear(); inventoryMoveSelection.add(id);
  openInventoryMoveReview([item],{total:1,automatic:false,individual:true});
}
function prepareInventoryItemAllocation(item,requestedWeight,costBasisOverride=null){
  const availableWeight=roundWeight(Number(item?.currentWeight||0)),availableCost=roundMoney(Number(item?.cost||0));
  const weight=roundWeight(Number(requestedWeight));
  if(!item||weight<0.01||weight>availableWeight+0.005) return null;
  const full=weight>=availableWeight-0.005;
  const allocatedWeight=full?availableWeight:weight;
  const automaticCost=full?availableCost:roundMoney(availableCost*(allocatedWeight/availableWeight));
  const hasCostBasisOverride=costBasisOverride!==null&&costBasisOverride!==''&&costBasisOverride!==undefined;
  const requestedCost=Number(costBasisOverride);
  // A full move can be revalued before it enters liquidation. A partial move
  // must still leave a non-negative carrying cost in Inventory.
  if(hasCostBasisOverride&&(!Number.isFinite(requestedCost)||requestedCost<0||(!full&&requestedCost>availableCost+0.01))) return null;
  const cost=hasCostBasisOverride?roundMoney(full?requestedCost:Math.min(requestedCost,availableCost)):automaticCost;
  return {itemId:item.id,previousStatus:item.status,weight:allocatedWeight,cost,automaticCost,originalCost:availableCost,costBasisOverridden:hasCostBasisOverride,pooledAllocation:!full,partialAllocation:!full,remainingWeight:roundWeight(availableWeight-allocatedWeight),remainingCost:full?0:roundMoney(availableCost-cost)};
}
function inventoryMoveCostBasis(id){
  const input=document.getElementById(`inventory_move_cost_${id}`);
  if(!input||input.dataset.automatic==='true'||!String(input.value||'').trim()) return null;
  return Number(input.value);
}
function markInventoryMoveCostOverride(id){
  const input=document.getElementById(`inventory_move_cost_${id}`);
  if(input) input.dataset.automatic='false';
  updateInventoryMovePartialPreview(id);
}
function resetInventoryMoveCostBasis(id){
  const input=document.getElementById(`inventory_move_cost_${id}`);
  if(input){input.dataset.automatic='true';input.value='';}
  updateInventoryMovePartialPreview(id);
}
function updateInventoryMovePartialPreview(id){
  const item=db.stock.find(stock=>stock.id===id),costInput=document.getElementById(`inventory_move_cost_${id}`),automatic=prepareInventoryItemAllocation(item,val(`inventory_move_weight_${id}`));
  if(costInput&&(costInput.dataset.automatic==='true'||!String(costInput.value||'').trim())){costInput.value=automatic?String(automatic.cost):'';costInput.dataset.automatic='true';}
  const allocation=prepareInventoryItemAllocation(item,val(`inventory_move_weight_${id}`),inventoryMoveCostBasis(id));
  const fullWeight=automatic&&Math.abs(Number(automatic.weight)-Number(item?.currentWeight||0))<0.005;
  if(costInput) costInput.setCustomValidity?.(allocation?'':fullWeight?'Enter a non-negative cost basis.':'Enter a cost basis from PHP 0 to the item’s current cost.');
  const automaticCost=document.getElementById(`inventory_move_automatic_cost_${id}`),weightTotal=document.getElementById('inventory_move_total_weight'),costTotal=document.getElementById('inventory_move_total_cost');
  if(automaticCost) automaticCost.textContent=automatic?fmtMoney(automatic.cost):'—';
  if(weightTotal) weightTotal.textContent=allocation?fmtWeight(allocation.weight):'—';
  if(costTotal) costTotal.textContent=allocation?fmtMoney(allocation.cost):'—';
  updateInventoryMoveContinueState();
}
function updateInventoryMovePoolPreview(id){
  const pending=pendingInventoryMove,pool=db.inventoryPools.find(item=>item.id===id);if(!pending||!pool)return;
  const requested=val(`inventory_move_pool_weight_${id}`);pending.poolWeights[id]=requested;
  const move=preparePoolMove(pool,requested),cost=document.getElementById(`inventory_move_cost_${id}`);
  if(cost)cost.textContent=move?fmtMoney(move.prepared.cost):'—';
  const itemWeight=(pending.ids||[]).reduce((sum,itemId)=>sum+Number(db.stock.find(item=>item.id===itemId)?.currentWeight||0),0);
  const itemCost=(pending.ids||[]).reduce((sum,itemId)=>sum+Number(db.stock.find(item=>item.id===itemId)?.cost||0),0);
  const poolMoves=(pending.poolIds||[]).map(poolId=>{
    const source=db.inventoryPools.find(item=>item.id===poolId);return source?preparePoolMove(source,pending.poolWeights[poolId]):null;
  });
  const valid=poolMoves.every(Boolean),weightTotal=document.getElementById('inventory_move_total_weight'),costTotal=document.getElementById('inventory_move_total_cost');
  if(weightTotal)weightTotal.textContent=valid?fmtWeight(itemWeight+poolMoves.reduce((sum,item)=>sum+Number(item.prepared.weight),0)):'—';
  if(costTotal)costTotal.textContent=valid?fmtMoney(itemCost+poolMoves.reduce((sum,item)=>sum+Number(item.prepared.cost),0)):'—';
  updateInventoryMoveContinueState();
}
function updateInventoryMoveContinueState(){
  const pending=pendingInventoryMove,button=document.getElementById('inventory_move_continue');if(!pending||!button)return;
  const destination=val('inventory_move_destination');
  const itemValid=pending.mode!=='individual'||(pending.ids||[]).every(id=>prepareInventoryItemAllocation(db.stock.find(item=>item.id===id),val(`inventory_move_weight_${id}`),inventoryMoveCostBasis(id)));
  const poolsValid=(pending.poolIds||[]).every(id=>{const pool=db.inventoryPools.find(item=>item.id===id);return pool&&preparePoolMove(pool,val(`inventory_move_pool_weight_${id}`)||pending.poolWeights?.[id]);});
  button.disabled=!destination||!itemValid||!poolsValid;
  const batch=destination&&destination!=='new'?db.liquidationBatches.find(item=>item.id===destination):null;
  button.textContent=batch?`Add to ${batch.id}`:'Continue to batch details';
}
function changeInventoryMoveDestination(value){if(pendingInventoryMove)pendingInventoryMove.destination=value||'';updateInventoryMoveContinueState();}
function openInventoryMoveReview(selected,context){
  const metals=Array.from(new Set(selected.map(item=>item.metal)));
  const dates=Array.from(new Set(selected.map(item=>item.date))).sort();
  const dateLabel=dates.length===1?fmtDate(dates[0]):`${fmtDate(dates[0])} – ${fmtDate(dates[dates.length-1])}`;
  const selectionLabel=context.individual?'Individual item':context.automatic?`${context.percentage}% · ${selected.length} of ${context.total}`:`${selected.length} selected record${selected.length===1?'':'s'}`;
  const mode=context.individual?'individual':dates.length>1?'combined':'selected';
  const poolIds=context.poolIds||[];
  pendingInventoryMove={percentage:context.percentage??null,total:context.total,ids:context.itemIds||selected.map(item=>item.id),poolIds,poolWeights:Object.fromEntries(poolIds.map(id=>[id,inventoryPoolSnapshot(db.inventoryPools.find(pool=>pool.id===id)).weight])),dates,metals,mode,destination:''};
  const totalWeight=selected.reduce((sum,item)=>sum+Number(item.currentWeight),0);
  const totalCost=selected.reduce((sum,item)=>sum+Number(item.cost),0);
  const openBatches=db.liquidationBatches||[];
  const modal=document.createElement('div');
  modal.id='inventory_move_confirmation'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="inventory-move-modal" role="dialog" aria-modal="true" aria-labelledby="inventory_move_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Review inventory movement</div><h2 id="inventory_move_title">Move ${selected.length} stock record${selected.length===1?'':'s'}?</h2></div><button class="modal-close" onclick="closeInventoryMoveConfirmation()" aria-label="Close">×</button></div>
    <p class="move-confirmation-intro">${metals.length>1?`The selected ${metals.map(esc).join(' and ')} records will stay together in one mixed-metal batch.`:context.combineDates?`The system automatically selected every eligible ${esc(metals[0])} stock record from the ${dates.length} chosen purchase date${dates.length===1?'':'s'}.`:context.automatic?`The system automatically selected ${selected.length} eligible stock record${selected.length===1?'':'s'} for this percentage.`:context.individual?'This item will be prepared as an individual liquidation.':dates.length>1?'Items from different purchase dates will be combined into one liquidation batch.':'The checked records will be combined into one liquidation batch.'} Review the items below before confirming. This step does not sell the stock or deduct its weight.</p>
    <div class="move-confirmation-summary">
      <div><span>Purchase date${dates.length===1?'':'s'}</span><strong>${dateLabel}</strong></div>
      <div><span>Selection</span><strong>${selectionLabel}</strong></div>
      <div><span>Total weight</span><strong id="inventory_move_total_weight">${fmtWeight(totalWeight)}</strong></div>
      <div><span>Inventory cost</span><strong id="inventory_move_total_cost">${fmtMoney(totalCost)}</strong></div>
    </div>
    <div class="field"><label for="inventory_move_destination">Liquidation destination</label><select id="inventory_move_destination" required onchange="changeInventoryMoveDestination(this.value)"><option value="" selected disabled>Select a liquidation destination</option><option value="new">Create new liquidation batch</option>${openBatches.map(batch=>`<option value="${esc(batch.id)}">Add to existing open batch · ${esc(batch.id)} · ${esc(batch.name)}</option>`).join('')}</select>${openBatches.length?'':'<span class="form-note">No open batch is currently available. Select “Create new liquidation batch”.</span>'}</div>
    <div class="table-wrap move-confirmation-items"><table><thead><tr><th>Inventory item</th><th>Customer</th><th>Status</th><th class="num-head">Weight moving</th><th class="num-head">Cost</th></tr></thead><tbody>
      ${selected.map(item=>`<tr><td><strong>${esc(item.metal)} ${esc(item.karat)}</strong><br><span class="form-note">${esc(item.itemType)}${item.remarks?' · '+esc(item.remarks):''}</span></td><td>${esc(item.customerName||'—')}</td><td>${statusPill(item.status)}</td><td class="num">${item.isInventoryPool?`<label class="field"><span class="form-note">Enter pool weight</span><input id="inventory_move_pool_weight_${item.inventoryPoolId}" type="number" min="0.01" max="${Number(item.currentWeight)}" step="0.01" value="${Number(item.currentWeight)}" oninput="updateInventoryMovePoolPreview('${item.inventoryPoolId}')"></label><span class="form-note">of ${fmtWeight(item.currentWeight)} in pool</span>`:context.individual?`<label class="field"><span class="form-note">Enter weight</span><input id="inventory_move_weight_${item.id}" type="number" min="0.01" max="${Number(item.currentWeight)}" step="0.01" value="${Number(item.currentWeight)}" oninput="updateInventoryMovePartialPreview('${item.id}')"></label><span class="form-note">of ${fmtWeight(item.currentWeight)} available</span>`:`<strong>${fmtWeight(item.currentWeight)}</strong><br><span class="form-note">full available weight</span>`}</td><td class="num">${context.individual?`<label class="field"><span class="form-note">Cost basis (PHP)</span><input id="inventory_move_cost_${item.id}" type="number" min="0" step="0.01" data-automatic="true" oninput="markInventoryMoveCostOverride('${item.id}')"><span class="form-note">Automatic: <strong id="inventory_move_automatic_cost_${item.id}">—</strong></span><button class="link-button" type="button" onclick="resetInventoryMoveCostBasis('${item.id}')">Reset automatic cost</button></label>`:`<span id="inventory_move_cost_${item.id}">${fmtMoney(item.cost)}</span>`}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="move-confirmation-note"><strong>What happens next?</strong><span>${context.individual?'Enter the exact weight to move, then use the automatic cost or enter a cost-basis override. The remaining weight and cost stay in Inventory.':poolIds.length?'Enter the exact weight to move. Its cost is calculated automatically; remaining pool weight and cost stay in Inventory.':'Assign a name and buyer to the batch. Gold, Silver, and Platinum items may remain together. The records will then become For Liquidation and leave Current Inventory until sold or returned.'}</span></div>
    <div class="form-actions"><button class="btn secondary" onclick="closeInventoryMoveConfirmation()">Cancel</button><button class="btn" id="inventory_move_continue" onclick="confirmInventoryMoveToLiquidation()" disabled>Continue to batch details</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeInventoryMoveConfirmation();});
  document.body.appendChild(modal);
  if(context.individual) selected.forEach(item=>updateInventoryMovePartialPreview(item.id));
  updateInventoryMoveContinueState();
  modal.querySelector('.btn:last-child')?.focus();
}
async function confirmInventoryMoveToLiquidation(){
  const pending=pendingInventoryMove;
  if(!pending){ closeInventoryMoveConfirmation(); return; }
  const destination=document.getElementById('inventory_move_destination')?.value||pending.destination||'';
  if(!destination){toast('Select a liquidation destination');document.getElementById('inventory_move_destination')?.focus();return;}
  const selected=pending.ids.map(id=>db.stock.find(item=>item.id===id)).filter(item=>item&&selectableInventory(item));
  if(selected.length!==pending.ids.length){ closeInventoryMoveConfirmation(); toast('One or more selected records are no longer available. Review the inventory again.'); render(); return; }
  const pools=(pending.poolIds||[]).map(id=>db.inventoryPools.find(pool=>pool.id===id)).filter(Boolean);
  if(pools.length!==(pending.poolIds||[]).length||pools.some(pool=>inventoryPoolSnapshot(pool).weight<=0)){closeInventoryMoveConfirmation();toast('One or more selected pools changed. Review the inventory again.');render();return;}
  const allocations=pending.mode==='individual'?selected.map(item=>prepareInventoryItemAllocation(item,val(`inventory_move_weight_${item.id}`),inventoryMoveCostBasis(item.id))):null;
  if(allocations?.some(allocation=>!allocation)){toast(`Enter a valid weight and cost basis from PHP 0 to ${fmtMoney(selected[0]?.cost||0)}`);return;}
  const poolMoves=pools.map(pool=>{const input=document.getElementById(`inventory_move_pool_weight_${pool.id}`),requested=input?input.value:pending.poolWeights?.[pool.id];return preparePoolMove(pool,requested);});
  if(poolMoves.some(move=>!move)){toast('Enter a valid weight for every selected pool');return;}
  const poolItems=pools.flatMap(inventoryPoolItems),allItems=[...selected,...poolItems];
  const metals=Array.from(new Set(allItems.map(item=>item.metal)));
  const group={metal:metals.length===1?metals[0]:'Mixed',ids:Array.from(new Set(allItems.map(item=>item.id)))};
  if(allocations) group.allocations=allocations;
  if(poolMoves.length){group.poolMoves=poolMoves;group.allocations=[...(allocations||liquidationLinesForItems(selected)),...poolMoves.flatMap(move=>move.allocations)];}
  const groups=[group];
  pendingLiquidationBatchSetup={groups,destination};
  closeInventoryMoveConfirmation();
  if(destination!=='new'){
    await addPendingInventoryMoveToExistingBatch(pendingLiquidationBatchSetup);
    return;
  }
  openLiquidationBatchSetup();
}
function closeLiquidationBatchSetup(){ document.getElementById('liquidation_batch_setup')?.remove(); pendingLiquidationBatchSetup=null; }
function suggestedLiquidationBatchName(items){
  const metals=Array.from(new Set(items.map(item=>item.metal)));
  const grades=Array.from(new Set(items.map(item=>gradeLabel(item.metal,item.karat))));
  return `${metals.length>1?'Mixed':grades.length===1?grades[0]:items[0]?.metal||'Liquidation'} batch`;
}
function liquidationLinesForItems(items){
  return items.map(item=>({itemId:item.id,previousStatus:item.status,weight:roundWeight(item.currentWeight),cost:roundMoney(item.cost)}));
}
function appendItemsToLiquidationBatch(batch,items){
  const existingIds=new Set((batch.lines||[]).map(line=>line.itemId));
  const appendedItems=[];
  items.forEach(item=>{
    if(!item?.id||existingIds.has(item.id)) return;
    existingIds.add(item.id); appendedItems.push(item);
  });
  batch.lines=[...(batch.lines||[]),...liquidationLinesForItems(appendedItems)];
  appendedItems.forEach(item=>{item.status='For Liquidation';item.liquidationBatchId=batch.id;});
  const batchMetals=Array.from(new Set((batch.lines||[]).map(line=>db.stock.find(stock=>stock.id===line.itemId)?.metal).filter(Boolean)));
  if(batchMetals.length) batch.metal=batchMetals.length===1?batchMetals[0]:'Mixed';
  return appendedItems;
}
function stageInventoryAllocationsForLiquidation(batch,allocations){
  const resolved=allocations.map(line=>({line,item:db.stock.find(stock=>stock.id===line.itemId)}));
  if(resolved.some(({line,item})=>{
    const fullOverride=line?.costBasisOverridden===true&&line?.pooledAllocation!==true&&Number(line.weight)>=Number(item?.currentWeight||0)-0.005;
    return !line||!item||!selectableInventory(item)||Number(line.weight)<=0||Number(line.weight)>Number(item.currentWeight)+0.005||Number(line.cost)<0||(!fullOverride&&Number(line.cost)>Number(item.cost)+0.01);
  })) return false;
  batch.lines=[];
  for(const {line,item} of resolved){
    const full=!line.pooledAllocation;
    batch.lines.push({...line});
    if(full){if(line.costBasisOverridden)item.cost=roundMoney(line.cost);item.status='For Liquidation';item.liquidationBatchId=batch.id;}
    else{
      item.currentWeight=roundWeight(Number(item.currentWeight)-Number(line.weight));
      item.cost=roundMoney(Number(item.cost)-Number(line.cost));
    }
  }
  return true;
}
function appendInventoryMoveGroupToBatch(batch,group){
  if(!batch||!group)return false;
  const poolItemIds=new Set((group.poolMoves||[]).flatMap(move=>inventoryPoolItems(db.inventoryPools.find(pool=>pool.id===move.poolId)).map(item=>item.id)));
  const items=group.ids.map(id=>db.stock.find(item=>item.id===id)).filter(item=>item&&(selectableInventory(item)||poolItemIds.has(item.id)));
  if(items.length!==group.ids.length)return false;
  const staged={id:batch.id,name:batch.name,buyer:batch.buyer,metal:group.metal,lines:[]};
  const allocations=(group.allocations||liquidationLinesForItems(items)).filter(line=>!line.sourcePoolId);
  if(allocations.length&&!stageInventoryAllocationsForLiquidation(staged,allocations))return false;
  if((group.poolMoves||[]).length&&!appendPoolMovesToLiquidationBatch(staged,group.poolMoves))return false;
  batch.lines=[...(batch.lines||[]),...staged.lines];
  delete batch.buyerOffer;
  refreshLiquidationBatchMetal(batch);
  return true;
}
function openLiquidationBatchSetup(){
  const pending=pendingLiquidationBatchSetup;
  if(!pending) return;
  const groups=pending.groups.map(group=>({...group,items:group.ids.map(id=>db.stock.find(item=>item.id===id)).filter(Boolean)}));
  if(groups.some(group=>group.items.length!==group.ids.length)){ closeLiquidationBatchSetup(); toast('One or more selected records are no longer available'); render(); return; }
  const openBatches=db.liquidationBatches||[];
  const modal=document.createElement('div'); modal.id='liquidation_batch_setup'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="inventory-move-modal" role="dialog" aria-modal="true" aria-labelledby="liquidation_batch_setup_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Send inventory to Liquidation</div><h2 id="liquidation_batch_setup_title">Choose batch destination</h2></div><button class="modal-close" onclick="closeLiquidationBatchSetup()" aria-label="Close">×</button></div>
    <p class="move-confirmation-intro">Choose whether to create a new batch or add this inventory to an existing open batch.</p>
    ${groups.length===1&&openBatches.length?`<div class="field"><label for="liquidation_batch_destination">Liquidation destination</label><select id="liquidation_batch_destination"><option value="new" ${pending.destination==='new'?'selected':''}>Create new liquidation batch</option>${openBatches.map(batch=>`<option value="${esc(batch.id)}" ${pending.destination===batch.id?'selected':''}>Add to existing open batch · ${esc(batch.id)} · ${esc(batch.name)}</option>`).join('')}</select></div>`:`<input id="liquidation_batch_destination" type="hidden" value="${esc(pending.destination||'new')}">`}
    ${groups.map((group,index)=>{
      const allocations=group.allocations||liquidationLinesForItems(group.items);
      const totalWeight=allocations.reduce((sum,line)=>sum+Number(line.weight),0),totalCost=allocations.reduce((sum,line)=>sum+Number(line.cost),0);
      const metals=Array.from(new Set(group.items.map(item=>item.metal)));
      return `<section class="move-confirmation-note"><strong>${esc(metals.join(' / '))} batch · ${group.items.length} item${group.items.length===1?'':'s'}</strong><div class="form-grid" style="margin-top:12px;"><div class="field"><label>Batch name</label><input id="new_liquidation_batch_name_${index}" value="${esc(suggestedLiquidationBatchName(group.items))}" required></div><div class="field"><label>Assigned buyer</label><input id="new_liquidation_batch_buyer_${index}" placeholder="Buyer name" required></div><div class="field span-2"><label>Notes</label><input id="new_liquidation_batch_notes_${index}" placeholder="Optional"></div></div><div class="move-confirmation-summary"><div><span>Metal${metals.length===1?'':'s'}</span><strong>${esc(metals.join(' / '))}</strong></div><div><span>Items</span><strong>${group.items.length}</strong></div><div><span>Total weight</span><strong>${fmtWeight(totalWeight)}</strong></div><div><span>Carrying cost</span><strong>${fmtMoney(totalCost)}</strong></div></div></section>`;
    }).join('')}
    <div class="form-actions"><button class="btn secondary" onclick="closeLiquidationBatchSetup()">Cancel</button><button class="btn" onclick="createLiquidationBatch()">Move inventory</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeLiquidationBatchSetup();}); document.body.appendChild(modal);
  document.getElementById('new_liquidation_batch_buyer_0')?.focus();
}
async function addPendingInventoryMoveToExistingBatch(pending){
  const destination=pending?.destination||'';
  const batch=db.liquidationBatches.find(record=>record.id===destination);
  if(!batch){toast('The selected liquidation batch is no longer available');return false;}
  const beforeState=JSON.parse(JSON.stringify(db));
  if(pending.groups.length!==1||!appendInventoryMoveGroupToBatch(batch,pending.groups[0])){db=beforeState;toast('The selected inventory could not be added to this batch');return false;}
  if(!await saveDB()){db=beforeState;render();toast('Inventory was not added to the liquidation batch');return false;}
  inventoryMoveSelection.clear();inventoryPoolRowSelection.clear();closeLiquidationBatchSetup();goTab('liquidation');toast(`Inventory added to ${batch.id}`);return true;
}
async function createLiquidationBatch(){
  const pending=pendingLiquidationBatchSetup;
  if(!pending) return;
  const destination=val('liquidation_batch_destination')||pending.destination||'new';
  if(destination!=='new'){
    await addPendingInventoryMoveToExistingBatch(pending);
    return;
  }
  const prepared=pending.groups.map((group,index)=>{
    return {metal:group.metal,name:val(`new_liquidation_batch_name_${index}`).trim(),buyer:val(`new_liquidation_batch_buyer_${index}`).trim(),notes:val(`new_liquidation_batch_notes_${index}`).trim()};
  });
  if(prepared.some(group=>!group.name||!group.buyer)){ toast('Enter a batch name and assigned buyer'); return; }
  const beforeState=JSON.parse(JSON.stringify(db));
  let stagingFailed=false;
  prepared.forEach((group,index)=>{
    const id=nextSequenceId('LB',db.liquidationBatches);
    const batch={id,name:group.name,buyer:group.buyer,metal:group.metal,lines:[],notes:group.notes,createdAt:new Date().toISOString(),createdBy:currentUser?.displayName||''};
    if(!appendInventoryMoveGroupToBatch(batch,pending.groups[index])){stagingFailed=true;return;}
    db.liquidationBatches.push(batch);
  });
  if(stagingFailed){db=beforeState;closeLiquidationBatchSetup();render();toast('One or more inventory balances changed. Review the movement again.');return;}
  const saved=await saveDB();
  if(!saved){db=beforeState;render();toast(`Liquidation ${prepared.length===1?'batch was':'batches were'} not created`);return;}
  inventoryMoveSelection.clear(); closeLiquidationBatchSetup(); goTab('liquidation'); toast(`${prepared.length} liquidation ${prepared.length===1?'batch':'batches'} created`);
}
function renderInventory(){
  const week=inventoryWeekRange();
  if(inventorySelectedDate!=='All'&&(inventorySelectedDate<week.start||inventorySelectedDate>week.end)) inventorySelectedDate=week.start;
  const dates=Array.from({length:7},(_,index)=>dateKeyPlusDays(week.start,index));
  const dailyRows=dates.map(date=>{
    const purchases=db.stock.filter(item=>item.date===date&&!item.sourceRefiningBatchId);
    const stock=purchases.filter(activeInventoryRecord),available=stock.filter(selectableInventory);
    return {date,purchases,stock,available,weight:available.reduce((sum,item)=>sum+Number(item.currentWeight),0),cost:available.reduce((sum,item)=>sum+Number(item.cost),0)};
  });
  const allActiveStock=db.stock.filter(activeInventoryRecord);
  const allAvailableStock=allActiveStock.filter(selectableInventory);
  const selectedDay=inventorySelectedDate==='All'
    ? {date:'All',stock:allActiveStock,available:allAvailableStock,weight:allAvailableStock.reduce((sum,item)=>sum+Number(item.currentWeight),0),cost:allAvailableStock.reduce((sum,item)=>sum+Number(item.cost),0)}
    : dailyRows.find(day=>day.date===inventorySelectedDate)||dailyRows[0];
  const percentagePool=inventoryPercentagePool();
  const selectedMoveCount=selectedInventoryForCategory().length;
  const selectedRecords=selectedInventoryForCategory();
  const selectedMovableCount=selectedInventoryForMove().length;
  const hasMovableStock=db.stock.some(movableInventory);
  const poolingSelection=inventoryPoolingSelection();
  const canPoolSelected=poolingSelection.valid;
  const selectedPoolCount=poolingSelection.pools.length;
  const canMergeSelectedPools=inventoryPoolMergeSelection().valid;
  const canMoveSelected=selectedPoolCount>0||(selectedMoveCount>0&&selectedMovableCount===selectedMoveCount);
  const activeFilterLabels=[invFilter.metal,invFilter.karat,invFilter.type,invFilter.status].filter(value=>value!=='All');
  const displayStock=inventoryDisplayRows(selectedDay.stock);
  const displayAvailable=displayStock.filter(item=>item.status==='Available'||item.status==='For Refining');
  const rows = displayStock.filter(s=>
    (invFilter.metal==='All'||s.metal===invFilter.metal) &&
    (invFilter.karat==='All'||s.karat===invFilter.karat) &&
    (invFilter.type==='All'||s.itemType===invFilter.type) &&
    (invFilter.status==='All'||s.status===invFilter.status) &&
    inventorySearchMatch(s)
  ).sort((a,b)=>{
    const comparison=inventoryTransactionSortKey(a).localeCompare(inventoryTransactionSortKey(b))||a.date.localeCompare(b.date);
    return inventorySort==='oldest'?comparison:-comparison;
  });
  const dailyPurchaseSource=inventorySelectedDate==='All'?[]:selectedDay.purchases.filter(item=>invFilter.metal==='All'||item.metal===invFilter.metal);
  const dailyPurchaseTotals=purchaseTotalsByPurity(dailyPurchaseSource);

  const currentStock=inventoryDisplayRows(allActiveStock);
  const breakdownSource=currentStock.filter(item=>invFilter.metal==='All'||item.metal===invFilter.metal);
  const breakdownMap=new Map();
  breakdownSource.forEach(item=>{
    const key=`${item.metal}|${item.karat}`,entry=breakdownMap.get(key)||{metal:item.metal,karat:item.karat,count:0,weight:0,cost:0};
    entry.count+=1; entry.weight+=Number(item.currentWeight); entry.cost+=Number(item.cost); breakdownMap.set(key,entry);
  });
  const breakdown=Array.from(breakdownMap.values()).sort((a,b)=>a.metal.localeCompare(b.metal)||(GRADE_META[a.metal]?.findIndex(grade=>grade.key===a.karat)??99)-(GRADE_META[b.metal]?.findIndex(grade=>grade.key===b.karat)??99));
  const breakdownWeight=breakdownSource.reduce((sum,item)=>sum+Number(item.currentWeight),0);
  const breakdownCost=breakdownSource.reduce((sum,item)=>sum+Number(item.cost),0);
  const lowKaratGold=currentStock.filter(lowKaratGoldInventory);
  const lowKaratEligible=lowKaratGold.filter(categorizableInventory);
  const lowKaratWeight=lowKaratGold.reduce((sum,item)=>sum+Number(item.currentWeight),0);
  const selectedGradeCounts=new Map();
  selectedRecords.forEach(item=>{const key=`${item.metal} ${gradeLabel(item.metal,item.karat)}`;selectedGradeCounts.set(key,(selectedGradeCounts.get(key)||0)+1);});

  return `
  <section class="block">
    <div class="page-head inventory-overview-head"><div><p class="eyebrow">Across all purchase dates</p><h2 class="block-title">Current Stock Overview</h2><p class="form-note">See the complete available inventory before opening the daily records.</p></div></div>
    <div class="inventory-metal-tabs"><strong>View inventory</strong>${['All','Gold','Silver','Platinum'].map(metal=>`<button class="${invFilter.metal===metal?'active':''}" onclick="selectInventoryMetalCategory('${metal}')">${metal}</button>`).join('')}</div>
    <div class="stat-row inventory-overview-stats">
      <div class="stat"><div class="label">Current items</div><div class="value">${breakdownSource.length}</div><div class="sub">active records across all dates</div></div>
      <div class="stat"><div class="label">Total weight</div><div class="value">${fmtWeight(breakdownWeight)}</div><div class="sub">remaining current stock</div></div>
      <div class="stat"><div class="label">Total inventory cost</div><div class="value">${fmtMoney(breakdownCost)}</div><div class="sub">combined carrying cost</div></div>
      <div class="stat"><div class="label">Karat / purity groups</div><div class="value">${breakdown.length}</div><div class="sub">shown in the breakdown below</div></div>
    </div>
    ${(invFilter.metal==='All'||invFilter.metal==='Gold')&&isAdmin()?`<div class="low-karat-card"><div><span class="low-karat-label">Quick refining selection</span><strong>Low-karat Gold</strong><small>Below 18K · ${lowKaratGold.length} item${lowKaratGold.length===1?'':'s'} · ${fmtWeight(lowKaratWeight)} across all dates</small></div><button class="btn" onclick="selectAllLowKaratGold()" ${lowKaratEligible.length?'':'disabled'}>Select all for refining (${lowKaratEligible.length})</button></div>`:''}
    <h2 class="block-title inventory-breakdown-heading">${invFilter.metal==='All'?'All current stock by grade':`${invFilter.metal} inventory by ${invFilter.metal==='Gold'?'karat':'purity'}`}</h2>
    <p class="form-note inventory-breakdown-caption">Totals below combine every active purchase date.</p>
    ${breakdown.length?`<div class="table-wrap inventory-breakdown"><table><thead><tr><th>Metal</th><th>Karat / purity</th><th class="num-head">Items</th><th class="num-head">Total weight</th><th class="num-head">Total cost</th></tr></thead><tbody>${breakdown.map(entry=>`<tr><td><span class="metal-tag ${entry.metal.toLowerCase()}">${entry.metal}</span></td><td>${esc(gradeLabel(entry.metal,entry.karat))}</td><td class="num">${entry.count}</td><td class="num">${fmtWeight(entry.weight)}</td><td class="num">${fmtMoney(entry.cost)}</td></tr>`).join('')}</tbody></table></div><div class="inventory-breakdown-total"><span>${invFilter.metal==='All'?'All current stock':`${invFilter.metal} total`} · ${breakdownSource.length} item${breakdownSource.length===1?'':'s'} · ${fmtWeight(breakdownWeight)}</span><strong>${fmtMoney(breakdownCost)}</strong></div>`
      : `<div class="empty-note">No active ${invFilter.metal==='All'?'inventory':esc(invFilter.metal)+' inventory'} remains.</div>`}
    <p class="form-note inventory-history-note">For Liquidation items are shown only in the Liquidation view. Liquidated, refined, and sold items remain in reports and transaction history.</p>
  </section>

  <section class="block">
    <div class="page-head" style="margin-bottom:14px;"><div><p class="eyebrow">Complete stock or daily view</p><h2 class="block-title" style="margin:0;">Inventory records</h2><p class="form-note">Use All dates to see everything together, or choose a day for a focused view.</p></div><div class="form-actions" style="margin:0;"><button class="btn secondary small" onclick="changeInventoryWeek(-1)">Previous Monday–Sunday</button><button class="btn secondary small" onclick="changeInventoryWeek(1)">Next Monday–Sunday</button></div></div>
    <div class="inventory-today-totals"><div>${['All','Gold','Silver'].map(metal=>`<button class="btn secondary small" onclick="showTodayInventoryTotals('${metal}')">Today's ${metal}</button>`).join('')}</div></div>
    <div class="inventory-days">
      <button class="inventory-day inventory-all-dates ${inventorySelectedDate==='All'?'active':''}" onclick="selectAllInventoryDates()"><strong>All dates</strong><span>Complete current stock</span><small>${inventoryDisplayRows(allActiveStock).length} record${inventoryDisplayRows(allActiveStock).length===1?'':'s'}<br>${fmtWeight(inventoryDisplayRows(allActiveStock).filter(item=>item.status==='Available'||item.status==='For Refining').reduce((sum,item)=>sum+Number(item.currentWeight),0))} available</small></button>
      ${dailyRows.map(day=>`<button class="inventory-day ${day.date===inventorySelectedDate?'active':''}" onclick="selectInventoryDate('${day.date}')"><strong>${new Date(day.date+'T00:00:00').toLocaleDateString('en-PH',{weekday:'long'})}</strong><span>${fmtDate(day.date)}</span><small>${day.purchases.length} purchase${day.purchases.length===1?'':'s'}<br>${fmtWeight(day.purchases.reduce((sum,item)=>sum+Number(item.netWeight||0),0))} bought</small></button>`).join('')}
    </div>
    ${inventorySelectedDate==='All'?`<div class="inventory-daily-prompt">Choose a day above, or use <strong>Today's totals</strong>, to view totals for every purity.</div>`:`<div id="inventory_daily_totals" class="inventory-daily-totals">
      <div class="inventory-daily-totals-head"><div><h2 class="block-title">Purchase totals by purity · ${fmtDate(selectedDay.date)}</h2><p class="form-note">${invFilter.metal==='All'?'All metals':esc(invFilter.metal)} purchased on this date.</p></div></div>
      ${dailyPurchaseTotals.length?`<div class="table-wrap inventory-daily-purity-table"><table><thead><tr><th>Metal</th><th>Karat / purity</th><th class="num-head">Purchase lines</th><th class="num-head">Purchased weight</th><th class="num-head">Total payout</th><th class="num-head">Remaining weight</th></tr></thead><tbody>${dailyPurchaseTotals.map(entry=>`<tr><td><span class="metal-tag ${entry.metal.toLowerCase()}">${entry.metal}</span></td><td><strong>${esc(gradeLabel(entry.metal,entry.karat))}</strong></td><td class="num">${entry.count}</td><td class="num">${fmtWeight(entry.purchasedWeight)}</td><td class="num">${fmtMoney(entry.payout)}</td><td class="num">${fmtWeight(entry.remainingWeight)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-note">No ${invFilter.metal==='All'?'purchases':esc(invFilter.metal)+' purchases'} were recorded on this date.</div>`}
    </div>`}
    <h2 class="block-title">${inventorySelectedDate==='All'?'All purchase dates':`${new Date(selectedDay.date+'T00:00:00').toLocaleDateString('en-PH',{weekday:'long'})}, ${fmtDate(selectedDay.date)}`}</h2>
    <div class="stat-row">
      <div class="stat"><div class="label">Current stock records</div><div class="value">${displayStock.length}</div><div class="sub">pooled inventory is counted as one item</div></div>
      <div class="stat"><div class="label">Available stock lines</div><div class="value">${displayAvailable.length}</div><div class="sub">eligible for liquidation or refining</div></div>
      <div class="stat"><div class="label">Available weight</div><div class="value">${fmtWeight(displayAvailable.reduce((sum,item)=>sum+Number(item.currentWeight),0))}</div><div class="sub">remaining from ${inventorySelectedDate==='All'?'all purchases':"this date's purchases"}</div></div>
      <div class="stat"><div class="label">Remaining cost</div><div class="value">${fmtMoney(displayStock.reduce((sum,item)=>sum+Number(item.cost),0))}</div><div class="sub">carrying cost ${inventorySelectedDate==='All'?'across all dates':'for this purchase date'}</div></div>
    </div>
  </section>

  <section class="block" id="inventory_stock_list">
    <div class="inventory-stock-head"><div><h2 class="block-title">Stock records</h2><p class="form-note">${inventorySearch?`${rows.length} matching record${rows.length===1?'':'s'}`:activeFilterLabels.length?`Showing: ${activeFilterLabels.map(esc).join(' · ')}`:'Showing all records'} across ${inventoryDateLabel()}.</p></div><div class="inventory-stock-tools"><div class="field inventory-stock-search"><label for="inventory_stock_search">Search stock records</label><input id="inventory_stock_search" type="search" autocomplete="off" value="${esc(inventorySearch)}" placeholder="Customer, date, metal, karat, or status" oninput="updateInventorySearch(this.value)"></div><div class="field inventory-stock-sort"><label for="inventory_stock_sort">Transaction date</label><select id="inventory_stock_sort" onchange="updateInventorySort(this.value)"><option value="newest" ${inventorySort==='newest'?'selected':''}>Newest to oldest</option><option value="oldest" ${inventorySort==='oldest'?'selected':''}>Oldest to newest</option></select></div><button class="btn secondary small" onclick="openInventoryFilterModal()">Change filters</button></div></div>
    ${isAdmin()?`<div class="inventory-action-panel"><div class="inventory-action-status"><strong>${percentagePool.length} eligible ${inventorySelectedDate==='All'?'across all dates':'on this date'}</strong><span><span id="inventory_liq_count">${selectedMoveCount}</span> inventory item${selectedMoveCount===1?'':'s'} selected${selectedPoolCount?` · ${selectedPoolCount} pool selected`:''}${percentagePool.length?'':' · change the filters'}</span>${selectedGradeCounts.size?`<div class="inventory-selection-chips">${Array.from(selectedGradeCounts.entries()).map(([grade,count])=>`<span>${esc(grade)} · ${count}</span>`).join('')}</div>`:''}</div><div class="inventory-action-buttons"><button class="btn secondary small" onclick="selectAllVisibleInventory()">Select all shown</button><button class="btn secondary small" onclick="selectAllLowKaratGold()">Select low-karat Gold</button><button class="btn secondary small" id="inventory_clear_selected" onclick="clearInventorySelection()" ${selectedMoveCount||selectedPoolCount?'':'disabled'}>Clear</button><div class="inventory-bulk-category"><select id="inventory_bulk_status" aria-label="Category for selected inventory" onchange="inventoryBulkStatus=this.value">${['Available','For Refining','On Hold'].map(status=>`<option ${inventoryBulkStatus===status?'selected':''}>${status}</option>`).join('')}</select><button class="btn secondary small" data-inventory-selection-required onclick="categorizeCheckedInventory()" ${selectedMoveCount?'':'disabled'}>Apply category</button></div><button class="btn" id="inventory_pool_selected" onclick="openManualInventoryPoolModal()" ${canPoolSelected?'':'disabled'}>Pool selected</button><button class="btn secondary small" id="inventory_move_selected" onclick="moveCheckedInventoryToLiquidation()" ${canMoveSelected?'':'disabled'}>Move selected to liquidation</button><button class="btn secondary small" onclick="openCombineLiquidationDateSelection()" ${hasMovableStock?'':'disabled'}>Combine dates</button><button class="btn secondary small" data-inventory-selection-required onclick="prepareInventoryForRefining()" ${selectedMoveCount?'':'disabled'}>Refine selected</button></div></div>`:''}
    ${isAdmin()?`<div class="form-actions" style="margin:0 0 12px"><button class="btn secondary small" id="inventory_merge_pools" onclick="openInventoryPoolMergeModal()" ${canMergeSelectedPools?'':'disabled'}>Merge selected pools</button></div>`:''}
    ${tableOrEmpty(rows, s=>`<tr>${isAdmin()?`<td>${s.isInventoryPool?`<input type="checkbox" data-inventory-pool-id="${s.inventoryPoolId}" aria-label="Select ${esc(s.customerName)} to merge or add inventory" onchange="toggleInventoryPoolSelection('${s.inventoryPoolId}',this.checked)" ${inventoryPoolRowSelection.has(s.inventoryPoolId)?'checked':''}>`:`<input type="checkbox" data-inventory-move-id="${s.id}" aria-label="Select ${esc(s.metal)} ${esc(s.karat)} from ${esc(s.customerName)}" onchange="toggleInventoryForLiquidation('${s.id}',this.checked)" ${inventoryMoveSelection.has(s.id)?'checked':''} ${categorizableInventory(s)?'':'disabled'}>`}</td>`:''}<td>${fmtDate(s.date)}</td><td>${esc(s.customerName)}</td><td><span class="metal-tag ${s.metal.toLowerCase()}">${s.metal}</span> ${esc(s.karat)}</td>
      <td>${esc(s.itemType)}</td><td class="num">${fmtWeight(s.currentWeight)}</td><td class="num">${fmtMoney(s.cost)}</td><td>${statusPill(s.status)}${s.isInventoryPool?`<br><span class="form-note">${esc(s.inventoryPoolId)}</span>`:''}</td><td>${esc(s.remarks||'—')}</td>${isAdmin()?`<td><div class="form-actions">${s.isInventoryPool?`<button class="btn small" onclick="openPoolLiquidationModal('${s.inventoryPoolId}')">Liquidate Pool</button><button class="btn secondary small" onclick="openInventoryPoolEdit('${s.inventoryPoolId}')">Edit</button>`:`${movableInventory(s)?`<button class="btn secondary small" onclick="liquidateInventoryItem('${s.id}')">Liquidate item</button>`:''}${adminEditButton('Inventory',s.id)}`}</div></td>`:''}</tr>`,
      [...(isAdmin()?['Select']:[]),'Date','Customer','Metal / karat','Type','Current weight','Cost','Status','Remarks',...(isAdmin()?['Actions']:[])],
      `No stock matches this filter ${inventorySelectedDate==='All'?'across all purchase dates':`on ${fmtDate(selectedDay.date)}`}.`)}
  </section>
  `;
}
let editingInventoryPoolId=null;
function sharedPoolItemValue(items,key){
  const values=Array.from(new Set(items.map(item=>String(item[key]||''))));
  return values.length===1?values[0]:'';
}
function openInventoryPoolEdit(id){
  const pool=db.inventoryPools.find(item=>item.id===id);if(!pool||!adminEditGuard())return;
  const snapshot=inventoryPoolSnapshot(pool);if(!snapshot.items.length)return;
  editingInventoryPoolId=id;
  const composition=inventoryPoolComposition(snapshot.items),dates=snapshot.items.map(item=>item.date).filter(Boolean).sort();
  const date=dates.at(-1)||String(pool.createdAt||'').slice(0,10)||todayStr();
  const gradeKeys=composition.metal==='Mixed'?[]:Array.from(new Set([...(GRADES[composition.metal]||[]),...snapshot.items.map(item=>item.karat).filter(Boolean)]));
  const mixedPurities=composition.metal!=='Mixed'&&composition.karat==='Mixed';
  const itemType=sharedPoolItemValue(snapshot.items,'itemType')||'Mixed';
  openAdminEditModal('Edit pooled inventory',`<div class="form-grid">
    <div class="field"><label>Date</label><input id="edit_pool_date" type="date" value="${esc(date)}"></div>
    <div class="field"><label>Classification</label><select id="edit_pool_status">${['Available','For Refining','On Hold'].map(status=>`<option ${poolInventoryClassification(pool,snapshot)===status?'selected':''}>${status}</option>`).join('')}</select></div>
    <div class="field"><label>Karat / purity</label><select id="edit_pool_karat" ${composition.metal==='Mixed'?'disabled':''}>${composition.metal==='Mixed'?'<option value="Mixed" selected>Mixed metals / purities</option>':`${mixedPurities?'<option value="Mixed" selected>Mixed purities</option>':''}${gradeKeys.map(key=>`<option value="${esc(key)}" ${key===composition.karat?'selected':''}>${esc(gradeLabel(composition.metal,key))}</option>`).join('')}`}</select></div>
    <div class="field"><label>Current weight (g)</label><input id="edit_pool_weight" type="number" min="0.01" max="${roundWeight(snapshot.items.reduce((sum,item)=>sum+Number(item.netWeight||0),0))}" step="0.01" value="${snapshot.weight}"></div>
    <div class="field"><label>Remaining cost (PHP)</label><input id="edit_pool_cost" type="number" min="0" step="0.01" value="${snapshot.cost}"></div>
    <div class="field"><label>Payment method</label><input id="edit_pool_payment" value="${esc(sharedPoolItemValue(snapshot.items,'paymentMethod'))}"></div>
    <div class="field"><label>Staff member</label><input id="edit_pool_staff" value="${esc(sharedPoolItemValue(snapshot.items,'staff')||currentUser?.displayName||'')}"></div>
    <div class="field"><label>Item type</label><select id="edit_pool_type"><option ${itemType==='Jewelry'?'selected':''}>Jewelry</option><option ${itemType==='Scrap'?'selected':''}>Scrap</option>${itemType==='Mixed'?'<option selected>Mixed</option>':''}</select></div>
    <div class="field span-2"><label>Remarks</label><textarea id="edit_pool_remarks">${esc(pool.notes||'')}</textarea></div>
  </div><p class="form-note">Changes apply to the pooled balance while every original inventory record remains traceable.</p>
  <section style="margin-top:20px;padding-top:16px;border-top:2px solid var(--line);"><h3>Pool items</h3><p class="form-note">Select records to remove from this pool and return as individual Available inventory. If every record is selected, the empty pool will be deleted.</p><div class="table-wrap"><table><thead><tr><th>Select</th><th>Item</th><th>Customer</th><th class="num-head">Remaining weight</th><th class="num-head">Remaining cost</th></tr></thead><tbody>${snapshot.items.map(item=>`<tr><td><input type="checkbox" data-pool-return-item-id="${esc(item.id)}" aria-label="Return ${esc(item.metal)} ${esc(gradeLabel(item.metal,item.karat))} from pool"></td><td><strong>${esc(item.metal)} ${esc(gradeLabel(item.metal,item.karat))}</strong><br><span class="form-note">${esc(item.itemType)}</span></td><td>${esc(item.customerName||'—')}</td><td class="num">${fmtWeight(item.currentWeight)}</td><td class="num">${fmtMoney(item.cost)}</td></tr>`).join('')}</tbody></table></div><div class="form-actions"><button class="btn secondary" type="button" onclick="returnSelectedPoolItemsToInventory()">Return selected to Inventory</button></div></section>`,'saveInventoryPoolEdit');
}
function preserveDissolvedPoolReferences(pool){
  const poolId=pool.id;
  const preserve=record=>{
    if(record.poolId===poolId){record.originalPoolId=record.originalPoolId||poolId;record.originalPoolName=record.originalPoolName||pool.name||'';delete record.poolId;}
    if(Array.isArray(record.poolIds)){record.poolIds=record.poolIds.filter(id=>id!==poolId);if(!record.poolIds.length)delete record.poolIds;}
    (record.lines||[]).forEach(line=>{if(line.sourcePoolId===poolId){line.originalSourcePoolId=line.originalSourcePoolId||poolId;delete line.sourcePoolId;}});
  };
  (db.liquidationBatches||[]).forEach(preserve);
  (db.liquidations||[]).forEach(preserve);
}
function detachInventoryPoolItems(pool,itemIds){
  const selectedIds=new Set(itemIds||[]),poolIds=new Set(pool?.itemIds||[]);
  if(!pool||!selectedIds.size||Array.from(selectedIds).some(id=>!poolIds.has(id)))return false;
  const remainingIds=(pool.itemIds||[]).filter(id=>!selectedIds.has(id));
  const selectedItems=inventoryPoolItems(pool).filter(item=>selectedIds.has(item.id));
  if(selectedItems.length!==selectedIds.size)return false;
  selectedItems.forEach(item=>{delete item.inventoryPoolId;delete item.liquidationBatchId;if(Number(item.currentWeight)>0)item.status='Available';});
  if(!remainingIds.length){preserveDissolvedPoolReferences(pool);db.inventoryPools=db.inventoryPools.filter(record=>record.id!==pool.id);return true;}
  pool.itemIds=remainingIds;
  const originalById=new Map((pool.originalItems||[]).map(item=>[item.itemId,item]));
  pool.originalItems=(pool.originalItems||[]).filter(item=>!selectedIds.has(item.itemId));
  const remainingItems=inventoryPoolItems(pool);
  pool.originalWeight=roundWeight(remainingItems.reduce((sum,item)=>sum+Number(originalById.get(item.id)?.originalWeight??item.netWeight??item.currentWeight),0));
  pool.originalCost=roundMoney(remainingItems.reduce((sum,item)=>sum+Number(originalById.get(item.id)?.originalCost??item.payout??item.cost),0));
  const composition=inventoryPoolComposition(remainingItems);pool.metal=composition.metal;pool.karat=composition.karat;pool.updatedAt=new Date().toISOString();syncInventoryPool(pool);
  return true;
}
async function returnSelectedPoolItemsToInventory(){
  if(!adminEditGuard())return;
  const pool=db.inventoryPools.find(item=>item.id===editingInventoryPoolId);if(!pool)return;
  const ids=Array.from(document.querySelectorAll?.('[data-pool-return-item-id]:checked')||[]).map(input=>input.dataset.poolReturnItemId).filter(Boolean);
  if(!ids.length){toast('Select at least one pool item to return');return;}
  const beforeState=JSON.parse(JSON.stringify(db));
  if(!detachInventoryPoolItems(pool,ids)){toast('The selected pool items could not be returned');return;}
  const poolDeleted=!db.inventoryPools.some(record=>record.id===pool.id);
  if(!await saveDB()){db=beforeState;render();toast('The selected items were not returned to Inventory');return;}
  editingInventoryPoolId=null;closeAdminEditModal();render();toast(poolDeleted?`${pool.id} deleted; ${ids.length} ${ids.length===1?'item':'items'} returned to Inventory`:`${ids.length} ${ids.length===1?'item':'items'} returned to Available Inventory`);
}
function distributePoolWeight(items,targetWeight){
  const currentTotal=items.reduce((sum,item)=>sum+Number(item.currentWeight||0),0);
  if(targetWeight<=currentTotal&&currentTotal>0){
    let assigned=0;const positive=items.filter(item=>Number(item.currentWeight||0)>0);
    positive.forEach((item,index)=>{item.currentWeight=index===positive.length-1?roundWeight(targetWeight-assigned):roundWeight(targetWeight*(Number(item.currentWeight)/currentTotal));assigned=roundWeight(assigned+item.currentWeight);});
    items.filter(item=>!positive.includes(item)).forEach(item=>{item.currentWeight=0;});return;
  }
  let increase=roundWeight(targetWeight-currentTotal),assigned=0;
  const available=items.filter(item=>Number(item.netWeight||0)>Number(item.currentWeight||0));
  const capacity=available.reduce((sum,item)=>sum+Math.max(0,Number(item.netWeight||0)-Number(item.currentWeight||0)),0);
  available.forEach((item,index)=>{const room=Math.max(0,Number(item.netWeight||0)-Number(item.currentWeight||0));const addition=index===available.length-1?roundWeight(increase-assigned):roundWeight(increase*(room/capacity));item.currentWeight=roundWeight(Number(item.currentWeight||0)+addition);assigned=roundWeight(assigned+addition);});
}
function distributePoolCost(items,targetCost){
  const positive=items.filter(item=>Number(item.currentWeight||0)>0),currentCost=positive.reduce((sum,item)=>sum+Number(item.cost||0),0),weight=positive.reduce((sum,item)=>sum+Number(item.currentWeight||0),0);
  let assigned=0;items.filter(item=>!positive.includes(item)).forEach(item=>{item.cost=0;});
  positive.forEach((item,index)=>{const share=currentCost>0?Number(item.cost||0)/currentCost:Number(item.currentWeight||0)/weight;item.cost=index===positive.length-1?roundMoney(targetCost-assigned):roundMoney(targetCost*share);assigned=roundMoney(assigned+item.cost);});
}
function applyInventoryPoolCostEdit(pool,targetCost){
  const normalizedCost=roundMoney(targetCost);
  distributePoolCost(inventoryPoolItems(pool),normalizedCost);
  pool.originalCost=Math.max(Number(pool.originalCost||0),normalizedCost);
}
async function saveInventoryPoolEdit(){
  if(!adminEditGuard())return;
  const pool=db.inventoryPools.find(item=>item.id===editingInventoryPoolId);if(!pool)return;
  const items=inventoryPoolItems(pool),targetWeight=Number(val('edit_pool_weight')),targetCost=Number(val('edit_pool_cost'));
  const maximumWeight=roundWeight(items.reduce((sum,item)=>sum+Number(item.netWeight||0),0));
  if(!val('edit_pool_date')){toast('Date is required');return;}
  if(!Number.isFinite(targetWeight)||targetWeight<=0||targetWeight>maximumWeight){toast(`Current weight must be between 0.01 g and ${maximumWeight.toFixed(2)} g`);return;}
  if(!Number.isFinite(targetCost)||targetCost<0){toast('Enter a valid remaining cost');return;}
  const beforeState=JSON.parse(JSON.stringify(db)),status=val('edit_pool_status'),karat=val('edit_pool_karat'),itemType=val('edit_pool_type');
  distributePoolWeight(items,roundWeight(targetWeight));applyInventoryPoolCostEdit(pool,targetCost);
  items.forEach(item=>{item.date=val('edit_pool_date');item.paymentMethod=val('edit_pool_payment').trim();item.staff=val('edit_pool_staff').trim();if(itemType!=='Mixed')item.itemType=itemType;if(karat&&karat!=='Mixed')item.karat=karat;});
  if(!setInventoryPoolClassification(pool,status)){toast('Choose a valid classification');return;}
  pool.notes=val('edit_pool_remarks').trim();pool.updatedAt=new Date().toISOString();
  const composition=inventoryPoolComposition(items);pool.metal=composition.metal;pool.karat=composition.karat;syncInventoryPool(pool);
  if(!await saveDB()){db=beforeState;render();toast('The pooled inventory was not updated');return;}
  editingInventoryPoolId=null;closeAdminEditModal();render();toast('Pooled inventory updated');
}
let editingInventoryId=null;
function openInventoryEdit(id){
  const item=db.stock.find(s=>s.id===id); if(!item||!adminEditGuard()) return;
  if(item.inventoryPoolId) return;
  editingInventoryId=id;
  const statuses=['Available','For Refining','On Hold','Liquidated','Refined','Sold'];
  const gradeKeys=Array.from(new Set([...(GRADES[item.metal]||[]),item.karat].filter(Boolean)));
  openAdminEditModal('Edit purchase / inventory record',`<div class="form-grid">
    <div class="field"><label>Date</label><input id="edit_inventory_date" type="date" value="${esc(item.date||todayStr())}"></div>
    <div class="field"><label>Classification</label><select id="edit_inventory_status">${statuses.map(status=>`<option ${item.status===status?'selected':''}>${status}</option>`).join('')}</select></div>
    <div class="field"><label>Karat / purity</label><select id="edit_inventory_karat">${gradeKeys.map(key=>`<option value="${esc(key)}" ${item.karat===key?'selected':''}>${esc(gradeLabel(item.metal,key))}</option>`).join('')}</select></div>
    <div class="field"><label>Current weight (g)</label><input id="edit_inventory_weight" type="number" min="0" max="${Number(item.netWeight)}" step="0.01" value="${Number(item.currentWeight)}"></div>
    <div class="field"><label>Remaining cost (PHP)</label><input id="edit_inventory_cost" type="number" min="0" step="0.01" value="${Number(item.cost)}"></div>
    <div class="field"><label>Payment method</label><input id="edit_inventory_payment" value="${esc(item.paymentMethod||'')}"></div>
    <div class="field"><label>Staff member</label><input id="edit_inventory_staff" value="${esc(item.staff||'')}"></div>
    <div class="field"><label>Item type</label><select id="edit_inventory_type"><option ${item.itemType==='Jewelry'?'selected':''}>Jewelry</option><option ${item.itemType==='Scrap'?'selected':''}>Scrap</option></select></div>
    <div class="field span-2"><label>Remarks</label><textarea id="edit_inventory_remarks">${esc(item.remarks||'')}</textarea></div>
  </div><p class="form-note">An Administrator can correct the recorded karat or purity. Original metal, purchase weight, rate, and payout remain locked.</p>`,'saveInventoryEdit','deleteInventoryRecord');
}
async function saveInventoryEdit(){
  if(!adminEditGuard()) return;
  const item=db.stock.find(s=>s.id===editingInventoryId); if(!item) return;
  const weight=Number(val('edit_inventory_weight')),cost=Number(val('edit_inventory_cost')),status=val('edit_inventory_status');
  if(!val('edit_inventory_date')){ toast('Date is required'); return; }
  if(!Number.isFinite(weight)||weight<0||weight>Number(item.netWeight)){ toast('Current weight must be between 0 and the original net weight'); return; }
  if(!Number.isFinite(cost)||cost<0){ toast('Enter a valid remaining cost'); return; }
  if(weight===0&&!['Liquidated','Refined','Sold'].includes(status)){ toast('Choose Liquidated, Refined, or Sold when the remaining weight is zero'); return; }
  if(weight>0&&['Liquidated','Refined','Sold'].includes(status)){ toast('Liquidated, Refined, or Sold inventory must have zero remaining weight'); return; }
  Object.assign(item,{date:val('edit_inventory_date'),status,karat:val('edit_inventory_karat')||item.karat,currentWeight:roundWeight(weight),cost:roundMoney(cost),paymentMethod:val('edit_inventory_payment').trim(),staff:val('edit_inventory_staff').trim(),itemType:val('edit_inventory_type'),remarks:val('edit_inventory_remarks').trim()});
  closeAdminEditModal(); await saveDB(); render(); toast('Inventory record updated');
}
async function deleteInventoryRecord(){
  if(!adminEditGuard()) return;
  const item=db.stock.find(s=>s.id===editingInventoryId); if(!item) return;
  const linked=db.liquidations.some(record=>(record.lines||[]).some(line=>line.itemId===item.id)) ||
    db.inventoryPools.some(pool=>(pool.itemIds||[]).includes(item.id)) ||
    db.liquidationBatches.some(record=>(record.lines||[]).some(line=>line.itemId===item.id)) ||
    db.refiningBatches.some(record=>(record.itemIds||[]).includes(item.id)||record.outputItemId===item.id) || db.retailSales.some(record=>record.itemId===item.id);
  if(linked){ toast('This item is linked to a completed transaction. Delete that transaction first.'); return; }
  if(!await confirmDeletion('Delete inventory record?',`Permanently remove this ${item.metal} ${item.karat} item from inventory.`,[
    {label:'Item',value:`${item.metal} ${item.karat} · ${item.itemType}`},{label:'Purchase date',value:fmtDate(item.date)},
    {label:'Current weight',value:fmtWeight(item.currentWeight)},{label:'Remaining cost',value:fmtMoney(item.cost)}
  ])) return;
  db.stock=db.stock.filter(s=>s.id!==item.id);
  closeAdminEditModal(); await saveDB(); render(); toast('Inventory record deleted');
}

/* ============================= LIQUIDATION ============================= */
const minimizedLiquidationBatches=new Set();
function toggleLiquidationBatchMinimized(id){
  if(minimizedLiquidationBatches.has(id)) minimizedLiquidationBatches.delete(id); else minimizedLiquidationBatches.add(id);
  render();
}
function liquidationBatchGradeBadges(batch){
  const mixed=batch.metal==='Mixed',labels=[];
  (batch.lines||[]).forEach(line=>{
    const item=db.stock.find(stock=>stock.id===line.itemId)||{};
    const grade=gradeLabel(item.metal||'',item.karat||'');
    const label=mixed?`${item.metal||''} ${grade}`.trim():grade;
    if(label&&!labels.includes(label)) labels.push(label);
  });
  return labels.map(label=>`<span class="liquidation-batch-grade">${esc(label)}</span>`).join('');
}
function liquidationBatchKaratTotals(batch){
  const totals=new Map();
  (batch.lines||[]).forEach(line=>{
    const item=db.stock.find(stock=>stock.id===line.itemId)||{};
    const metal=item.metal||batch.metal||'Unknown';
    const grade=gradeLabel(metal,item.karat||'Unknown');
    const key=`${metal}|${grade}`,entry=totals.get(key)||{metal,grade,items:0,weight:0,cost:0};
    entry.items+=1; entry.weight+=Number(line.weight||0); entry.cost+=Number(line.cost||0); totals.set(key,entry);
  });
  return Array.from(totals.values());
}
function renderLiquidation(){
  const batches=db.liquidationBatches.slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  const allLines=batches.flatMap(batch=>batch.lines||[]);
  const totalWeight=allLines.reduce((sum,line)=>sum+Number(line.weight||0),0),totalCost=allLines.reduce((sum,line)=>sum+Number(line.cost||0),0);
  return `<section class="block liquidation-overview">
    <div class="batch-head"><div><p class="eyebrow">Off-hand stock committed to buyers</p><h2 class="block-title">Open liquidation batches</h2><p class="form-note">These items are excluded from Current Inventory until the batch is sold or returned.</p></div><button class="btn" onclick="goTab('inventory')">Create batch from Inventory</button></div>
    <div class="liquidation-compact-overview"><span><small>Open batches</small><strong>${batches.length}</strong></span><span><small>Items in transit</small><strong>${allLines.length}</strong></span><span><small>Total weight</small><strong>${fmtWeight(totalWeight)}</strong></span><span><small>Total carrying cost</small><strong>${fmtMoney(totalCost)}</strong></span></div>
  </section>
  ${batches.map(batch=>{
    const lines=batch.lines||[],cost=lines.reduce((sum,line)=>sum+Number(line.cost||0),0),weight=lines.reduce((sum,line)=>sum+Number(line.weight||0),0);
    const minimized=minimizedLiquidationBatches.has(batch.id),batchGradeBadges=liquidationBatchGradeBadges(batch),karatTotals=liquidationBatchKaratTotals(batch);
    return `<section class="block liquidation-batch-card ${minimized?'is-minimized':''}">
      <div class="batch-head liquidation-batch-head"><div><div class="liquidation-batch-identity"><p class="eyebrow">${esc(batch.id)} · ${esc(batch.metal)}</p>${batchGradeBadges}</div><h2 class="block-title">${esc(batch.name)}</h2><p class="form-note">Assigned buyer: <strong>${esc(batch.buyer)}</strong>${batch.createdAt?` · Created ${new Date(batch.createdAt).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})}`:''}</p>${batch.notes?`<p class="liquidation-batch-comment"><strong>Comment:</strong> ${esc(batch.notes)}</p>`:''}</div><div class="form-actions"><button class="btn secondary small" onclick="toggleLiquidationBatchMinimized('${batch.id}')" aria-expanded="${minimized?'false':'true'}">${minimized?'Expand':'Minimize'}</button><button class="btn secondary small" onclick="openLiquidationBatchEdit('${batch.id}')">Edit batch</button><button class="btn secondary small" onclick="returnLiquidationBatch('${batch.id}')">Return to Inventory</button><button class="btn small" onclick="openCompleteLiquidationBatch('${batch.id}')">Record sale</button></div></div>
      <div class="liquidation-batch-compact-summary"><span><small>Items</small><strong>${lines.length}</strong></span><span><small>Total weight</small><strong>${fmtWeight(weight)}</strong></span><span><small>Total inventory cost</small><strong>${fmtMoney(cost)}</strong></span></div>
      <div class="liquidation-batch-karat-totals"><h3>Totals per karat / purity</h3><div class="table-wrap"><table><thead><tr><th>Metal</th><th>Karat / purity</th><th class="num-head">Items</th><th class="num-head">Total weight</th><th class="num-head">Total cost</th></tr></thead><tbody>${karatTotals.map(entry=>`<tr><td><span class="metal-tag ${String(entry.metal).toLowerCase()}">${esc(entry.metal)}</span></td><td><strong>${esc(entry.grade)}</strong></td><td class="num">${entry.items}</td><td class="num"><strong>${fmtWeight(entry.weight)}</strong></td><td class="num"><strong>${fmtMoney(entry.cost)}</strong></td></tr>`).join('')}</tbody></table></div></div>
      ${minimized?'':`
      <div class="table-wrap liquidation-batch-items"><table><thead><tr><th>Item</th><th>Original seller</th><th>Purchase date</th><th>Status</th><th class="num-head">Weight</th><th class="num-head">Carrying cost</th></tr></thead><tbody>${lines.map(line=>{
        const item=db.stock.find(stock=>stock.id===line.itemId)||{};
        return `<tr><td><strong>${esc(item.metal||batch.metal)} ${esc(gradeLabel(item.metal||batch.metal,item.karat||''))}</strong><br><span class="form-note">${esc(item.itemType||'Inventory item')} · ${esc(line.itemId)}</span></td><td>${esc(item.customerName||'—')}</td><td>${fmtDate(item.date)}</td><td>${statusPill('For Liquidation')}</td><td class="num">${fmtWeight(line.weight)}</td><td class="num">${fmtMoney(line.cost)}</td></tr>`;
      }).join('')}</tbody><tfoot><tr><th colspan="4">Batch subtotal · ${lines.length} item${lines.length===1?'':'s'}</th><th class="num">${fmtWeight(weight)}</th><th class="num">${fmtMoney(cost)}</th></tr></tfoot></table></div>
      `}
    </section>`;
  }).join('')||`<section class="block"><div class="empty-note">No items are currently marked For Liquidation.<div class="form-actions" style="justify-content:center;"><button class="btn" onclick="goTab('inventory')">Open Current Inventory</button></div></div></section>`}`;
}
function liquidationAmountLabel(record){
  const amounts=new Map();
  (record.lines||[]).forEach(line=>{
    const assay=line.assay||(db.stock.find(item=>item.id===line.itemId)||{}).karat||'Item';
    const amount=Number(line.sellingAmount??line.proceeds??(Number(line.weight)*Number(line.sellingRate||record.sellingRate)))||0;
    amounts.set(assay,(amounts.get(assay)||0)+amount);
  });
  if(!amounts.size&&Number(record.proceeds)>0) return esc(fmtMoney(record.proceeds));
  return amounts.size?Array.from(amounts.entries()).map(([assay,amount])=>`${esc(assay)}: ${esc(fmtMoney(amount))}`).join('<br>'):'—';
}
let editingOpenLiquidationBatchId=null;
const openLiquidationBatchAddSelection=new Set();
let openLiquidationBatchItemFilter='All';
function closeOpenLiquidationBatchModal(){ document.getElementById('open_liquidation_batch_modal')?.remove(); editingOpenLiquidationBatchId=null; openLiquidationBatchAddSelection.clear(); openLiquidationBatchItemFilter='All'; }
function liquidationBatchItemMatchesFilter(item,filter){
  return filter==='All'||item.karat===filter||item.itemType===filter;
}
function liquidationBatchItemFilterOptions(items){
  const availableGrades=new Set(items.map(item=>item.karat).filter(Boolean));
  const gradeOrder=(GRADE_META[items[0]?.metal]||[]).map(grade=>grade.key);
  const grades=[...gradeOrder.filter(grade=>availableGrades.delete(grade)),...Array.from(availableGrades).sort()];
  const itemTypes=Array.from(new Set(items.map(item=>item.itemType).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
  return ['All',...grades,...itemTypes.filter(type=>!grades.includes(type))];
}
function visibleOpenLiquidationBatchAddRows(){
  return Array.from(document.querySelectorAll?.('[data-open-batch-add-row]')||[]).filter(row=>!row.hidden);
}
function syncOpenLiquidationBatchAddControls(){
  const count=document.getElementById('edit_open_batch_add_count'),button=document.getElementById('edit_open_batch_add_submit');
  if(count) count.textContent=String(openLiquidationBatchAddSelection.size);
  if(button) button.disabled=!openLiquidationBatchAddSelection.size;
  const visibleCheckboxes=visibleOpenLiquidationBatchAddRows().map(row=>row.querySelector('input[data-open-batch-add-id]')).filter(Boolean);
  const selectedVisible=visibleCheckboxes.filter(checkbox=>checkbox.checked).length;
  const selectAll=document.getElementById('edit_open_batch_select_all');
  if(selectAll){
    selectAll.disabled=!visibleCheckboxes.length;
    selectAll.checked=visibleCheckboxes.length>0&&selectedVisible===visibleCheckboxes.length;
    selectAll.indeterminate=selectedVisible>0&&selectedVisible<visibleCheckboxes.length;
  }
  const shown=document.getElementById('edit_open_batch_visible_count');
  if(shown) shown.textContent=String(visibleCheckboxes.length);
}
function changeOpenLiquidationBatchItemFilter(filter){
  openLiquidationBatchItemFilter=filter||'All';
  Array.from(document.querySelectorAll?.('[data-open-batch-add-row]')||[]).forEach(row=>{
    row.hidden=!liquidationBatchItemMatchesFilter({karat:row.dataset.itemKarat,itemType:row.dataset.itemType},openLiquidationBatchItemFilter);
  });
  syncOpenLiquidationBatchAddControls();
}
function toggleAllVisibleOpenLiquidationBatchItems(checked){
  visibleOpenLiquidationBatchAddRows().forEach(row=>{
    const checkbox=row.querySelector('input[data-open-batch-add-id]');
    if(!checkbox) return;
    checkbox.checked=checked;
    if(checked) openLiquidationBatchAddSelection.add(checkbox.dataset.openBatchAddId); else openLiquidationBatchAddSelection.delete(checkbox.dataset.openBatchAddId);
  });
  syncOpenLiquidationBatchAddControls();
}
function toggleOpenLiquidationBatchItemPicker(){
  const picker=document.getElementById('edit_open_batch_item_picker');
  if(!picker) return;
  picker.classList.toggle('is-hidden');
  if(!picker.classList.contains('is-hidden')){
    picker.querySelector('#edit_open_batch_item_filter')?.focus();
    changeOpenLiquidationBatchItemFilter(openLiquidationBatchItemFilter);
  }
}
function toggleOpenLiquidationBatchAddItem(id,checked){
  if(checked) openLiquidationBatchAddSelection.add(id); else openLiquidationBatchAddSelection.delete(id);
  syncOpenLiquidationBatchAddControls();
}
function openLiquidationBatchEdit(id){
  const batch=db.liquidationBatches.find(record=>record.id===id); if(!batch||!adminEditGuard()) return;
  openLiquidationBatchAddSelection.clear();
  openLiquidationBatchItemFilter='All';
  editingOpenLiquidationBatchId=id;
  const lines=batch.lines||[];
  const batchWeight=lines.reduce((sum,line)=>sum+Number(line.weight||0),0),batchCost=lines.reduce((sum,line)=>sum+Number(line.cost||0),0);
  const existingLineIds=new Set(lines.map(line=>line.itemId));
  const eligible=db.stock.filter(item=>movableInventory(item)&&!item.liquidationBatchId&&!existingLineIds.has(item.id));
  const eligiblePools=(db.inventoryPools||[]).filter(pool=>inventoryPoolSnapshot(pool).weight>0);
  const eligiblePoolRows=eligiblePools.map(pool=>inventoryDisplayRows(inventoryPoolItems(pool))[0]).filter(Boolean);
  const eligibleEntries=[...eligible,...eligiblePoolRows];
  const modal=document.createElement('div'); modal.id='open_liquidation_batch_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="inventory-move-modal liquidation-edit-modal" role="dialog" aria-modal="true" aria-labelledby="open_liquidation_batch_title">
    <div class="summary-modal-head"><div><div class="eyebrow">${esc(batch.id)} · ${esc(batch.metal)}</div><h2 id="open_liquidation_batch_title">Edit liquidation batch</h2></div><button class="modal-close" onclick="closeOpenLiquidationBatchModal()" aria-label="Close">×</button></div>
    <div class="form-grid" style="margin-top:16px;"><div class="field"><label>Batch name</label><input id="edit_open_batch_name" value="${esc(batch.name)}"></div><div class="field"><label>Assigned buyer</label><input id="edit_open_batch_buyer" value="${esc(batch.buyer)}"></div><div class="field span-2"><label>Notes</label><input id="edit_open_batch_notes" value="${esc(batch.notes||'')}"></div></div>
    <div class="liquidation-edit-current-head"><div><h3>Current batch items</h3><p class="form-note">Existing items remain unchanged.</p></div><button class="btn secondary small" onclick="toggleOpenLiquidationBatchItemPicker()">+ Add New Item</button></div>
    <div class="table-wrap liquidation-edit-current-items"><table><thead><tr><th>Item</th><th>Seller</th><th>Purchase date</th><th class="num-head">Weight</th><th class="num-head">Cost</th><th>Action</th></tr></thead><tbody>${lines.map((line,index)=>{const item=db.stock.find(stock=>stock.id===line.itemId)||{};return `<tr><td><strong>${esc(item.metal||batch.metal)} ${esc(gradeLabel(item.metal||batch.metal,item.karat||''))}</strong> · ${esc(item.itemType||'Inventory item')}</td><td>${esc(item.customerName||'—')}</td><td>${fmtDate(item.date)}</td><td class="num">${fmtWeight(line.weight)}</td><td class="num">${fmtMoney(line.cost)}</td><td><button class="btn secondary small" onclick="returnLiquidationBatchItem('${esc(batch.id)}',${index})">Return to Inventory</button></td></tr>`;}).join('')}</tbody><tfoot><tr><th colspan="3">${lines.length} item${lines.length===1?'':'s'}</th><th class="num">${fmtWeight(batchWeight)}</th><th class="num">${fmtMoney(batchCost)}</th><th></th></tr></tfoot></table></div>
    <section id="edit_open_batch_item_picker" class="liquidation-edit-item-picker is-hidden"><div><h3>Add inventory to ${esc(batch.id)}</h3><p class="form-note">Available individual inventory and pooled inventory can be added to this batch.</p></div>${eligibleEntries.length?`<div class="liquidation-edit-filter"><label for="edit_open_batch_item_filter">Item filter</label><select id="edit_open_batch_item_filter" onchange="changeOpenLiquidationBatchItemFilter(this.value)">${liquidationBatchItemFilterOptions(eligibleEntries).map(option=>`<option value="${esc(option)}">${option==='All'?'All items':esc(option)}</option>`).join('')}</select><span class="form-note"><strong id="edit_open_batch_visible_count">${eligibleEntries.length}</strong> shown</span></div><div class="table-wrap"><table><thead><tr><th class="liquidation-select-all"><label><input id="edit_open_batch_select_all" type="checkbox" onchange="toggleAllVisibleOpenLiquidationBatchItems(this.checked)"> Select All</label></th><th>Item</th><th>Seller / pool</th><th>Purchase date</th><th class="num-head">Weight</th><th class="num-head">Cost</th></tr></thead><tbody>${eligibleEntries.map(item=>{const token=item.isInventoryPool?`pool:${item.inventoryPoolId}`:item.id;return `<tr data-open-batch-add-row data-item-karat="${esc(item.karat)}" data-item-type="${esc(item.itemType)}"><td><input type="checkbox" data-open-batch-add-id="${esc(token)}" onchange="toggleOpenLiquidationBatchAddItem(this.dataset.openBatchAddId,this.checked)" aria-label="Add ${esc(item.metal)} ${esc(gradeLabel(item.metal,item.karat))} ${item.isInventoryPool?'pool':'item'}"></td><td><strong>${esc(item.metal)} ${esc(gradeLabel(item.metal,item.karat))}</strong> · ${esc(item.itemType)}${item.isInventoryPool?' · Pool':''}</td><td>${esc(item.customerName||'—')}</td><td>${fmtDate(item.date)}</td><td class="num">${fmtWeight(item.currentWeight)}</td><td class="num">${fmtMoney(item.cost)}</td></tr>`;}).join('')}</tbody></table></div><div class="form-actions"><span class="form-note"><strong id="edit_open_batch_add_count">0</strong> selected</span><button id="edit_open_batch_add_submit" class="btn small" onclick="addItemsToOpenLiquidationBatch()" disabled>Add selected to batch</button></div>`:`<div class="empty-note">No available inventory can be added right now.</div>`}</section>
    <div class="form-actions liquidation-edit-actions"><button class="btn secondary" onclick="closeOpenLiquidationBatchModal()">Cancel</button><button class="btn" onclick="saveOpenLiquidationBatch()">Save batch</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeOpenLiquidationBatchModal();}); document.body.appendChild(modal);
}
async function addItemsToOpenLiquidationBatch(){
  const batch=db.liquidationBatches.find(record=>record.id===editingOpenLiquidationBatchId); if(!batch) return;
  const name=val('edit_open_batch_name').trim(),buyer=val('edit_open_batch_buyer').trim();
  if(!name||!buyer){toast('Batch name and buyer are required');return;}
  const chosen=Array.from(openLiquidationBatchAddSelection),chosenIds=chosen.filter(id=>!id.startsWith('pool:')),chosenPoolIds=chosen.filter(id=>id.startsWith('pool:')).map(id=>id.slice(5));
  const items=chosenIds.map(id=>db.stock.find(item=>item.id===id)).filter(item=>item&&movableInventory(item)&&!item.liquidationBatchId);
  const poolMoves=chosenPoolIds.map(id=>db.inventoryPools.find(pool=>pool.id===id)).filter(Boolean).map(prepareEntirePoolMove);
  if(!chosen.length){toast('Select at least one inventory item or pool');return;}
  if(items.length!==chosenIds.length||poolMoves.length!==chosenPoolIds.length||poolMoves.some(move=>!move)){toast('One or more selected items or pools are no longer available');return;}
  const beforeState=JSON.parse(JSON.stringify(db));
  Object.assign(batch,{name,buyer,notes:val('edit_open_batch_notes').trim()});
  delete batch.buyerOffer;
  const appendedItems=appendItemsToLiquidationBatch(batch,items);
  if(appendedItems.length!==items.length){db=beforeState;toast('One or more selected items are already in this batch');return;}
  if(!appendPoolMovesToLiquidationBatch(batch,poolMoves)){db=beforeState;toast('One or more selected pools changed. Review the batch again.');return;}
  if(!await saveDB()){db=beforeState;toast('Items were not added to the batch');return;}
  const batchId=batch.id,itemCount=appendedItems.length+poolMoves.length;
  closeOpenLiquidationBatchModal();render();openLiquidationBatchEdit(batchId);
  toast(`${itemCount} ${itemCount===1?'item':'items'} added to ${batchId}`);
}
function detachLiquidationBatchLine(batch,lineIndex){
  const index=Number(lineIndex),line=batch?.lines?.[index],item=line?db.stock.find(stock=>stock.id===line.itemId):null;
  if(!batch||!Number.isInteger(index)||index<0||!line||!item)return false;
  if(line.pooledAllocation){if(!restorePooledLiquidationLine(line))return false;}
  else{item.status=line.previousStatus==='For Selling'?'Available':line.previousStatus||'Available';if(line.costBasisOverridden&&Number.isFinite(Number(line.originalCost)))item.cost=roundMoney(line.originalCost);delete item.liquidationBatchId;}
  batch.lines.splice(index,1);
  const poolId=line.sourcePoolId||batch.poolId||'';
  if(poolId){const pool=db.inventoryPools.find(record=>record.id===poolId);if(pool){pool.updatedAt=new Date().toISOString();syncInventoryPool(pool);}}
  if(!batch.lines.length)db.liquidationBatches=db.liquidationBatches.filter(record=>record.id!==batch.id);
  else{delete batch.buyerOffer;refreshLiquidationBatchMetal(batch);}
  return true;
}
async function returnLiquidationBatchItem(batchId,lineIndex){
  if(!adminEditGuard())return;
  const batch=db.liquidationBatches.find(record=>record.id===batchId);if(!batch)return;
  const beforeState=JSON.parse(JSON.stringify(db));
  if(!detachLiquidationBatchLine(batch,lineIndex)){toast('This batch item could not be returned');return;}
  if(!await saveDB()){db=beforeState;render();toast('The item was not returned to Inventory');return;}
  const remains=db.liquidationBatches.some(record=>record.id===batchId);
  closeOpenLiquidationBatchModal();render();if(remains)openLiquidationBatchEdit(batchId);toast('Item returned to Inventory');
}
async function saveOpenLiquidationBatch(){
  const batch=db.liquidationBatches.find(record=>record.id===editingOpenLiquidationBatchId); if(!batch) return;
  const name=val('edit_open_batch_name').trim(),buyer=val('edit_open_batch_buyer').trim();
  if(!name||!buyer){toast('Batch name and buyer are required');return;}
  const before=JSON.parse(JSON.stringify(batch));
  Object.assign(batch,{name,buyer,notes:val('edit_open_batch_notes').trim()});
  delete batch.buyerOffer;
  if(!await saveDB()){Object.assign(batch,before);toast('Batch changes were not saved');return;}
  closeOpenLiquidationBatchModal();render();toast('Liquidation batch updated');
}
async function returnLiquidationBatch(id){
  const batch=db.liquidationBatches.find(record=>record.id===id); if(!batch||!adminEditGuard()) return;
  if(!confirm(`Return every item in “${batch.name}” to Current Inventory?`)) return;
  const beforeState=JSON.parse(JSON.stringify(db));
  const linked=(batch.lines||[]).map(line=>({line,item:db.stock.find(stock=>stock.id===line.itemId)}));
  if(linked.some(({line,item})=>!item||(line.pooledAllocation?Number(item.currentWeight)+Number(line.weight)>Number(item.netWeight)+0.005:item.status!=='For Liquidation'||item.liquidationBatchId!==batch.id))){toast('One or more batch items changed. Refresh and try again.');return;}
  for(const {line,item} of linked){
    if(line.pooledAllocation) restorePooledLiquidationLine(line);
    else {item.status=line.previousStatus||'Available'; delete item.liquidationBatchId;}
  }
  syncPoolsForLiquidationLines(batch.lines,batch.poolId);
  db.liquidationBatches=db.liquidationBatches.filter(record=>record.id!==id);
  if(!await saveDB()){db=beforeState;render();toast('The batch was not returned');return;}
  render();toast(`${batch.name} returned to Current Inventory`);
}
function closeCompleteLiquidationBatch(){ document.getElementById('complete_liquidation_batch_modal')?.remove(); }
function updateCompleteLiquidationProfit(cost){
  const totalInput=document.getElementById('complete_batch_total');
  const profitOutput=document.getElementById('complete_batch_profit');
  const marginOutput=document.getElementById('complete_batch_profit_margin');
  if(!totalInput||!profitOutput||!marginOutput) return;
  const hasAmount=String(totalInput.value||'').replace(/[,\s]/g,'')!=='';
  if(!hasAmount){ profitOutput.textContent='Enter total sold'; marginOutput.textContent='—'; profitOutput.style.color=''; marginOutput.style.color=''; return; }
  const sold=parseMoneyEntry(totalInput.value),profit=roundMoney(sold-Number(cost||0)),margin=Number(cost)>0?profit/Number(cost)*100:0;
  const color=profit>=0?'var(--sage)':'var(--rust)';
  profitOutput.textContent=fmtMoney(profit); marginOutput.textContent=`${margin.toFixed(2)}%`;
  profitOutput.style.color=color; marginOutput.style.color=color;
}
function openCompleteLiquidationBatch(id){
  const batch=db.liquidationBatches.find(record=>record.id===id); if(!batch||!adminEditGuard()) return;
  const weight=(batch.lines||[]).reduce((sum,line)=>sum+Number(line.weight||0),0),cost=(batch.lines||[]).reduce((sum,line)=>sum+Number(line.cost||0),0);
  const modal=document.createElement('div'); modal.id='complete_liquidation_batch_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="summary-modal" role="dialog" aria-modal="true" aria-labelledby="complete_liquidation_batch_title"><div class="summary-modal-head"><div><div class="eyebrow">${esc(batch.id)} · ${esc(batch.buyer)}</div><h2 id="complete_liquidation_batch_title">Record ${esc(batch.name)} sale</h2></div><button class="modal-close" onclick="closeCompleteLiquidationBatch()" aria-label="Close">×</button></div><div class="move-confirmation-summary" style="margin-top:16px;"><div><span>Items</span><strong>${(batch.lines||[]).length}</strong></div><div><span>Total weight</span><strong>${fmtWeight(weight)}</strong></div><div><span>Carrying cost</span><strong>${fmtMoney(cost)}</strong></div><div><span>Assigned buyer</span><strong>${esc(batch.buyer)}</strong></div></div><div class="form-grid"><div class="field"><label>Sale date</label><input id="complete_batch_date" type="date" value="${todayStr()}"></div><div class="field"><label>Payment status</label><select id="complete_batch_payment"><option>Pending</option><option>Partially Paid</option><option>Paid</option></select></div><div class="field"><label>Total sold (PHP)</label><input id="complete_batch_total" inputmode="decimal" value="" oninput="formatMoneyEntry(this);updateCompleteLiquidationProfit(${cost})"></div><div class="field"><label>Final notes</label><input id="complete_batch_notes" value="${esc(batch.notes||'')}"></div></div><div class="move-confirmation-summary"><div><span>Total cost</span><strong>${fmtMoney(cost)}</strong></div><div><span>Profit or loss</span><strong id="complete_batch_profit">Enter total sold</strong></div><div><span>Profit margin</span><strong id="complete_batch_profit_margin">—</strong></div></div><div class="form-actions"><button class="btn secondary" onclick="closeCompleteLiquidationBatch()">Cancel</button><button class="btn" onclick="submitLiquidationBatch('${batch.id}')">Record liquidation</button></div></div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeCompleteLiquidationBatch();}); document.body.appendChild(modal);
}
function closeLiquidationDetails(){ document.getElementById('liquidation_details_modal')?.remove(); }
function openLiquidationDetails(id){
  if(!isAdmin()) return;
  const record=db.liquidations.find(item=>item.id===id); if(!record) return;
  const lines=record.lines||[];
  const profit=Number(record.margin)||0;
  const profitMargin=Number(record.cost)>0?(profit/Number(record.cost))*100:0;
  const modal=document.createElement('div'); modal.id='liquidation_details_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="inventory-move-modal" role="dialog" aria-modal="true" aria-labelledby="liquidation_details_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Liquidation batch details</div><h2 id="liquidation_details_title">${esc(record.id)}</h2></div><button class="modal-close" onclick="closeLiquidationDetails()" aria-label="Close">×</button></div>
    <div class="move-confirmation-summary" style="margin-top:16px;">
      <div><span>Date</span><strong>${fmtDate(record.date)}${record.recordedAt?`<br><small>${new Date(record.recordedAt).toLocaleString('en-PH',{timeStyle:'short'})}</small>`:''}</strong></div><div><span>Buyer</span><strong>${esc(record.buyer)}</strong></div>
      ${record.poolId?`<div><span>Pool ID</span><strong>${esc(record.poolId)}<br><small>${esc(record.poolName||'')}</small></strong></div>`:''}
      <div><span>Items</span><strong>${lines.length||record.itemCount||0}</strong></div><div><span>Status</span><strong>${esc(record.paymentStatus||'—')}</strong></div>
      <div><span>Total weight</span><strong>${fmtWeight(record.releasedWeight)}</strong></div><div><span>Total cost</span><strong>${fmtMoney(record.cost)}</strong></div>
      <div><span>Total sold</span><strong>${fmtMoney(record.proceeds)}</strong></div><div><span>Profit</span><strong>${fmtMoney(profit)} · ${profitMargin.toFixed(2)}%</strong></div>
    </div>
    ${lines.length?`<div class="table-wrap move-confirmation-items"><table><thead><tr><th>Inventory item</th><th>Customer</th><th class="num-head">Weight</th><th class="num-head">Cost</th><th class="num-head">Total sold</th></tr></thead><tbody>${lines.map(line=>{
      const item=db.stock.find(stock=>stock.id===line.itemId)||{};
      const amount=Number(line.sellingAmount??line.proceeds??(Number(line.weight)*Number(line.sellingRate||record.sellingRate)))||0;
      return `<tr><td><strong>${esc(item.metal||record.metal)} ${esc(line.assay||item.karat||'')}</strong><br><span class="form-note">${esc(item.itemType||'Inventory item')} · ${esc(line.itemId)}</span></td><td>${esc(item.customerName||'—')}</td><td class="num">${fmtWeight(line.weight)}</td><td class="num">${fmtMoney(line.costPortion)}</td><td class="num">${fmtMoney(amount)}</td></tr>`;
    }).join('')}</tbody></table></div>`:'<div class="empty-note">Detailed item links are unavailable for this older liquidation record.</div>'}
    ${record.remarks?`<p class="move-confirmation-note"><strong>Notes</strong><span>${esc(record.remarks)}</span></p>`:''}
    <div class="form-actions"><button class="btn secondary" onclick="closeLiquidationDetails()">Close</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeLiquidationDetails();}); document.body.appendChild(modal);
}
async function submitLiquidationBatch(batchId){
  const batch=db.liquidationBatches.find(record=>record.id===batchId); if(!batch) return;
  const date=val('complete_batch_date'),totalSold=parseMoneyEntry(val('complete_batch_total'));
  if(!date){toast('Enter the sale date');return;}
  if(totalSold<=0){toast('Enter the total PHP sold amount for this batch');return;}
  const prepared=(batch.lines||[]).map(line=>({line,item:db.stock.find(stock=>stock.id===line.itemId)}));
  if(!prepared.length||prepared.some(({line,item})=>!item||(line.pooledAllocation
    ? Number(line.weight)<=0||Number(line.cost)<0||Number(item.currentWeight)+Number(line.weight)>Number(item.netWeight)+0.005
    : item.status!=='For Liquidation'||item.liquidationBatchId!==batch.id||Math.abs(Number(item.currentWeight)-Number(line.weight))>.005||Math.abs(Number(item.cost)-Number(line.cost))>.01))){
    toast('One or more batch items changed. Refresh and try again.');return;
  }
  const beforeState=JSON.parse(JSON.stringify(db));
  const totalWeight=prepared.reduce((sum,{line})=>sum+Number(line.weight||0),0),totalCost=prepared.reduce((sum,{line})=>sum+Number(line.cost||0),0);
  let allocatedSold=0;
  const lines=prepared.map(({line,item},index)=>{
    const weight=Number(line.weight),costPortion=Number(line.cost),ratio=totalCost>0?costPortion/totalCost:weight/totalWeight;
    const sellingAmount=index===prepared.length-1?roundMoney(totalSold-allocatedSold):roundMoney(totalSold*ratio);
    allocatedSold=roundMoney(allocatedSold+sellingAmount);
    if(!line.pooledAllocation){item.currentWeight=0; item.cost=0; item.status='Liquidated'; delete item.liquidationBatchId;}
    return {itemId:item.id,assay:item.karat,weight:roundWeight(weight),sellingAmount,sellingRate:roundMoney(sellingAmount/weight),proceeds:sellingAmount,costPortion:roundMoney(costPortion),automaticCost:line.automaticCost??null,originalCost:line.originalCost??null,costBasisOverridden:line.costBasisOverridden===true,previousStatus:line.previousStatus||'Available',pooledAllocation:line.pooledAllocation===true,partialAllocation:line.partialAllocation===true,sourcePoolId:line.sourcePoolId||null,originalSourcePoolId:line.originalSourcePoolId||null};
  });
  const uniqueRates=Array.from(new Set(lines.map(line=>line.sellingRate))),liquidationId=nextSequenceId('L',db.liquidations);
  const pool=batch.poolId?db.inventoryPools.find(record=>record.id===batch.poolId):null,remaining=pool?syncInventoryPool(pool):null,poolIds=syncPoolsForLiquidationLines(lines,batch.poolId);
  db.liquidations.push({id:liquidationId,batchId:batch.id,batchName:batch.name,poolId:batch.poolId||null,originalPoolId:batch.originalPoolId||null,poolIds,poolName:batch.poolName||'',date,metal:batch.metal,buyer:batch.buyer,itemCount:lines.length,sellingRate:uniqueRates.length===1?uniqueRates[0]:null,releasedWeight:roundWeight(totalWeight),proceeds:roundMoney(totalSold),paymentStatus:val('complete_batch_payment'),cost:roundMoney(totalCost),margin:roundMoney(totalSold-totalCost),profitMargin:totalCost?roundMoney((totalSold-totalCost)/totalCost*100):0,lines,remainingPoolWeight:remaining?.weight,remainingPoolCost:remaining?.cost,remarks:val('complete_batch_notes').trim(),createdBy:currentUser?.displayName||''});
  db.liquidationBatches=db.liquidationBatches.filter(record=>record.id!==batch.id);
  if(!await saveDB()){db=beforeState;render();toast('Liquidation was not recorded; inventory changes were rolled back');return;}
  closeCompleteLiquidationBatch();render();toast(`Liquidation ${liquidationId} recorded`);
}
let editingLiquidationId=null;
function openLiquidationEdit(id){
  const record=db.liquidations.find(l=>l.id===id); if(!record||!adminEditGuard()) return;
  editingLiquidationId=id;
  const amountFields=(record.lines||[]).length
    ? record.lines.map((line,index)=>{
        const item=db.stock.find(stock=>stock.id===line.itemId);
        const assay=line.assay||item?.karat||'Item';
        const amount=Number(line.sellingAmount??line.proceeds??(Number(line.weight)*Number(line.sellingRate||record.sellingRate)))||0;
        return `<div class="field"><label>${esc(assay)} · ${fmtWeight(line.weight)} total sold (PHP)</label><input id="edit_liquidation_line_amount_${index}" inputmode="decimal" value="${moneyEntryValue(amount)}" oninput="formatMoneyEntry(this)"></div>`;
      }).join('')
    : `<div class="field"><label>Total sold (PHP)</label><input id="edit_liquidation_amount" inputmode="decimal" value="${moneyEntryValue(record.proceeds)}" oninput="formatMoneyEntry(this)"></div>`;
  openAdminEditModal('Edit liquidation',`<div class="form-grid">
    <div class="field"><label>Release date</label><input id="edit_liquidation_date" type="date" value="${esc(record.date||todayStr())}"></div>
    <div class="field"><label>Buyer / refiner</label><input id="edit_liquidation_buyer" value="${esc(record.buyer||'')}"></div>
    ${amountFields}
    <div class="field"><label>Payment status</label><select id="edit_liquidation_payment">${['Pending','Partially Paid','Paid'].map(status=>`<option ${record.paymentStatus===status?'selected':''}>${status}</option>`).join('')}</select></div>
    <div class="field span-2"><label>Remarks</label><textarea id="edit_liquidation_remarks">${esc(record.remarks||'')}</textarea></div>
  </div><p class="form-note">Released weights and inventory costs remain locked. Batch proceeds and profit are recalculated from the total PHP sold amounts.</p>`,'saveLiquidationEdit','deleteLiquidationRecord');
}
async function saveLiquidationEdit(){
  if(!adminEditGuard()) return;
  const record=db.liquidations.find(l=>l.id===editingLiquidationId); if(!record) return;
  const buyer=val('edit_liquidation_buyer').trim(),date=val('edit_liquidation_date');
  if(!date||!buyer){ toast('Date and buyer are required'); return; }
  if((record.lines||[]).length){
    const amounts=[];
    for(let index=0;index<record.lines.length;index++){
      const line=record.lines[index],amount=parseMoneyEntry(val('edit_liquidation_line_amount_'+index));
      if(!Number.isFinite(amount)||amount<=0){ toast(`Enter a valid total sold amount for ${line.assay||'each item'}`); return; }
      amounts.push(roundMoney(amount));
    }
    let proceeds=0;
    const rates=[];
    record.lines.forEach((line,index)=>{ line.sellingAmount=amounts[index]; line.proceeds=amounts[index]; line.sellingRate=roundMoney(amounts[index]/Number(line.weight)); rates.push(line.sellingRate); proceeds+=line.proceeds; });
    const uniqueRates=Array.from(new Set(rates));
    record.sellingRate=uniqueRates.length===1?uniqueRates[0]:null;
    record.proceeds=roundMoney(proceeds);
  }else{
    const amount=parseMoneyEntry(val('edit_liquidation_amount'));
    if(!Number.isFinite(amount)||amount<=0){ toast('Enter a valid total sold amount'); return; }
    record.proceeds=roundMoney(amount); record.sellingRate=roundMoney(amount/Number(record.releasedWeight));
  }
  record.date=date; record.buyer=buyer; record.paymentStatus=val('edit_liquidation_payment'); record.remarks=val('edit_liquidation_remarks').trim();
  record.margin=roundMoney(record.proceeds-Number(record.cost));
  record.profitMargin=Number(record.cost)>0?roundMoney(record.margin/Number(record.cost)*100):0;
  closeAdminEditModal(); await saveDB(); render(); toast('Liquidation updated');
}
async function deleteLiquidationRecord(){
  if(!adminEditGuard()) return;
  const record=db.liquidations.find(l=>l.id===editingLiquidationId); if(!record) return;
  const items=(record.lines||[]).map(line=>({line,item:db.stock.find(s=>s.id===line.itemId)}));
  if(items.some(entry=>!entry.item)){ toast('Cannot reverse this liquidation because an inventory item is missing'); return; }
  if(items.some(entry=>entry.item.status==='Sold'||db.retailSales.some(sale=>sale.itemId===entry.item.id))){ toast('Delete the later retail sale before reversing this liquidation'); return; }
  if(items.some(entry=>db.refiningBatches.some(batch=>(batch.itemIds||[]).includes(entry.item.id)))){ toast('Delete the later refining batch before reversing this liquidation'); return; }
  if(items.some(({line,item})=>Number(item.currentWeight)+Number(line.weight||0)>Number(item.netWeight)+0.005)){ toast('Inventory weight has changed and this liquidation cannot be reversed safely'); return; }
  if(!await confirmDeletion('Delete liquidation?',`Remove this liquidation and restore its released stock to inventory.`,[
    {label:'Buyer',value:record.buyer},{label:'Date',value:fmtDate(record.date)},
    {label:'Weight restored',value:fmtWeight(record.releasedWeight)},{label:'Proceeds removed',value:fmtMoney(record.proceeds)}
  ])) return;
  items.forEach(({line,item})=>{
    item.currentWeight=roundWeight(Number(item.currentWeight)+Number(line.weight||0));
    item.cost=roundMoney(Number(item.cost)+Number(line.costPortion||0));
    if(item.currentWeight>0&&item.status==='Liquidated') item.status=line.previousStatus==='For Selling'?'Available':line.previousStatus|| (item.itemType==='Scrap'?'For Refining':'Available');
  });
  syncPoolsForLiquidationLines(record.lines,record.poolId);
  db.liquidations=db.liquidations.filter(l=>l.id!==record.id);
  closeAdminEditModal(); await saveDB(); render(); toast('Liquidation deleted and inventory restored');
}

/* ============================= REFINING ============================= */
let refMetal='Gold';
const refiningSelection=new Set();
let pendingInventoryRefiningIds=[];
function toggleRefiningSelection(id,checked){
  if(checked) refiningSelection.add(id); else refiningSelection.delete(id);
  updateRefiningCombinedSummary();
}
function changeRefiningMetal(metal){ refMetal=metal; refiningSelection.clear(); render(); }
function selectedRefiningItems(){
  return db.stock.filter(item=>refiningSelection.has(item.id)&&item.metal===refMetal&&item.status==='For Refining'&&Number(item.currentWeight)>0);
}
function updateRefiningCombinedSummary(){
  const items=selectedRefiningItems();
  const weight=items.reduce((sum,item)=>sum+Number(item.currentWeight),0);
  const cost=items.reduce((sum,item)=>sum+Number(item.cost||0),0);
  const countEl=document.getElementById('rf_selected_count'),weightEl=document.getElementById('rf_selected_weight'),costEl=document.getElementById('rf_selected_cost');
  if(countEl) countEl.textContent=String(items.length);
  if(weightEl) weightEl.textContent=fmtWeight(weight);
  if(costEl) costEl.textContent=fmtMoney(cost);
}
function closeInventoryRefiningConfirmation(){
  document.getElementById('inventory_refining_confirmation')?.remove();
  pendingInventoryRefiningIds=[];
}
function stageInventoryForRefining(items){
  if(!items.length||items.some(item=>!categorizableInventory(item))) return null;
  const metals=Array.from(new Set(items.map(item=>item.metal)));
  if(metals.length!==1) return null;
  items.forEach(item=>{item.status='For Refining';});
  refMetal=metals[0];
  refiningSelection.clear();
  items.forEach(item=>refiningSelection.add(item.id));
  inventoryMoveSelection.clear();
  return {metal:refMetal,itemIds:items.map(item=>item.id)};
}
function prepareInventoryForRefining(){
  const selected=selectedInventoryForCategory();
  if(!selected.length){ toast('Check at least one inventory record first'); return; }
  const metals=Array.from(new Set(selected.map(item=>item.metal)));
  if(metals.length!==1){ toast('A refining batch can contain only one metal'); return; }
  closeInventoryRefiningConfirmation();
  pendingInventoryRefiningIds=selected.map(item=>item.id);
  const totalWeight=selected.reduce((sum,item)=>sum+Number(item.currentWeight||0),0);
  const totalCost=selected.reduce((sum,item)=>sum+Number(item.cost||0),0);
  const modal=document.createElement('div'); modal.id='inventory_refining_confirmation'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="inventory-move-modal" role="dialog" aria-modal="true" aria-labelledby="inventory_refining_confirmation_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Confirm refining selection</div><h2 id="inventory_refining_confirmation_title">Move ${selected.length} ${selected.length===1?'item':'items'} to Refining?</h2></div><button class="modal-close" onclick="closeInventoryRefiningConfirmation()" aria-label="Close">×</button></div>
    <p class="move-confirmation-intro">These records will automatically be classified as <strong>For Refining</strong> and opened in the Refining page. This does not complete the refining process.</p>
    <div class="move-confirmation-summary"><div><span>Metal</span><strong>${esc(metals[0])}</strong></div><div><span>Selected items</span><strong>${selected.length}</strong></div><div><span>Total weight</span><strong>${fmtWeight(totalWeight)}</strong></div><div><span>Inventory cost</span><strong>${fmtMoney(totalCost)}</strong></div></div>
    <div class="table-wrap move-confirmation-items"><table><thead><tr><th>Inventory item</th><th>Status</th><th class="num-head">Weight</th><th class="num-head">Cost</th></tr></thead><tbody>${selected.map(item=>`<tr><td><strong>${esc(item.metal)} ${esc(item.karat)}</strong><br><span class="form-note">${esc(item.itemType)} · ${esc(item.customerName||'—')}</span></td><td>${esc(item.status)}</td><td class="num">${fmtWeight(item.currentWeight)}</td><td class="num">${fmtMoney(item.cost)}</td></tr>`).join('')}</tbody></table></div>
    <div class="form-actions"><button class="btn secondary" onclick="closeInventoryRefiningConfirmation()">Cancel</button><button class="btn" onclick="confirmInventoryForRefining()">Confirm &amp; open Refining</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeInventoryRefiningConfirmation();});
  document.body.appendChild(modal);
}
async function confirmInventoryForRefining(){
  const ids=[...pendingInventoryRefiningIds];
  const items=ids.map(id=>db.stock.find(item=>item.id===id)).filter(Boolean);
  const beforeState=JSON.parse(JSON.stringify(db));
  if(!ids.length||items.length!==ids.length||!stageInventoryForRefining(items)){
    closeInventoryRefiningConfirmation(); render(); toast('One or more selected items changed. Select the inventory again.'); return;
  }
  const saved=await saveDB();
  if(!saved){
    db=beforeState;
    inventoryMoveSelection.clear();
    refiningSelection.clear();
    closeInventoryRefiningConfirmation(); render(); toast('Inventory was not moved to Refining; changes were rolled back'); return;
  }
  const itemCount=items.length;
  closeInventoryRefiningConfirmation(); goTab('refining');
  toast(`${itemCount} ${itemCount===1?'item':'items'} moved to Refining`);
}
function renderRefining(){
  const eligible = db.stock.filter(s=>s.metal===refMetal && s.status==='For Refining' && s.currentWeight>0);
  Array.from(refiningSelection).forEach(id=>{if(!eligible.some(item=>item.id===id))refiningSelection.delete(id);});
  const selected=selectedRefiningItems();
  const selectedWeight=selected.reduce((sum,item)=>sum+Number(item.currentWeight),0);
  const selectedCost=selected.reduce((sum,item)=>sum+Number(item.cost||0),0);
  const outputPurities=distinctKarats(refMetal);
  return `
  <section class="block">
    <h2 class="block-title">1. Select items to combine</h2>
    <p class="form-note">Check every processed item that will become one refined inventory record.</p>
    <div class="filter-row">
      <div class="field"><label>Metal</label><select onchange="changeRefiningMetal(this.value)">
        ${['Gold','Silver','Platinum'].map(m=>`<option ${refMetal===m?'selected':''}>${m}</option>`).join('')}</select></div>
    </div>
    ${eligible.length? `
    <div class="item-check-row head"><span></span><span>Item</span><span>Weight</span><span>Cost</span><span></span><span></span></div>
    ${eligible.map(s=>`<div class="item-check-row" data-item="${s.id}">
      <input type="checkbox" class="ref-chk" onchange="toggleRefiningSelection('${s.id}',this.checked)" ${refiningSelection.has(s.id)?'checked':''}>
      <span>${fmtDate(s.date)} · ${esc(s.karat)} · ${esc(s.customerName)}</span>
      <span class="num">${fmtWeight(s.currentWeight)}</span><span class="num">${fmtMoney(s.cost)}</span><span></span><span></span>
      </div>`).join('')}
    ` : `<div class="empty-note">No ${refMetal.toLowerCase()} stock marked "For Refining".</div>`}
  </section>

  <section class="block">
    <h2 class="block-title">2. Create one refined item</h2>
    <p class="form-note">The selected records will be closed as Refined. Their costs are added together and carried into one finished item.</p>
    <div class="refining-combine-summary">
      <div><span>Selected items</span><strong id="rf_selected_count">${selected.length}</strong></div>
      <div><span>Total input weight</span><strong id="rf_selected_weight">${fmtWeight(selectedWeight)}</strong></div>
      <div><span>Combined inventory cost</span><strong id="rf_selected_cost">${fmtMoney(selectedCost)}</strong></div>
      <div class="combine-arrow" aria-hidden="true">→</div>
      <div class="combined-output-label"><span>Result</span><strong>1 refined item</strong></div>
    </div>
    <div class="form-grid refining-simple-output">
      <div class="field"><label>Output purity / karat</label><select id="rf_purity" required onchange="changeRefiningOutputPurity()">
        <option value="">— select purity —</option>${outputPurities.map(purity=>`<option value="${esc(purity)}">${esc(purity)}</option>`).join('')}<option value="__custom__">Custom karat / purity</option>
      </select></div>
      <div class="field is-hidden" id="rf_custom_purity_field"><label>Custom output karat / purity</label><input id="rf_custom_purity" type="text" maxlength="40" placeholder="e.g. 23K or 99.9%"></div>
      <div class="field"><label>Final refined weight (g)</label><input id="rf_returned" type="number" min="0.01" step="0.01" placeholder="e.g. 10.00"></div>
    </div>
    <div class="form-actions">
      <button class="btn" onclick="submitRefining()">Combine into one item</button>
      <span class="form-note">Example: 10K + 12K + 14K → one 24K item. The total cost is carried automatically.</span>
    </div>
  </section>

  <section class="block">
    <h2 class="block-title">Refining history</h2>
    ${tableOrEmpty(db.refiningBatches.slice().sort((a,b)=>b.date.localeCompare(a.date)),
      r=>`<tr><td><strong>${esc(r.id)}</strong></td><td>${fmtDate(r.date)}</td><td><span class="metal-tag ${r.metal.toLowerCase()}">${r.metal}</span></td><td>${esc(r.refiner)}</td><td>${esc(r.staff||'—')}</td><td class="num">${(r.itemIds||[]).length}</td>
      <td class="num">${fmtWeight(r.inputWeight)}</td><td class="num">${fmtMoney(r.inputCost)}</td><td>${esc(r.outputPurity||'—')} · ${fmtWeight(r.outputWeight??r.returnedMetal)}</td><td class="num">${fmtMoney(r.outputCost)}</td><td>${esc(r.status||'Completed')}</td>${isAdmin()?`<td>${adminEditButton('Refining',r.id)}</td>`:''}</tr>`,
      ['ID','Date','Metal','Refiner','Staff','Items','Input wt','Input cost','Output','Output value','Status',...(isAdmin()?['Actions']:[])],
      'No refining batches recorded yet.')}
  </section>
  `;
}
let pendingRefiningBatch=null;
function closeRefiningConfirmation(){ document.getElementById('refining_confirmation_modal')?.remove(); pendingRefiningBatch=null; }
function changeRefiningOutputPurity(){
  const isCustom=val('rf_purity')==='__custom__';
  document.getElementById('rf_custom_purity_field')?.classList.toggle('is-hidden',!isCustom);
  if(isCustom) document.getElementById('rf_custom_purity')?.focus();
}
function selectedRefiningOutputPurity(){
  const selected=val('rf_purity');
  return selected==='__custom__' ? val('rf_custom_purity').trim() : selected;
}
function submitRefining(){
  const chosen=selectedRefiningItems().map(item=>item.id);
  if(!chosen.length){ toast('Select at least one item for refining'); return; }
  const date=todayStr(),refiner='In-house refining',outputPurity=selectedRefiningOutputPurity();
  if(!outputPurity){ toast(val('rf_purity')==='__custom__'?'Enter the custom output purity or karat':'Select the output purity or karat'); return; }
  const returned=Number(val('rf_returned'));
  if(!Number.isFinite(returned)||returned<=0){ toast('Enter the output weight returned to inventory'); return; }
  const items=chosen.map(id=>db.stock.find(s=>s.id===id)).filter(Boolean);
  if(items.length!==chosen.length||items.some(item=>item.status!=='For Refining'||Number(item.currentWeight)<=0)){ toast('One or more selected items are no longer available for refining'); return; }
  const inputWeight=items.reduce((sum,item)=>sum+Number(item.currentWeight),0);
  const inputCost=items.reduce((sum,item)=>sum+Number(item.cost||0),0);
  const outputCost=roundMoney(inputCost),outputWeight=roundWeight(returned),outputStatus='Available';
  const remarks=`Combined from ${chosen.length} refined item${chosen.length===1?'':'s'}`;
  pendingRefiningBatch={chosen,date,refiner,outputPurity,expected:outputWeight,actual:outputWeight,charges:0,outputWeight,outputCost,outputStatus,remarks,metal:refMetal,inputWeight:roundWeight(inputWeight),inputCost:roundMoney(inputCost)};
  const modal=document.createElement('div'); modal.id='refining_confirmation_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="inventory-move-modal" role="dialog" aria-modal="true" aria-labelledby="refining_confirmation_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Confirm combined refined item</div><h2 id="refining_confirmation_title">${items.length} ${items.length===1?'item':'items'} will become 1 item</h2></div><button class="modal-close" onclick="closeRefiningConfirmation()" aria-label="Close">×</button></div>
    <p class="move-confirmation-intro">The original records will be marked Refined and replaced by one available ${esc(refMetal)} ${esc(outputPurity)} inventory item.</p>
    <div class="move-confirmation-summary"><div><span>Input items</span><strong>${items.length}</strong></div><div><span>Total input weight</span><strong>${fmtWeight(inputWeight)}</strong></div><div><span>Combined cost</span><strong>${fmtMoney(inputCost)}</strong></div><div><span>New inventory item</span><strong>${esc(outputPurity)} · ${fmtWeight(outputWeight)}</strong></div></div>
    <div class="table-wrap move-confirmation-items"><table><thead><tr><th>Input item</th><th>Customer</th><th class="num-head">Weight</th><th class="num-head">Cost</th></tr></thead><tbody>${items.map(item=>`<tr><td><strong>${esc(item.metal)} ${esc(item.karat)}</strong><br><span class="form-note">${esc(item.itemType)} · ${fmtDate(item.date)}</span></td><td>${esc(item.customerName||'—')}</td><td class="num">${fmtWeight(item.currentWeight)}</td><td class="num">${fmtMoney(item.cost)}</td></tr>`).join('')}</tbody></table></div>
    <div class="form-actions"><button class="btn secondary" onclick="closeRefiningConfirmation()">Cancel</button><button class="btn" onclick="confirmRefiningBatch()">Confirm &amp; create one item</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeRefiningConfirmation();}); document.body.appendChild(modal);
}
async function confirmRefiningBatch(){
  const pending=pendingRefiningBatch; if(!pending) return;
  const items=pending.chosen.map(id=>db.stock.find(s=>s.id===id)).filter(Boolean);
  if(items.length!==pending.chosen.length||items.some(item=>item.status!=='For Refining'||Number(item.currentWeight)<=0)){ closeRefiningConfirmation(); toast('One or more input items changed. Review the batch again.'); render(); return; }
  const itemSnapshots=items.map(item=>({itemId:item.id,currentWeight:Number(item.currentWeight),status:item.status,cost:Number(item.cost)||0}));
  const beforeState=JSON.parse(JSON.stringify(db));
  items.forEach(item=>{ item.currentWeight=0; item.cost=0; item.status='Refined'; });
  const batchId=nextSequenceId('R',db.refiningBatches), outputItemId=uid('stk');
  const {date,refiner,outputPurity,outputWeight,outputCost,outputStatus,remarks,metal,inputWeight,inputCost,expected,actual,charges}=pending;
  db.stock.push({id:outputItemId,date,customerId:'',customerName:`Refining output · ${refiner}`,metal,itemType:'Scrap',karat:outputPurity,
    grossWeight:outputWeight,deductions:0,netWeight:outputWeight,currentWeight:outputWeight,rate:roundMoney(outputCost/outputWeight),
    suggestedAmount:0,payout:0,overrideReason:'',paymentMethod:'Refining transfer',staff:currentUser?.displayName||refiner,
    status:outputStatus,remarks:remarks||`Consolidated from ${pending.chosen.length} refining items`,cost:outputCost,sourceRefiningBatchId:batchId});
  db.refiningBatches.push({id:batchId,date,metal,refiner,staff:currentUser?.displayName||'',status:'Completed',itemIds:pending.chosen,itemSnapshots,outputItemId,outputMetal:metal,outputPurity,outputWeight,
    outputStatus,inputCost:roundMoney(inputCost),outputCost,inputWeight:roundWeight(inputWeight),expectedYield:roundWeight(expected),actualYield:roundWeight(actual),
    variance:roundWeight(actual-expected),refiningCharges:roundMoney(charges),returnedMetal:outputWeight,remarks});
  const itemCount=pending.chosen.length;
  const saved=await saveDB();
  if(!saved){ db=beforeState; closeRefiningConfirmation(); render(); toast('Refining batch was not recorded; all inventory changes were rolled back'); return; }
  refiningSelection.clear();
  closeRefiningConfirmation(); render(); toast(`${batchId}: ${itemCount} ${itemCount===1?'item':'items'} consolidated into 1 inventory item`);
}
let editingRefiningId=null;
function openRefiningEdit(id){
  const record=db.refiningBatches.find(r=>r.id===id); if(!record||!adminEditGuard()) return;
  editingRefiningId=id;
  const outputLocked=Boolean(record.outputItemId);
  openAdminEditModal('Edit refining batch',`<div class="form-grid">
    <div class="field"><label>Date</label><input id="edit_refining_date" type="date" value="${esc(record.date||todayStr())}"></div>
    <div class="field"><label>Refiner</label><input id="edit_refining_refiner" value="${esc(record.refiner||'')}"></div>
    <div class="field"><label>Expected yield (g)</label><input id="edit_refining_expected" type="number" min="0" step="0.01" value="${Number(record.expectedYield)||0}"></div>
    <div class="field"><label>Actual yield (g)</label><input id="edit_refining_actual" type="number" min="0" step="0.01" value="${Number(record.actualYield)||0}" ${outputLocked?'readonly':''}></div>
    <div class="field"><label>Refining charges (PHP)</label><input id="edit_refining_charges" type="number" min="0" step="0.01" value="${Number(record.refiningCharges)||0}" ${outputLocked?'readonly':''}></div>
    <div class="field"><label>Output weight (g)</label><input id="edit_refining_returned" type="number" min="0" step="0.01" value="${Number(record.outputWeight??record.returnedMetal)||0}" ${outputLocked?'readonly':''}></div>
    <div class="field span-2"><label>Remarks</label><textarea id="edit_refining_remarks">${esc(record.remarks||'')}</textarea></div>
  </div><p class="form-note">${outputLocked?'Output purity, weight, charges, and input items are locked because they define the consolidated inventory item.':'Input items and input weight remain locked. Variance is recalculated automatically.'}</p>`,'saveRefiningEdit','deleteRefiningRecord');
}
async function saveRefiningEdit(){
  if(!adminEditGuard()) return;
  const record=db.refiningBatches.find(r=>r.id===editingRefiningId); if(!record) return;
  const expected=Number(val('edit_refining_expected')),actual=Number(val('edit_refining_actual')),charges=Number(val('edit_refining_charges')),returned=Number(val('edit_refining_returned'));
  if(!val('edit_refining_date')||!val('edit_refining_refiner').trim()){ toast('Date and refiner are required'); return; }
  if([expected,actual,charges,returned].some(value=>!Number.isFinite(value)||value<0)){ toast('Yield, charges, and returned metal must be valid non-negative values'); return; }
  const date=val('edit_refining_date'),refiner=val('edit_refining_refiner').trim(),remarks=val('edit_refining_remarks').trim();
  Object.assign(record,{date,refiner,expectedYield:roundWeight(expected),actualYield:roundWeight(actual),variance:roundWeight(actual-expected),refiningCharges:roundMoney(charges),returnedMetal:roundWeight(returned),remarks});
  const outputItem=record.outputItemId?db.stock.find(item=>item.id===record.outputItemId):null;
  if(outputItem){ outputItem.date=date; outputItem.customerName=`Refining output · ${refiner}`; if(remarks) outputItem.remarks=remarks; }
  closeAdminEditModal(); await saveDB(); render(); toast('Refining batch updated');
}
async function deleteRefiningRecord(){
  if(!adminEditGuard()) return;
  const record=db.refiningBatches.find(r=>r.id===editingRefiningId); if(!record) return;
  const snapshots=(record.itemSnapshots?.length?record.itemSnapshots:(record.itemIds||[]).map(itemId=>{
    const item=db.stock.find(s=>s.id===itemId);
    const previouslyReleased=db.liquidations.reduce((sum,batch)=>sum+(batch.lines||[]).filter(line=>line.itemId===itemId).reduce((lineSum,line)=>lineSum+Number(line.weight||0),0),0);
    return {itemId,currentWeight:Math.max(0,(Number(item?.netWeight)||0)-previouslyReleased),status:'For Refining'};
  }));
  const items=snapshots.map(snapshot=>({snapshot,item:db.stock.find(s=>s.id===snapshot.itemId)}));
  if(items.some(entry=>!entry.item)){ toast('Cannot reverse this batch because an inventory item is missing'); return; }
  const outputItem=record.outputItemId?db.stock.find(item=>item.id===record.outputItemId):null;
  if(record.outputItemId&&!outputItem){ toast('Cannot reverse this batch because its output inventory item is missing'); return; }
  if(outputItem){
    const usedInLiquidation=db.liquidations.some(batch=>(batch.lines||[]).some(line=>line.itemId===outputItem.id));
    const usedInRefining=db.refiningBatches.some(batch=>batch.id!==record.id&&(batch.itemIds||[]).includes(outputItem.id));
    const usedInRetail=db.retailSales.some(sale=>sale.itemId===outputItem.id);
    if(usedInLiquidation||usedInRefining||usedInRetail){ toast('Delete the later transaction using the refined output before reversing this batch'); return; }
    if(Math.abs(Number(outputItem.currentWeight)-Number(record.outputWeight??record.returnedMetal))>0.005||Math.abs(Number(outputItem.cost)-Number(record.outputCost))>0.01){
      toast('The refined output inventory has changed and this batch cannot be reversed safely'); return;
    }
  }
  if(items.some(entry=>entry.item.status==='Sold'||db.retailSales.some(sale=>sale.itemId===entry.item.id))){ toast('Delete the later retail sale before reversing this refining batch'); return; }
  if(items.some(entry=>Number(entry.item.currentWeight)!==0||!['Refined','Liquidated'].includes(entry.item.status))){ toast('Inventory has changed and this refining batch cannot be reversed safely'); return; }
  if(!await confirmDeletion('Delete refining batch?',`Remove the refined output and restore the original input inventory.`,[
    {label:'Refiner',value:record.refiner},{label:'Date',value:fmtDate(record.date)},
    {label:'Input items restored',value:String(items.length)},{label:'Output removed',value:fmtWeight(record.outputWeight??record.returnedMetal)}
  ])) return;
  if(outputItem) db.stock=db.stock.filter(item=>item.id!==outputItem.id);
  items.forEach(({snapshot,item})=>{ item.currentWeight=roundWeight(snapshot.currentWeight); item.cost=roundMoney(snapshot.cost??item.cost); item.status=snapshot.status||'For Refining'; });
  db.refiningBatches=db.refiningBatches.filter(r=>r.id!==record.id);
  closeAdminEditModal(); await saveDB(); render(); toast('Refining batch deleted and inventory restored');
}

/* ============================= RETAIL SALES ============================= */
let lastRetailSaleId=null;
let retailSaleSaving=false;
function renderRetail(){
  const eligible = db.stock.filter(s=>!s.inventoryPoolId&&s.status==='Available' && s.itemType==='Jewelry' && s.currentWeight>0);
  return `
  <section class="block">
    <h2 class="block-title">Sell a jewelry item</h2>
    <div class="form-grid">
      <div class="field span-2"><label>Item</label>
        <select id="rt_item" onchange="selectRetailSaleItem()">
          <option value="">— choose item —</option>
          ${eligible.map(s=>`<option value="${s.id}">${fmtDate(s.date)} · ${s.metal} ${esc(s.karat)} · ${fmtWeight(s.currentWeight)} · cost ${fmtMoney(s.cost)}</option>`).join('')}
        </select>
        ${!eligible.length? `<span class="hint">No available jewelry is currently in stock.</span>`:''}
      </div>
      <div class="field"><label>Buyer name</label><input id="rt_buyer" placeholder="Walk-in customer"></div>
      <div class="field"><label>Sale date</label><input id="rt_date" type="date" value="${todayStr()}"></div>
      <div class="field"><label>Weight to sell (g)</label><input id="rt_weight" type="number" min="0.01" step="0.01" disabled oninput="updateRetailSalePreview()"><span class="hint" id="rt_weight_hint">Choose an item first.</span></div>
      <div class="field"><label>Cost basis (automatic)</label><input id="rt_cost" value="" readonly><span class="hint" id="rt_remaining_hint"></span></div>
      <div class="field"><label>Sale price (PHP)</label><input id="rt_price" type="number" min="0" step="0.01"></div>
    </div>
    <div class="form-actions"><button class="btn" id="record_retail_sale" onclick="submitRetail()">Record sale</button></div>
  </section>

  <section class="block">
    <h2 class="block-title">Retail sales history</h2>
    ${tableOrEmpty(db.retailSales.slice().sort((a,b)=>b.date.localeCompare(a.date)),
      r=>`<tr><td>${fmtDate(r.date)}</td><td>${esc(r.buyer)}</td><td class="num">${fmtWeight(r.weight)}</td><td class="num">${fmtMoney(r.salePrice)}</td>
      <td class="num">${fmtMoney(r.cost)}</td><td class="num" style="color:${r.margin>=0?'var(--sage)':'var(--rust)'}">${fmtMoney(r.margin)}</td><td><div class="form-actions"><button class="btn secondary small" onclick="printRetailSummary('${r.id}')">Summary</button>${adminEditButton('Retail',r.id)}</div></td></tr>`,
      ['Date','Buyer','Weight','Sale price','Cost','Margin','Actions'],
      'No retail sales recorded yet.')}
  </section>
  `;
}
function prepareRetailSaleAllocation(item,requestedWeight){
  const availableWeight=roundWeight(Number(item?.currentWeight||0)),availableCost=roundMoney(Number(item?.cost||0)),weight=roundWeight(Number(requestedWeight));
  if(!item||item.inventoryPoolId||item.status!=='Available'||item.itemType!=='Jewelry'||weight<0.01||weight>availableWeight+0.005)return null;
  const soldWeight=weight>=availableWeight-0.005?availableWeight:weight,cost=soldWeight===availableWeight?availableCost:roundMoney(availableCost*(soldWeight/availableWeight));
  return {weight:soldWeight,cost,remainingWeight:roundWeight(availableWeight-soldWeight),remainingCost:roundMoney(availableCost-cost)};
}
function selectRetailSaleItem(){
  const item=db.stock.find(record=>record.id===val('rt_item')),weight=document.getElementById('rt_weight');
  if(weight){weight.disabled=!item;weight.max=item?String(item.currentWeight):'';weight.value=item?String(item.currentWeight):'';}
  updateRetailSalePreview();
}
function updateRetailSalePreview(){
  const item=db.stock.find(record=>record.id===val('rt_item')),prepared=prepareRetailSaleAllocation(item,val('rt_weight'));
  const cost=document.getElementById('rt_cost'),weightHint=document.getElementById('rt_weight_hint'),remainingHint=document.getElementById('rt_remaining_hint');
  if(cost)cost.value=prepared?fmtMoneyExact(prepared.cost):'';
  if(weightHint)weightHint.textContent=item?`${fmtWeight(item.currentWeight)} available`:'Choose an item first.';
  if(remainingHint)remainingHint.textContent=prepared?`${fmtWeight(prepared.remainingWeight)} and ${fmtMoneyExact(prepared.remainingCost)} will remain in Inventory.`:'';
}
function applyRetailSaleAllocation(item,prepared,details){
  if(!item||!prepared||!details||Number(details.salePrice)<=0)return null;
  const previousStatus=item.status;
  item.currentWeight=prepared.remainingWeight;item.cost=prepared.remainingCost;item.status=prepared.remainingWeight>0?'Available':'Sold';
  const sale={id:uid('rtl'),date:details.date,itemId:item.id,buyer:details.buyer||'Walk-in',salePrice:roundMoney(details.salePrice),cost:prepared.cost,margin:roundMoney(Number(details.salePrice)-prepared.cost),itemSummary:`${item.metal} ${item.karat} ${item.itemType}`,weight:prepared.weight,inventoryAllocation:true,partialAllocation:prepared.remainingWeight>0,previousStatus,remainingWeightAfter:prepared.remainingWeight,remainingCostAfter:prepared.remainingCost};
  db.retailSales.push(sale);lastRetailSaleId=sale.id;return sale;
}
async function submitRetail(){
  if(retailSaleSaving)return;
  const itemId = val('rt_item');
  if(!itemId){ toast('Choose an item to sell'); return; }
  const item = db.stock.find(s=>s.id===itemId);
  const price = parseFloat(val('rt_price'));
  if(!price || price<=0){ toast('Enter a valid sale price'); return; }
  const prepared=prepareRetailSaleAllocation(item,val('rt_weight'));
  if(!prepared){toast(`Enter a weight between 0.01 g and ${Number(item?.currentWeight||0).toFixed(2)} g`);return;}
  const buyer = val('rt_buyer').trim() || 'Walk-in';
  const beforeState=JSON.parse(JSON.stringify(db)),button=document.getElementById('record_retail_sale');retailSaleSaving=true;if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
  try{
    const sale=applyRetailSaleAllocation(item,prepared,{buyer,date:val('rt_date'),salePrice:price});
    if(!sale){toast('The retail sale could not be prepared');return;}
    if(!await saveDB()){db=beforeState;render();toast('The retail sale was not recorded');return;}
    render();toast(prepared.remainingWeight>0?`Partial sale recorded; ${fmtWeight(prepared.remainingWeight)} remains in Inventory`:'Sale recorded');
  } finally {retailSaleSaving=false;const currentButton=document.getElementById('record_retail_sale');if(currentButton){currentButton.disabled=false;currentButton.removeAttribute('aria-busy');}}
}
let editingRetailId=null;
function openRetailEdit(id){
  const record=db.retailSales.find(r=>r.id===id); if(!record||!adminEditGuard()) return;
  editingRetailId=id;
  openAdminEditModal('Edit retail sale',`<div class="form-grid">
    <div class="field"><label>Sale date</label><input id="edit_retail_date" type="date" value="${esc(record.date||todayStr())}"></div>
    <div class="field"><label>Buyer</label><input id="edit_retail_buyer" value="${esc(record.buyer||'')}"></div>
    <div class="field span-2"><label>Sale price (PHP)</label><input id="edit_retail_price" type="number" min="0" step="0.01" value="${Number(record.salePrice)}"></div>
  </div><p class="form-note">The sold item and inventory cost remain locked. Margin is recalculated automatically.</p>`,'saveRetailEdit','deleteRetailRecord');
}
async function saveRetailEdit(){
  if(!adminEditGuard()) return;
  const record=db.retailSales.find(r=>r.id===editingRetailId); if(!record) return;
  const price=Number(val('edit_retail_price')),buyer=val('edit_retail_buyer').trim();
  if(!val('edit_retail_date')||!buyer){ toast('Date and buyer are required'); return; }
  if(!Number.isFinite(price)||price<=0){ toast('Enter a valid sale price'); return; }
  record.date=val('edit_retail_date'); record.buyer=buyer; record.salePrice=roundMoney(price); record.margin=roundMoney(price-Number(record.cost));
  closeAdminEditModal(); await saveDB(); render(); toast('Retail sale updated');
}
async function deleteRetailRecord(){
  if(!adminEditGuard()) return;
  const record=db.retailSales.find(r=>r.id===editingRetailId); if(!record) return;
  const item=db.stock.find(s=>s.id===record.itemId);
  if(!item){ toast('Cannot reverse this sale because its inventory item is missing'); return; }
  if(record.inventoryAllocation===true){
    const remainingWeight=roundWeight(record.remainingWeightAfter),remainingCost=roundMoney(record.remainingCostAfter),expectedStatus=remainingWeight>0?'Available':'Sold';
    if(item.status!==expectedStatus||Math.abs(Number(item.currentWeight)-remainingWeight)>.005||Math.abs(Number(item.cost)-remainingCost)>.01){toast('Delete later transactions for this jewelry item before reversing this sale');return;}
    if(!await confirmDeletion('Delete retail sale?',`Remove this sale and restore its sold weight and cost to inventory.`,[
      {label:'Buyer',value:record.buyer},{label:'Date',value:fmtDate(record.date)},
      {label:'Weight restored',value:fmtWeight(record.weight)},{label:'Cost restored',value:fmtMoney(record.cost)}
    ]))return;
    const beforeState=JSON.parse(JSON.stringify(db));
    item.currentWeight=roundWeight(Number(item.currentWeight)+Number(record.weight||0));item.cost=roundMoney(Number(item.cost)+Number(record.cost||0));item.status=record.previousStatus||'Available';
    db.retailSales=db.retailSales.filter(r=>r.id!==record.id);
    if(!await saveDB()){db=beforeState;render();toast('The retail sale was not deleted');return;}
    closeAdminEditModal();render();toast('Retail sale deleted and sold balance restored');return;
  }
  if(item.status!=='Sold'||Number(item.currentWeight)!==0){ toast('Inventory has changed and this retail sale cannot be reversed safely'); return; }
  if(!await confirmDeletion('Delete retail sale?',`Remove this sale and return the jewelry item to available inventory.`,[
    {label:'Buyer',value:record.buyer},{label:'Date',value:fmtDate(record.date)},
    {label:'Item',value:record.itemSummary||`${item.metal} ${item.karat} ${item.itemType}`},{label:'Sale amount',value:fmtMoney(record.salePrice)}
  ])) return;
  const previouslyReleased=db.liquidations.reduce((sum,batch)=>sum+(batch.lines||[]).filter(line=>line.itemId===item.id).reduce((lineSum,line)=>lineSum+Number(line.weight||0),0),0);
  item.currentWeight=roundWeight(Math.min(Number(record.weight)||Number(item.netWeight),Math.max(0,Number(item.netWeight)-previouslyReleased))); item.status='Available';
  db.retailSales=db.retailSales.filter(r=>r.id!==record.id);
  closeAdminEditModal(); await saveDB(); render(); toast('Retail sale deleted and item restored');
}
function printRetailSummary(id){
  const sale=db.retailSales.find(r=>r.id===id), item=sale&&db.stock.find(s=>s.id===sale.itemId);
  if(!sale){ toast('Sale summary not found'); return; }
  const summary=sale.itemSummary||(item?`${item.metal} ${item.karat} ${item.itemType}`:'Jewelry item');
  const weight=sale.weight||(item&&item.netWeight)||0;
  const w=window.open('','_blank','width=620,height=700');
  if(!w){ toast('Allow pop-ups to open the transaction summary'); return; }
  w.document.write(`<!doctype html><html><head><title>Retail Sale ${esc(sale.id)}</title><style>body{font-family:Arial,sans-serif;max-width:620px;margin:45px auto;color:#222}h1{font-family:Georgia,serif}table{width:100%;border-collapse:collapse;margin-top:24px}td{padding:10px;border-bottom:1px solid #ddd}td:last-child{text-align:right}.foot{margin-top:35px;font-size:12px;color:#666}@media print{button{display:none}}</style></head><body><h1>ZPP Gold Trading</h1><p>Retail transaction summary</p><table><tr><td>Reference</td><td>${esc(sale.id)}</td></tr><tr><td>Date</td><td>${esc(fmtDate(sale.date))}</td></tr><tr><td>Buyer</td><td>${esc(sale.buyer)}</td></tr><tr><td>Item</td><td>${esc(summary)}</td></tr><tr><td>Weight</td><td>${esc(fmtWeight(weight))}</td></tr><tr><td>Sale price</td><td>${esc(fmtMoney(sale.salePrice))}</td></tr></table><p class="foot">This summary records the selected jewelry item removed from available inventory.</p><button onclick="window.print()">Print</button></body></html>`);
  w.document.close();
}

/* ============================= USER ACCOUNTS ============================= */
function renderUsers(){
  if(!isAdmin()) return '<div class="empty-note">Administrator access required.</div>';
  return `
  <section class="block">
    <h2 class="block-title">Create an account</h2>
    <div class="form-grid">
      <div class="field"><label>Account holder</label><input id="usr_name" placeholder="Full name"></div>
      <div class="field"><label>Username</label><input id="usr_username" autocomplete="off" placeholder="e.g. juan.santos"></div>
      <div class="field"><label>Temporary password</label><input id="usr_password" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div>
      <div class="field"><label>Role and access</label><select id="usr_role" onchange="updateRoleDescription()"><option value="staff">Staff — limited access</option><option value="admin">Admin — full access</option></select><span class="hint" id="usr_role_description">Can view rates, override grades, record purchases, view inventory, and manage customers.</span></div>
    </div>
    <div class="form-actions"><button class="btn" onclick="createUserAccount()">Create account</button><span class="form-note">Only administrators can create accounts or grant administrator access.</span></div>
  </section>
  <section class="block">
    <h2 class="block-title">Accounts</h2>
    <div id="user_accounts_table">${renderUserAccountsTable()}</div>
  </section>`;
}
function renderUserAccountsTable(){
  return tableOrEmpty(userAccounts,
    user=>`<tr><td>${esc(user.displayName)}</td><td>${esc(user.username)}</td><td>${esc(user.role)}</td><td>${user.active?'Active':'Disabled'}</td><td>${esc(new Date(user.createdAt).toLocaleDateString('en-PH'))}</td><td>${adminEditButton('User',user.id)}</td></tr>`,
    ['Name','Username','Role','Status','Created','Actions'], 'Loading accounts…');
}
async function loadUserAccounts(){
  if(!isAdmin()) return;
  try{
    const response=await fetch('/api/users',{cache:'no-store'});
    if(!response.ok) throw new Error('Could not load accounts');
    userAccounts=(await response.json()).users||[];
    const container=document.getElementById('user_accounts_table');
    if(container) container.innerHTML=renderUserAccountsTable();
  }catch(error){ toast(error.message||'Could not load accounts'); }
}
function updateRoleDescription(){
  const description=document.getElementById('usr_role_description');
  if(description) description.textContent=val('usr_role')==='admin'
    ? 'Full access to pricing, purchases, inventory, liquidation, refining, retail sales, reports, and user accounts.'
    : 'Can view rates, override grades, record purchases, view inventory, and manage customers.';
}
async function createUserAccount(){
  const displayName=val('usr_name').trim(),username=val('usr_username').trim(),password=val('usr_password'),role=val('usr_role');
  try{
    const response=await fetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName,username,password,role})});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error||'Could not create account');
    toast(`${role==='admin'?'Admin':'Staff'} account ${result.user.username} created`);
    ['usr_name','usr_username','usr_password'].forEach(id=>{const input=document.getElementById(id);if(input)input.value='';});
    await loadUserAccounts();
  }catch(error){ toast(error.message||'Could not create account'); }
}
let editingUserId=null;
function openUserEdit(id){
  const account=userAccounts.find(user=>user.id===id); if(!account||!adminEditGuard()) return;
  editingUserId=id;
  openAdminEditModal('Edit user account',`<div class="form-grid">
    <div class="field"><label>Account holder</label><input id="edit_user_name" value="${esc(account.displayName)}"></div>
    <div class="field"><label>Username</label><input value="${esc(account.username)}" disabled><span class="hint">Usernames cannot be changed.</span></div>
    <div class="field"><label>Role and access</label><select id="edit_user_role"><option value="staff" ${account.role==='staff'?'selected':''}>Staff — limited access</option><option value="admin" ${account.role==='admin'?'selected':''}>Admin — full access</option></select></div>
    <div class="field"><label>Account status</label><select id="edit_user_active"><option value="true" ${account.active?'selected':''}>Active</option><option value="false" ${!account.active?'selected':''}>Disabled</option></select></div>
    <div class="field"><label>New password <span class="hint">optional</span></label><input id="edit_user_password" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div>
    <div class="field"><label>Confirm new password</label><input id="edit_user_password_confirm" type="password" autocomplete="new-password" placeholder="Re-enter the new password"></div>
  </div><p class="form-note">Leave both password fields blank to keep the current password. Changing your own password signs you out so you can verify the new one.</p>`,'saveUserEdit','deleteUserRecord');
}
async function saveUserEdit(){
  if(!adminEditGuard()) return;
  const account=userAccounts.find(user=>user.id===editingUserId); if(!account) return;
  const displayName=val('edit_user_name').trim(),role=val('edit_user_role'),active=val('edit_user_active')==='true',password=val('edit_user_password'),passwordConfirm=val('edit_user_password_confirm');
  if(!displayName){ toast('Account holder name is required'); return; }
  if(password&&password.length<8){ toast('New password must be at least 8 characters'); return; }
  if(password!==passwordConfirm){ toast('New passwords do not match'); return; }
  try{
    const response=await fetch(`/api/users/${encodeURIComponent(account.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName,role,active,password})});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error||'Could not update account');
    closeAdminEditModal();
    if(currentUser?.id===account.id&&password){
      await signOut();
      toast('Password updated. Sign in again using the new password.');
      return;
    }
    if(currentUser?.id===account.id){ currentUser={...currentUser,displayName:result.user.displayName}; showApp(); }
    await loadUserAccounts(); toast('User account updated');
  }catch(error){ toast(error.message||'Could not update account'); }
}
async function deleteUserRecord(){
  if(!adminEditGuard()) return;
  const account=userAccounts.find(user=>user.id===editingUserId); if(!account) return;
  if(account.id===currentUser?.id){ toast('You cannot delete the account currently signed in'); return; }
  if(!await confirmDeletion('Delete user account?',`Permanently remove this account and revoke its access.`,[
    {label:'Username',value:account.username},{label:'Role',value:account.role||'User'}
  ])) return;
  try{
    const response=await fetch(`/api/users/${encodeURIComponent(account.id)}`,{method:'DELETE'});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error||'Could not delete account');
    closeAdminEditModal(); await loadUserAccounts(); toast('User account deleted');
  }catch(error){ toast(error.message||'Could not delete account'); }
}

/* ============================= REPORTS ============================= */
function toCSV(rows, columns){
  const head = columns.map(c=>c.label).join(',');
  const body = rows.map(r=>columns.map(c=>{
    let v = typeof c.get==='function' ? c.get(r) : r[c.key];
    v = (v==null?'':String(v)).replace(/"/g,'""');
    return `"${v}"`;
  }).join(',')).join('\n');
  return head+'\n'+body;
}
function downloadCSV(filename, csv){
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function exportStock(){ downloadCSV('zpp_inventory.csv', toCSV(db.stock, [
  {label:'Date',key:'date'},{label:'Customer',key:'customerName'},{label:'Metal',key:'metal'},{label:'Karat',key:'karat'},
  {label:'Item type',key:'itemType'},{label:'Gross weight',key:'grossWeight'},{label:'Deductions',key:'deductions'},
  {label:'Net weight',key:'netWeight'},{label:'Current weight',key:'currentWeight'},{label:'Rate',key:'rate'},
  {label:'Payout',key:'payout'},{label:'Cost remaining',key:'cost'},{label:'Status',key:'status'},{label:'Staff',key:'staff'}
])); }
function exportLiquidations(){ downloadCSV('zpp_liquidations.csv', toCSV(liquidationHistoryRecords(), [
  {label:'Liquidation ID',key:'id'},{label:'Date',key:'date'},{label:'Metal',key:'metal'},{label:'Buyer/Refiner',key:'buyer'},{label:'Number of items',get:record=>(record.lines||[]).length||record.itemCount||0},{label:'Released weight',key:'releasedWeight'},
  {label:'Total sold by item',get:record=>(record.lines||[]).map(line=>`${line.assay||'Item'}: ${Number(line.sellingAmount??line.proceeds)||0}`).join(' | ')},
  {label:'Total sold',key:'proceeds'},{label:'Payment status',key:'paymentStatus'},{label:'Total cost',key:'cost'},{label:'Profit',key:'margin'}
])); }
function exportRefining(){ downloadCSV('zpp_refining.csv', toCSV(db.refiningBatches, [
  {label:'Refining ID',key:'id'},{label:'Date',key:'date'},{label:'Metal',key:'metal'},{label:'Refiner',key:'refiner'},{label:'Staff',key:'staff'},
  {label:'Input item IDs',get:r=>(r.itemIds||[]).join(' | ')},{label:'Input weight',key:'inputWeight'},{label:'Input cost',key:'inputCost'},
  {label:'Expected yield',key:'expectedYield'},{label:'Actual yield',key:'actualYield'},{label:'Variance',key:'variance'},
  {label:'Charges',key:'refiningCharges'},{label:'Output purity',key:'outputPurity'},{label:'Output weight',get:r=>r.outputWeight??r.returnedMetal},
  {label:'Output inventory cost',key:'outputCost'},{label:'Status',key:'status'},{label:'Notes',key:'remarks'}
])); }
function exportPurchases(){ downloadCSV('zpp_purchase_history.csv', toCSV(purchaseHistoryRecords(), [
  {label:'Date',key:'date'},{label:'Seller',key:'customerName'},{label:'Metal',key:'metal'},{label:'Karat / purity',key:'karat'},
  {label:'Item type',key:'itemType'},{label:'Net weight',key:'netWeight'},{label:'Rate',key:'rate'},{label:'Payout',key:'payout'},
  {label:'Payment method',key:'paymentMethod'},{label:'Staff',key:'staff'},{label:'Status',key:'status'}
])); }
function exportRetail(){ downloadCSV('zpp_retail_sales.csv', toCSV(db.retailSales, [
  {label:'Date',key:'date'},{label:'Buyer',key:'buyer'},{label:'Weight',key:'weight'},{label:'Sale price',key:'salePrice'},{label:'Cost',key:'cost'},{label:'Margin',key:'margin'}
])); }
function exportCustomers(){ downloadCSV('zpp_customers.csv', toCSV(db.customers, [
  {label:'Name',key:'name'},{label:'Contact',key:'contact'},{label:'Notes',key:'notes'}
])); }
function exportRates(){ downloadCSV('zpp_rate_history.csv', toCSV(visiblePricingHistory(), [
  {label:'Effective date',key:'effectiveDate'},{label:'Entered by',key:'enteredBy'},
  {label:'Gold 24K base',get:h=>h.snapshot.gold.base},{label:'Silver base',get:h=>h.snapshot.silver.base},{label:'Platinum base',get:h=>h.snapshot.platinum.base}
])); }

function closeCustomerHistoryModal(){ document.getElementById('customer_history_modal')?.remove(); }
function filterCustomerHistory(value){
  const query=String(value||'').trim().toLowerCase();
  const rows=Array.from(document.querySelectorAll('#customer_history_results [data-customer-history-search]'));
  let visible=0;
  rows.forEach(row=>{
    const matches=!query||String(row.dataset.customerHistorySearch||'').includes(query);
    row.hidden=!matches;
    if(matches) visible+=1;
  });
  const count=document.getElementById('customer_history_result_count');
  if(count) count.textContent=`Showing ${visible} of ${rows.length}`;
  document.getElementById('customer_history_search_empty')?.classList.toggle('is-hidden',visible>0||!rows.length);
}
function openCustomerHistoryModal(){
  closeCustomerHistoryModal();
  const purchases=purchaseHistoryRecords();
  const customers=db.customers.filter(customer=>purchases.some(item=>item.customerId===customer.id));
  const modal=document.createElement('div'); modal.id='customer_history_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="inventory-move-modal" role="dialog" aria-modal="true" aria-labelledby="customer_history_title">
    <div class="summary-modal-head"><div><div class="eyebrow">${esc(purchaseHistoryFilterLabel())}</div><h2 id="customer_history_title">Customer history</h2><p class="form-note">Purchase totals grouped by customer for the selected dates.</p></div><button class="modal-close" onclick="closeCustomerHistoryModal()" aria-label="Close">×</button></div>
    <div class="dashboard-report-search customer-history-search"><div class="field"><label for="customer_history_search">Search customer</label><input id="customer_history_search" type="search" autocomplete="off" placeholder="Type a customer name" oninput="filterCustomerHistory(this.value)"></div><span id="customer_history_result_count">Showing ${customers.length} of ${customers.length}</span></div>
    <div id="customer_history_search_empty" class="empty-note is-hidden">No customers match your search.</div>
    <div id="customer_history_results">${tableOrEmpty(customers,customer=>{
      const history=purchases.filter(item=>item.customerId===customer.id);
      const totalWeight=history.reduce((sum,item)=>sum+Number(item.netWeight||0),0);
      const totalPayout=history.reduce((sum,item)=>sum+Number(item.payout||0),0);
      return `<tr data-customer-history-search="${dashboardSearchValue(customer.name,customer.contact)}"><td data-label="Customer"><strong>${esc(customer.name)}</strong></td><td data-label="Transactions" class="num">${history.length}</td><td data-label="Total weight sold" class="num">${fmtWeight(totalWeight)}</td><td data-label="Total payout" class="num">${fmtMoney(totalPayout)}</td></tr>`;
    },['Customer','Transactions','Total weight sold','Total payout'],'No customer purchases match the selected dates.')}</div>
    <div class="form-actions" style="justify-content:flex-end;margin-top:18px;"><button class="btn" onclick="closeCustomerHistoryModal()">Close</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closeCustomerHistoryModal();});
  document.body.appendChild(modal); modal.querySelector('#customer_history_search')?.focus();
}

function renderLiquidationHistory(){
  const liquidations=liquidationHistoryRecords();
  const totalCost=liquidations.reduce((sum,item)=>sum+Number(item.cost||0),0);
  const totalSold=liquidations.reduce((sum,item)=>sum+Number(item.proceeds||0),0);
  const totalProfit=liquidations.reduce((sum,item)=>sum+Number(item.margin||0),0);
  return `<section class="block">
    <div class="batch-head"><div><h2 class="block-title">Liquidation</h2><p class="form-note">Administrator record of all completed liquidation batches.</p></div><button class="btn small" onclick="exportLiquidations()">Download liquidation CSV</button></div>
    <div class="purchase-history-filter-card">
      <div class="purchase-history-filter-top"><div><strong>Liquidation date</strong><span>Choose a date range or use a quick option.</span></div><div class="purchase-history-presets"><button class="btn secondary small" onclick="setLiquidationHistoryDatePreset('today')">Today</button><button class="btn secondary small" onclick="setLiquidationHistoryDatePreset('month')">This month</button><button class="btn secondary small" onclick="setLiquidationHistoryDatePreset('all')" ${liquidationHistoryFrom||liquidationHistoryTo?'':'disabled'}>Clear dates</button></div></div>
      <div class="purchase-history-date-row"><div class="field"><label for="liquidation_history_from">From</label><input id="liquidation_history_from" type="date" value="${esc(liquidationHistoryFrom)}"></div><div class="field"><label for="liquidation_history_to">To</label><input id="liquidation_history_to" type="date" value="${esc(liquidationHistoryTo)}"></div><button class="btn" onclick="applyLiquidationHistoryDates()">Apply dates</button></div>
      <div class="purchase-history-active-range"><span>Showing:</span><strong>${esc(liquidationHistoryFilterLabel())}</strong></div>
    </div>
    ${dashboardReportSearch('Search ID, date, buyer, metal, or status',liquidations.length)}
    <div class="stat-row" style="margin:16px 0;">
      <div class="stat"><div class="label">Liquidation batches</div><div class="value">${liquidations.length}</div></div>
      <div class="stat"><div class="label">Total cost</div><div class="value">${fmtMoney(totalCost)}</div></div>
      <div class="stat"><div class="label">Total sold</div><div class="value">${fmtMoney(totalSold)}</div></div>
      <div class="stat"><div class="label">Total profit</div><div class="value" style="color:${totalProfit>=0?'var(--sage)':'var(--rust)'}">${fmtMoney(totalProfit)}</div></div>
    </div>
    ${tableOrEmpty(liquidations,
      l=>`<tr data-dashboard-search="${dashboardSearchValue(l.id,l.date,fmtDate(l.date),l.buyer,l.metal,l.paymentStatus)}"><td><button class="link-button" onclick="openLiquidationDetails('${l.id}')">${esc(l.id)}</button></td><td>${fmtDate(l.date)}</td><td>${esc(l.buyer)}</td><td class="num">${(l.lines||[]).length||l.itemCount||0}</td>
      <td class="num">${fmtMoney(l.cost)}</td><td class="num">${fmtMoney(l.proceeds)}</td><td class="num" style="color:${l.margin>=0?'var(--sage)':'var(--rust)'}">${fmtMoney(l.margin)}</td><td>${esc(l.paymentStatus||'—')}</td><td><div class="form-actions"><button class="btn secondary small" onclick="openLiquidationDetails('${l.id}')">Details</button>${adminEditButton('Liquidation',l.id)}</div></td></tr>`,
      ['ID','Date','Buyer / refiner','Items','Total cost','Total sold','Profit','Status','Actions'],
      'No liquidations recorded yet.')}
  </section>`;
}

function renderReports(){
  const allPurchases=db.stock.filter(s=>!s.sourceRefiningBatchId);
  const allReadyStock=db.stock.filter(s=>!s.inventoryPoolId&&(s.status==='Available'||s.status==='For Refining')&&s.currentWeight>0);
  const readyStock=allReadyStock.filter(readinessDateMatch).slice().sort((a,b)=>b.date.localeCompare(a.date));
  const renderPurchaseReport=()=>{
    const purchases=allPurchases.filter(purchaseHistoryDateMatch).slice().sort((a,b)=>b.date.localeCompare(a.date));
    const purchaseWeight=purchases.reduce((sum,item)=>sum+Number(item.netWeight||0),0);
    const purchasePayout=purchases.reduce((sum,item)=>sum+Number(item.payout||0),0);
    return `<div id="dashboard_report_content" class="dashboard-report-content">
  <section class="block recent-purchases purchase-history">
    <div class="batch-head"><div><h2 class="block-title">Purchase</h2><p class="form-note">All recorded purchases are kept here in one view.</p></div><div class="form-actions"><button class="btn secondary small" onclick="openCustomerHistoryModal()">View customer history</button><button class="btn small" onclick="exportPurchases()">Download purchase CSV</button></div></div>
    <div class="purchase-history-filter-card">
      <div class="purchase-history-filter-top"><div><strong>Purchase date</strong><span>Choose a date range or use a quick option.</span></div><div class="purchase-history-presets"><button class="btn secondary small" onclick="setPurchaseHistoryDatePreset('today')">Today</button><button class="btn secondary small" onclick="setPurchaseHistoryDatePreset('month')">This month</button><button class="btn secondary small" onclick="setPurchaseHistoryDatePreset('all')" ${purchaseHistoryFrom||purchaseHistoryTo?'':'disabled'}>Clear dates</button></div></div>
      <div class="purchase-history-date-row"><div class="field"><label for="purchase_history_from">From</label><input id="purchase_history_from" type="date" value="${esc(purchaseHistoryFrom)}"></div><div class="field"><label for="purchase_history_to">To</label><input id="purchase_history_to" type="date" value="${esc(purchaseHistoryTo)}"></div><button class="btn" onclick="applyPurchaseHistoryDates()">Apply dates</button></div>
      <div class="purchase-history-active-range"><span>Showing:</span><strong>${esc(purchaseHistoryFilterLabel())}</strong></div>
    </div>
    ${dashboardReportSearch('Search seller, metal, purity, status, or staff',purchases.length)}
    <div class="stat-row" style="margin:16px 0;">
      <div class="stat"><div class="label">Items purchased</div><div class="value">${purchases.length}</div></div>
      <div class="stat"><div class="label">Total net weight</div><div class="value">${fmtWeight(purchaseWeight)}</div></div>
      <div class="stat"><div class="label">Total payout</div><div class="value">${fmtMoney(purchasePayout)}</div></div>
    </div>
    ${tableOrEmpty(purchases,
      s=>`<tr data-dashboard-search="${dashboardSearchValue(s.date,fmtDate(s.date),s.customerName,s.metal,s.karat,s.itemType,s.status,s.staff,s.batchId)}"><td data-label="Date">${fmtDate(s.date)}</td><td data-label="Seller">${esc(s.customerName)}</td><td data-label="Item"><span class="metal-tag ${s.metal.toLowerCase()}">${s.metal}</span> ${esc(s.karat)} · ${esc(s.itemType)}</td>
      <td data-label="Net weight" class="num">${fmtWeight(s.netWeight)}</td><td data-label="Payout" class="num">${fmtMoney(s.payout)}</td><td data-label="Status">${statusPill(s.status)}</td>
      <td data-label="Details"><div class="purchase-details"><span class="hint">${esc(s.staff||'No staff recorded')}</span><div class="form-actions"><button class="btn secondary small" onclick="openPurchaseReceipt('${s.batchId||s.id}')">Receipt</button>${adminEditButton('Inventory',s.id)}</div></div></td></tr>`,
      ['Date','Seller','Item','Net weight','Payout','Status','Details'], 'No purchases recorded yet.')}
  </section></div>`;
  };
  const renderReadinessReport=()=>`<div id="dashboard_report_content" class="dashboard-report-content"><section class="block">
    <div class="batch-head"><div><h2 class="block-title">Liquidation readiness</h2><p class="form-note">On-hand inventory that can be assigned to a liquidation batch or sent for refining.</p></div><button class="btn small" onclick="goTab('inventory')">Open inventory</button></div>
    <div class="purchase-history-filter-card">
      <div class="purchase-history-filter-top"><div><strong>Purchase date</strong><span>Defaults to the latest two weeks so the list stays manageable.</span></div><div class="purchase-history-presets"><button class="btn secondary small" onclick="setReadinessDatePreset('today')">Today</button><button class="btn secondary small" onclick="setReadinessDatePreset('two-weeks')">Last 2 weeks</button><button class="btn secondary small" onclick="setReadinessDatePreset('all')" ${readinessFrom||readinessTo?'':'disabled'}>All dates</button></div></div>
      <div class="purchase-history-date-row"><div class="field"><label for="readiness_from">From</label><input id="readiness_from" type="date" value="${esc(readinessFrom)}"></div><div class="field"><label for="readiness_to">To</label><input id="readiness_to" type="date" value="${esc(readinessTo)}"></div><button class="btn" onclick="applyReadinessDates()">Apply dates</button></div>
      <div class="purchase-history-active-range"><span>Showing:</span><strong>${esc(readinessFilterLabel())}</strong><span>· ${readyStock.length} of ${allReadyStock.length} eligible items</span></div>
    </div>
    ${dashboardReportSearch('Search date, metal, purity, item type, or status',readyStock.length)}
    ${tableOrEmpty(readyStock,
      s=>`<tr data-dashboard-search="${dashboardSearchValue(s.date,fmtDate(s.date),s.metal,s.karat,s.itemType,s.status,s.customerName)}"><td>${fmtDate(s.date)}</td><td><span class="metal-tag ${s.metal.toLowerCase()}">${s.metal}</span> ${esc(s.karat)}</td><td>${esc(s.itemType)}</td>
      <td class="num">${fmtWeight(s.currentWeight)}</td><td>${statusPill(s.status)}</td></tr>`,
      ['Date','Metal / karat','Type','Weight available','Status'],
      'Nothing is currently eligible for liquidation.')}
  </section></div>`;
  const selectedReport=dashboardReportPanel==='purchases'?renderPurchaseReport()
    :dashboardReportPanel==='liquidations'?`<div id="dashboard_report_content" class="dashboard-report-content">${renderLiquidationHistory()}</div>`
    :dashboardReportPanel==='readiness'?renderReadinessReport():'';
  return `<section class="block dashboard-report-menu">
    <div><h2 class="block-title">Dashboard records</h2><p class="form-note">Open only the report you need. Select the active button again to close it.</p></div>
    <div class="dashboard-report-buttons">
      <button class="btn ${dashboardReportPanel==='purchases'?'':'secondary'}" aria-pressed="${dashboardReportPanel==='purchases'}" onclick="toggleDashboardReport('purchases')"><span>Purchase</span><strong>${allPurchases.length}</strong></button>
      <button class="btn ${dashboardReportPanel==='liquidations'?'':'secondary'}" aria-pressed="${dashboardReportPanel==='liquidations'}" onclick="toggleDashboardReport('liquidations')"><span>Liquidation</span><strong>${db.liquidations.length}</strong></button>
      <button class="btn ${dashboardReportPanel==='readiness'?'':'secondary'}" aria-pressed="${dashboardReportPanel==='readiness'}" onclick="toggleDashboardReport('readiness')"><span>Liquidation readiness</span><strong>${allReadyStock.length}</strong></button>
    </div>
  </section>
  ${selectedReport}
  <section class="block export-ledger-compact">
    <details><summary>Export ledger data</summary><div class="stat-row">
      <div class="stat"><div class="label">Inventory ledger</div><button class="btn small" style="margin-top:8px;" onclick="exportStock()">Download CSV</button></div>
      <div class="stat"><div class="label">Liquidation</div><button class="btn small" style="margin-top:8px;" onclick="exportLiquidations()">Download CSV</button></div>
      <div class="stat"><div class="label">Refining history</div><button class="btn small" style="margin-top:8px;" onclick="exportRefining()">Download CSV</button></div>
      <div class="stat"><div class="label">Retail sales</div><button class="btn small" style="margin-top:8px;" onclick="exportRetail()">Download CSV</button></div>
      <div class="stat"><div class="label">Customers</div><button class="btn small" style="margin-top:8px;" onclick="exportCustomers()">Download CSV</button></div>
      <div class="stat"><div class="label">Rate history</div><button class="btn small" style="margin-top:8px;" onclick="exportRates()">Download CSV</button></div>
    </div></details>
  </section>`;
}

/* ============================= INIT ============================= */
function installButtonDoubleClickGuard(){
  if(typeof document==='undefined')return;
  document.addEventListener?.('click',event=>{
    const button=event.target?.closest?.('button');
    if(!button||button.disabled)return;
    const now=Date.now(),lockedUntil=Number(button.dataset?.clickLockedUntil||0);
    if(lockedUntil>now){event.preventDefault();event.stopImmediatePropagation();return;}
    if(!button.dataset)return;
    button.dataset.clickLockedUntil=String(now+1200);
    button.setAttribute?.('aria-busy','true');
    setTimeout(()=>{
      if(Number(button.dataset?.clickLockedUntil||0)<=Date.now()){
        delete button.dataset.clickLockedUntil;
        button.removeAttribute?.('aria-busy');
      }
    },1250);
  },true);
}
installButtonDoubleClickGuard();
initializeAuth();
