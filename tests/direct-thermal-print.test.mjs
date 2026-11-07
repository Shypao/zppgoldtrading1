import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function harness({android=true,method='browser',saved='browser'}={}){
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('function receiptWeightNumber('),source.indexOf('/* ============================= INVENTORY'));
  const values={receipt_paper_size:'58',receipt_print_method:method};
  const storage=new Map([['thermalReceiptPrintMethod',saved]]),calls=[],appended=[];
  const items=[{id:'stk-test',batchId:'buy-test',date:'2026-11-07',metal:'Gold',karat:'22K',itemType:'Scrap',customerName:'Jose\x1bp\x00\nTest',staff:'Admin',netWeight:43.7,rate:7218,payout:315426.6,paymentMethod:'Cash'},
    {id:'stk-2',batchId:'buy-test',date:'2026-11-07',metal:'Gold',karat:'21K',itemType:'Scrap',netWeight:2,rate:6895,payout:13790}];
  const context=vm.createContext({
    navigator:{userAgent:android?'Android POCO Chrome':'Windows Chrome'},
    btoa:value=>Buffer.from(value,'binary').toString('base64'),
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    sessionStorage:{setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    window:{location:{href:''},open:(...args)=>{calls.push(args);return {};}},
    document:{getElementById:()=>null,body:{classList:{remove(){}},appendChild:node=>appended.push(node)},createElement:()=>({addEventListener(){}})},
    db:{stock:items},val:id=>values[id]||'',roundMoney:value=>Math.round(value*100)/100,fmtDate:value=>value,todayStr:()=> '2026-11-07',
    gradeLabel:(_metal,karat)=>karat,esc:value=>String(value),toast:value=>calls.push(value),
  });
  vm.runInContext(code+'\nglobalThis.api={purchaseReceiptRecords,openPurchaseItemReceipt,closePurchaseReceipt,purchaseReceiptMarkup,purchaseReceiptEscPos,thermalReceiptText,setReceiptPrintMethod,receiptPrintMethod,printPurchaseReceipt,openPurchaseReceipt,printThermalTestReceipt};',context);
  return {api:context.api,context,calls,items,appended,storage};
}

test('direct ESC/POS receipt preserves totals, wraps within 58/80mm columns, and has no fixed paper feed',async()=>{
  const h=await harness();
  for(const [width,columns] of [[58,32],[80,48]]){
    const data=h.api.purchaseReceiptEscPos(h.items,width);
    assert.ok(data.startsWith('\x1b@'));
    assert.match(data,/315,427/);assert.match(data,/13,790/);assert.match(data,/329,217/);
    assert.match(data,/43.7 g/);assert.match(data,/Gold 22K/);
    assert.doesNotMatch(data,/\x1bp|\x1bd|\x1bJ|\x1dV/,'receipt must not pulse drawer, feed a page or cut');
    const text=data.replace(/\x1b[@2]/g,'').replace(/\x1b[MaE][\x00-\x01]/g,'').replace(/\x1d![\x00\x10]/g,'');
    assert.ok(text.split('\n').every(line=>line.length<=columns));
    assert.ok(text.endsWith('\n\n\n'));
    assert.match(text,/Customer: Jose p Test/,'field control bytes are removed');
  }
});

test('Android direct mode launches a raw base64 intent without a browser print page or success claim',async()=>{
  const h=await harness({method:'rawbt'});h.api.printPurchaseReceipt('buy-test');
  const uri=h.context.window.location.href;
  assert.match(uri,/^intent:base64,[A-Za-z0-9+/=]+#Intent;scheme=rawbt;package=ru\.a402d\.rawbtprinter;end;$/);
  const bytes=Buffer.from(uri.split(',')[1].split('#')[0],'base64').toString('binary');
  assert.equal(bytes,h.api.purchaseReceiptEscPos(h.items,58));
  assert.equal(h.calls.filter(Array.isArray).length,0);
  assert.match(h.calls[0],/Sent to RawBT/);assert.doesNotMatch(h.calls[0],/successfully printed/i);
});

test('manual browser fallback never launches the direct bridge and desktop ignores saved Android mode',async()=>{
  for(const android of [true,false]){
    const h=await harness({android,method:'rawbt',saved:'rawbt'});
    h.api.printPurchaseReceipt('buy-test',android?'browser':null);
    assert.deepEqual(Array.from(h.calls[0]),['/receipt-print.html','_blank']);
    assert.equal(h.context.window.location.href,'');
  }
});

test('device print preference is opt-in and Android setup exposes a test receipt without saving a transaction',async()=>{
  const h=await harness();assert.equal(h.api.receiptPrintMethod(),'browser');
  h.api.setReceiptPrintMethod('rawbt');assert.equal(h.api.receiptPrintMethod(),'rawbt');
  h.api.openPurchaseReceipt('buy-test');
  assert.match(h.appended[0].innerHTML,/Direct thermal \(RawBT app\)/);
  assert.match(h.appended[0].innerHTML,/Test printer/);assert.match(h.appended[0].innerHTML,/Browser print/);
  const before=JSON.stringify(h.items);h.api.printThermalTestReceipt();assert.equal(JSON.stringify(h.items),before);
  const bytes=Buffer.from(h.context.window.location.href.split(',')[1].split('#')[0],'base64').toString('binary');
  assert.match(bytes,/TEST-ONLY/);assert.match(bytes,/no\s+transaction/);
});


test('both receipt paths use the signed-in staff name and provide a handwritten signature line',async()=>{
  const h=await harness();
  h.items[0].staff='Original purchaser';
  h.context.currentUser={displayName:'Maria Santos',username:'maria'};
  const html=h.api.purchaseReceiptMarkup(h.items),raw=h.api.purchaseReceiptEscPos(h.items,58);
  assert.match(html,/Staff name:<\/span><strong>Maria Santos<\/strong>/);
  assert.match(html,/class="receipt-signature-line"/);
  assert.match(html,/Staff signature/);
  assert.match(raw,/Staff name: Maria Santos/);
  assert.match(raw,/_{24}\nStaff signature/);
  assert.ok(html.indexOf('Staff signature')<html.indexOf('Thank you!'));
  h.context.currentUser={displayName:'Juan Reyes'};
  assert.match(h.api.purchaseReceiptMarkup(h.items),/Juan Reyes/);
  assert.match(h.api.purchaseReceiptEscPos(h.items,58),/Staff name: Juan Reyes/);
  h.context.currentUser=null;
  delete h.items[0].staff;
  assert.match(h.api.purchaseReceiptMarkup(h.items),/Not recorded/);
  assert.match(h.api.purchaseReceiptEscPos(h.items,58),/Staff name: Not recorded/);
});


test('item receipts and both print paths stay scoped to exact IDs despite matching seller names',async()=>{
  const h=await harness({method:'rawbt'});
  h.items[0].customerName='Same Seller';h.items[1].customerName='Same Seller';
  h.items.push({...h.items[0],id:'old-other-transaction',batchId:'buy-old',date:'2026-10-01',karat:'8K',payout:999});
  h.items.push({...h.items[0],id:'old-shared-batch',date:'2026-10-02',karat:'10K',payout:888});
  h.api.openPurchaseItemReceipt('stk-test');
  const preview=h.appended.at(-1).innerHTML;
  assert.match(preview,/Gold 22K/);assert.doesNotMatch(preview,/Gold 21K|Gold 8K|Gold 10K/);
  h.api.printPurchaseReceipt('buy-test');
  let bytes=Buffer.from(h.context.window.location.href.split(',')[1].split('#')[0],'base64').toString('binary');
  assert.match(bytes,/315,427/);assert.doesNotMatch(bytes,/329,217|13,790|Gold 21K|Gold 10K/);
  let browserPayload;
  h.context.window.open=()=>{browserPayload=JSON.parse(h.storage.get('zp_thermal_receipt_print'));return {};};
  h.api.printPurchaseReceipt('buy-test','browser');
  assert.match(browserPayload.html,/Gold 22K/);assert.doesNotMatch(browserPayload.html,/Gold 21K|Gold 8K|Gold 10K/);
  h.api.openPurchaseItemReceipt('stk-2');h.api.printPurchaseReceipt('buy-test');
  bytes=Buffer.from(h.context.window.location.href.split(',')[1].split('#')[0],'base64').toString('binary');
  assert.match(bytes,/Gold 21K/);assert.doesNotMatch(bytes,/Gold 22K/);
  h.api.closePurchaseReceipt();
  assert.equal(h.api.purchaseReceiptRecords('buy-old').length,1);
});
