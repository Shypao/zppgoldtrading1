import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function receiptFlow() {
  const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/initializeAuth\(\);\s*$/,'');
  const events=[],frames=[],timers=[];
  let finishSave;
  const saved=new Promise(resolve=>{finishSave=resolve;});
  const context=vm.createContext({console,events,saved,document:{getElementById(){return {value:''};}},requestAnimationFrame:fn=>frames.push(fn),setTimeout:fn=>timers.push(fn)});
  vm.runInContext(`${source}
    seedEmptyLedger();ensureShape();currentUser={displayName:'Admin',role:'admin'};
    purchaseBatch=[{metal:'Gold',karat:'24K',itemType:'Scrap',netWeight:1,currentWeight:1,payout:8500,rate:8500}];
    captureBuyingDraftForm=()=>{};purchaseCustomer=()=>({id:'',name:''});
    saveDB=async()=>{events.push('saving');return await saved;};
    closePurchaseSummary=()=>{};clearBuyingDraft=async()=>{};
    openPurchaseReceipt=()=>events.push('receipt');render=()=>events.push('render');syncCashflow=async()=>events.push('cashflow');toast=()=>{};
    globalThis.commit=commitPurchaseBatch;globalThis.snapshot=()=>({stock:db.stock.length,draft:purchaseBatch.length});`,context);
  return {context,events,finishSave,frames,timers};
}

test('receipt waits for successful persistence, then paints ahead of the form rebuild',async()=>{
  const {context,events,finishSave,frames,timers}=await receiptFlow();
  const commit=context.commit(true);
  assert.deepEqual(events,['saving']);
  finishSave(true);await commit;
  assert.deepEqual(events,['saving','receipt']);
  frames.shift()();timers.shift()();
  assert.deepEqual(events,['saving','receipt','render','cashflow']);
});

test('failed purchase save never opens a receipt and preserves the draft',async()=>{
  const {context,events,finishSave}=await receiptFlow();
  const commit=context.commit(true);finishSave(false);await commit;
  assert.deepEqual(events,['saving']);
  assert.equal(context.snapshot().stock,0);
  assert.equal(context.snapshot().draft,1);
});
