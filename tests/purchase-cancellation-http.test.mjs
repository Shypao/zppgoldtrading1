import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,copyFile,symlink,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import test from 'node:test';

test('authenticated cancellation API updates inventory, cashflow and audit once in an isolated database',async()=>{
 const dir=await realpath(await mkdtemp(path.join(tmpdir(),'zp-cancel-http-')));
 let child,serverLog='';
 try{
  await mkdir(path.join(dir,'src'));await mkdir(path.join(dir,'public'));
  await copyFile(new URL('../src/server.ts',import.meta.url),path.join(dir,'src/server.ts'));
  await symlink(new URL('../node_modules',import.meta.url).pathname,path.join(dir,'node_modules'),'dir');
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  child=spawn(process.execPath,['--experimental-strip-types',path.join(dir,'src/server.ts')],{env:{...process.env,ZPP_UPSTREAM_URL:'',TURSO_DATABASE_URL:'',TURSO_AUTH_TOKEN:'',VERCEL:'',ZPP_PORT:String(port),ZPP_ADMIN_PASSWORD:'Testing-cancel-admin',ZPP_STAFF_PASSWORD:'Testing-cancel-staff',ZPP_SESSION_SECRET:'isolated-cancel-test'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>{serverLog+=chunk;});child.stderr.on('data',chunk=>{serverLog+=chunk;});
  const base='http://127.0.0.1:'+port;
  let ready=false;
  for(let i=0;i<100;i++){try{const response=await fetch(base+'/api/health');if(response.ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,40));}
  assert.ok(ready,'isolated test server starts: '+serverLog);
  const request=async(route,{method='GET',cookie='',body}={})=>{
   const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
   return {status:response.status,json:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const admin=await request('/api/login?includeState=1',{method:'POST',body:{username:'admin',password:'Testing-cancel-admin'}});
  const staff=await request('/api/login',{method:'POST',body:{username:'staff',password:'Testing-cancel-staff'}});
  assert.equal((await request('/api/cashflow/cancel-purchase',{method:'POST',body:{}})).status,401);
  assert.equal((await request('/api/cashflow/cancel-purchase',{method:'POST',cookie:staff.cookie,body:{}})).status,403);
  const seed=admin.json.state;
  const recordedAt=new Date(Date.now()-60000).toISOString();
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(new Date(recordedAt).getTime()-4*3600000));
  seed.stock=[{id:'test-buy-item',batchId:'test-buy',date,recordedAt,customerName:'Test seller',metal:'Gold',karat:'18K',itemType:'Scrap',status:'Available',netWeight:1,currentWeight:1,rate:500,payout:500,cost:500,paymentMethod:'Cash'}];
  const saved=await request('/api/state',{method:'PUT',cookie:admin.cookie,body:seed});assert.equal(saved.status,200);
  const configured=await request('/api/cashflow',{method:'PUT',cookie:admin.cookie,body:{date,operation:'set',amount:9500,note:'Balance after test buying'}});assert.equal(configured.status,200);
  const ledger=await request('/api/state',{cookie:admin.cookie});
  const body={transactionId:'test-buy',date,revision:ledger.json._revision,reason:'Seller not paid'};
  const stale=await request('/api/cashflow/cancel-purchase',{method:'POST',cookie:admin.cookie,body:{...body,revision:0}});assert.equal(stale.status,409);
  const result=await request('/api/cashflow/cancel-purchase',{method:'POST',cookie:admin.cookie,body});
  assert.equal(result.status,200,JSON.stringify(result.json));assert.equal(result.json.cashReturned,500);assert.equal(result.json.state.stock.length,0);
  const duplicate=await request('/api/cashflow/cancel-purchase',{method:'POST',cookie:admin.cookie,body});assert.equal(duplicate.status,409);
  const cash=await request('/api/cashflow?date='+date,{cookie:admin.cookie});
  assert.equal(cash.json.cashOnHand,10000);assert.equal(cash.json.totalPurchases,0);assert.equal(cash.json.purchaseCount,0);assert.equal(cash.json.cashPurchases,0);
  assert.equal(cash.json.transactions.length,1);assert.equal(cash.json.transactions[0].reverted,true);
  assert.equal(cash.json.adjustments.filter(item=>item.operation==='revert').length,1);
  const add=await request('/api/cashflow',{method:'PUT',cookie:admin.cookie,body:{date,operation:'add',amount:100,note:'After reversal'}});assert.equal(add.status,200);assert.equal(add.json.cashOnHand,10100);
 }finally{
  if(child){child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',resolve);});}
  await rm(dir,{recursive:true,force:true});
 }
});
