import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

function serverCheck(code){
 const script=`import {DatabaseSync} from 'node:sqlite';
 import {preparePurchaseCancellation,cashflowRecordsWithCancellations,cashflowBalanceForSettingRecords,cashflowMovementTotalsForRecords,purchaseCancellationStatements,validateLedgerIntegrity} from './src/server.ts';
 const date='2026-11-08',now=new Date('2026-11-08T14:00:00Z'),admin={id:'admin',username:'admin',displayName:'Administrator',role:'admin'};
 const item={id:'a',batchId:'buy-a',date,recordedAt:'2026-11-08T10:00:00Z',customerName:'Seller',metal:'Gold',karat:'18K',itemType:'Scrap',status:'Available',netWeight:1,currentWeight:1,rate:500,payout:500,cost:500,paymentMethod:'Cash'};
 const state={_revision:3,customers:[],stock:[item],inventoryPools:[],liquidationBatches:[],liquidations:[],refiningBatches:[],retailSales:[],pricingHistory:[],pricing:null};
 const settings={days:{[date]:{balanceBase:10000,cashPaidBaseline:0,setAt:'2026-11-07T20:00:00Z',setBy:'Admin',adjustments:[]}}};
 const result=(()=>{${code}})();process.stdout.write(JSON.stringify(result));`;
 const r=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','--eval',script],{cwd:new URL('..',import.meta.url),encoding:'utf8',env:{...process.env,ZPP_UPSTREAM_URL:'http://unused.invalid'}});
 assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}

test('cancel purchase removes the whole transaction and restores cash once with an immutable audit',()=>{
 const r=serverCheck(`
 state.stock.push({...item,id:'b',paymentMethod:'Bank',payout:300,cost:300});
 const before=JSON.stringify(state);
 const beforeCash=cashflowBalanceForSettingRecords(state.stock,date,settings.days[date]);
 const p=preparePurchaseCancellation(state,settings,'buy-a',date,'Seller was not paid',admin,now);
 validateLedgerIntegrity(p.state);
 const effective=cashflowRecordsWithCancellations(p.state.stock,[p.cancellation]);
 return {beforeCash,unchanged:before===JSON.stringify(state),stock:p.state.stock,revision:p.state._revision,audit:p.cancellation,balance:cashflowBalanceForSettingRecords(effective,date,p.settings.days[date]),movements:cashflowMovementTotalsForRecords(effective,date,p.settings.days[date].adjustments)};`);
 assert.equal(r.beforeCash,9500);assert.equal(r.balance,10000);assert.equal(r.unchanged,true);
 assert.equal(r.stock.length,0);assert.equal(r.audit.items.length,2);assert.equal(r.audit.cashReturned,500);assert.equal(r.audit.payout,800);assert.equal(r.audit.createdBy,'Administrator');assert.equal(r.revision,4);
 assert.deepEqual(r.movements,{cashIn:500,manualCashOut:0,cashOut:500});
});

test('reverting a purchase included in latest set restores cash without a double refund and later buying still deducts',()=>{
 const r=serverCheck(`
 settings.days[date]={...settings.days[date],balanceBase:9500,cashPaidBaseline:500,setAt:'2026-11-08T12:00:00Z'};
 const p=preparePurchaseCancellation(state,settings,'buy-a',date,'Unpaid',admin,now);
 const records=cashflowRecordsWithCancellations(p.state.stock,[p.cancellation]);
 const once=cashflowBalanceForSettingRecords(records,date,p.settings.days[date]);
 records.push({...item,id:'later',batchId:'buy-later',payout:200,recordedAt:'2026-11-08T14:01:00Z'});
 let duplicate='';try{preparePurchaseCancellation(p.state,p.settings,'buy-a',date,'Again',admin,now,[p.cancellation]);}catch(e){duplicate=e.message;}
 return {once,later:cashflowBalanceForSettingRecords(records,date,p.settings.days[date]),duplicate};`);
 assert.equal(r.once,10000);assert.equal(r.later,9800);assert.match(r.duplicate,/already cancelled/);
});

test('historical cancellation credits current day while preserving historical debits and carry-over',()=>{
 const r=serverCheck(`
 item.date='2026-11-07';item.recordedAt='2026-11-07T10:00:00Z';
 settings.days={'2026-11-07':{...settings.days[date],setAt:'2026-11-06T20:00:00Z'}};
 const p=preparePurchaseCancellation(state,settings,'buy-a','2026-11-07','Unpaid',admin,now);
 const records=cashflowRecordsWithCancellations(p.state.stock,[p.cancellation]);
 return {historical:cashflowBalanceForSettingRecords(records,'2026-11-07',p.settings.days['2026-11-07']),current:cashflowBalanceForSettingRecords(records,date,p.settings.days[date]),refundDay:p.cancellation.cashflowDate};`);
 assert.equal(r.historical,9500);assert.equal(r.current,10000);assert.equal(r.refundDay,'2026-11-08');
});

test('non-cash cancellation changes no cash; reset counters include only a later cash reversal',()=>{
 const r=serverCheck(`
 settings.days[date].adjustments=[{id:'reset',operation:'reset',amount:0,createdAt:'2026-11-08T12:00:00Z'}];
 const cash=preparePurchaseCancellation(state,settings,'buy-a',date,'Unpaid',admin,now);
 const effective=cashflowRecordsWithCancellations(cash.state.stock,[cash.cancellation]);
 item.paymentMethod='Bank';
 const bank=preparePurchaseCancellation(state,settings,'buy-a',date,'Unpaid',admin,now);
 return {cashMovement:cashflowMovementTotalsForRecords(effective,date,cash.settings.days[date].adjustments),bankRefund:bank.cancellation.cashReturned,bankBalance:bank.settings.days[date].balanceBase};`);
 assert.deepEqual(r.cashMovement,{cashIn:500,manualCashOut:0,cashOut:0});assert.equal(r.bankRefund,0);assert.equal(r.bankBalance,10000);
});

test('cancellation refuses staff, missing reasons, unconfigured cash and downstream pool/split/refining/liquidation/retail use',()=>{
 const r=serverCheck(`
 const errors=[];const attempt=(s=state,c=settings,u=admin,reason='Unpaid')=>{try{preparePurchaseCancellation(s,c,'buy-a',date,reason,u,now);errors.push('ALLOWED');}catch(e){errors.push(e.message);}};
 attempt(state,settings,{...admin,role:'staff'});attempt(state,settings,admin,'');attempt(state,{days:{}});
 for(const kind of ['pool','split','refining','liquidation','retail']){
  const s=structuredClone(state);
  if(kind==='pool')s.inventoryPools=[{id:'P',itemIds:['a']}];
  if(kind==='split')s.stock.push({...item,id:'child',inventorySplitFromId:'a'});
  if(kind==='refining')s.refiningBatches=[{id:'R',itemIds:['a']}];
  if(kind==='liquidation')s.liquidations=[{id:'L',lines:[{itemId:'a'}]}];
  if(kind==='retail')s.retailSales=[{id:'S',itemId:'a'}];attempt(s);
 }
 return errors;`);
 assert.equal(r.includes('ALLOWED'),false);assert.match(r[0],/Administrator/);assert.match(r[1],/reason/);assert.match(r[2],/Set current cash/);r.slice(3).forEach(e=>assert.match(e,/linked/));
});

test('SQLite transaction atomically guards inventory, audit and cash writes against stale revisions and cash edits',()=>{
 const r=serverCheck(`
 const p=preparePurchaseCancellation(state,settings,'buy-a',date,'Unpaid',admin,now),cashValue=JSON.stringify(settings);
 const database=new DatabaseSync(':memory:');database.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE inventory(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
 database.prepare('INSERT INTO settings VALUES (?,?)').run('ledger_revision','3');database.prepare('INSERT INTO settings VALUES (?,?)').run('cashflow',cashValue);database.prepare('INSERT INTO inventory VALUES (?,?)').run('a',JSON.stringify(item));
 const statements=purchaseCancellationStatements(state,p,cashValue);
 const execute=()=>{database.exec('BEGIN IMMEDIATE');try{for(const st of statements)database.prepare(st.sql).run(...(st.args||[]));database.exec('COMMIT');return true;}catch{database.exec('ROLLBACK');return false;}};
 database.prepare("UPDATE settings SET value='4' WHERE key='ledger_revision'").run();const staleRevision=execute();
 database.prepare("UPDATE settings SET value='3' WHERE key='ledger_revision'").run();database.prepare("UPDATE settings SET value='other' WHERE key='cashflow'").run();const staleCash=execute();
 const preserved=database.prepare('SELECT COUNT(*) AS count FROM inventory').get().count;
 database.prepare("UPDATE settings SET value=? WHERE key='cashflow'").run(cashValue);const saved=execute(),duplicate=execute();
 return {staleRevision,staleCash,preserved,saved,duplicate,items:database.prepare('SELECT COUNT(*) AS count FROM inventory').get().count,audits:database.prepare("SELECT COUNT(*) AS count FROM settings WHERE key LIKE 'purchase_cancel:%'").get().count,cash:JSON.parse(database.prepare("SELECT value FROM settings WHERE key='cashflow'").get().value)};`);
 assert.equal(r.staleRevision,false);assert.equal(r.staleCash,false);assert.equal(r.preserved,1);assert.equal(r.saved,true);assert.equal(r.duplicate,false);assert.equal(r.items,0);assert.equal(r.audits,1);assert.equal(r.cash.days['2026-11-08'].balanceBase,10000);
});
