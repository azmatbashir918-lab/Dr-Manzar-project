import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,readdir,rm,unlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {MongoClient} from 'mongodb';
import {PDFDocument} from 'pdf-lib';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import Stripe from 'stripe';
import {openDatabase} from '../../src/db.js';

import {createApp} from '../../src/app.js';
import {hashPassword,digest,token} from '../../src/security.js';
import {base32,totp,verifyTotp,seal,unseal} from '../../src/totp.js';
import {createMailer} from '../../src/mail.js';

let replica,client,encoded;
const password='migration-test-password-123',signer=new Stripe('sk_test_fixture'),secret='whsec_fixture',run=promisify(execFile);
before(async()=>{
  replica=await MongoMemoryReplSet.create({binary:{version:'8.2.6',...(process.env.MONGOMS_SYSTEM_BINARY?{systemBinary:process.env.MONGOMS_SYSTEM_BINARY}:{})},replSet:{count:1,storageEngine:'wiredTiger'}});
  client=new MongoClient(replica.getUri());await client.connect();encoded=await hashPassword(password);
});
after(async()=>{await client?.close();await replica?.stop();});
async function fixture(t,options={}){
  const name='test_manzar_'+randomUUID().replaceAll('-',''),db=await openDatabase({client,name}),root=await mkdtemp(join(tmpdir(),'manzar-mongo-'));
  const mail=[],config={origin:'http://localhost:5173',mfaKey:randomBytes(32),disableRateLimits:true,privateBookDirectory:join(root,'books'),coverDirectory:join(root,'covers'),audioDirectory:join(root,'audio'),audioWorkDirectory:join(root,'work'),webhookSecret:secret,...options};
  if(options.serveFrontend){config.frontendDirectory=join(root,'web');await mkdir(config.frontendDirectory);await writeFile(join(config.frontendDirectory,'index.html'),'<html>React shell</html>');await writeFile(join(config.frontendDirectory,'asset.js'),'/* built asset */');}
  const access=config.privateTesting?{Authorization:'Basic '+Buffer.from(config.testAccessUser+':'+config.testAccessPassword).toString('base64')}:{};
  let n=0;
  for(const role of ['owner','editor','reader','other'])await db.insert('users',{id:randomUUID(),email:role+'@example.com',name:role,password_hash:encoded,role:role==='other'?'reader':role,verified:1,suspended:0,language:'en',profile:{},marketing:0,consent_at:null,terms_version:'1.1',created_at:Date.now()});
  const server=createApp({db,config,sendMail:async m=>mail.push(m),stripe:{webhooks:signer.webhooks,checkout:{sessions:{create:async()=>({id:'cs_'+randomUUID(),url:'https://checkout.stripe.com/test'})}}}}).listen(0,'127.0.0.1');
  await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  t.after(async()=>{await new Promise(done=>server.close(done));if(!name.startsWith('test_manzar_'))throw Error('Unsafe DB cleanup');await db.database.dropDatabase();const delta=relative(resolve(tmpdir()),resolve(root));if(!delta||delta.startsWith('..')||isAbsolute(delta)||!delta.startsWith('manzar-mongo-'))throw Error('Unsafe file cleanup');await rm(root,{recursive:true,force:true});});
  async function api(path,{method='GET',body,actor,csrf=true,raw=false,headers={}}={}){
    const res=await fetch((path.startsWith('/api/')?base.replace('/api/v1',''):base)+path,{method,headers:{...access,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...(actor?{cookie:actor.cookie,...(csrf?{'x-csrf-token':actor.csrfToken}:{})}:{}),...headers},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
    if(raw)return res;return{status:res.status,data:res.status===204?null:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0],headers:res.headers};
  }
  async function primary(role){return api('/auth/login',{method:'POST',body:{email:role+'@example.com',password}});}
  async function login(role){
    let result=await primary(role),setupSecret,recoveryCodes;
    if(result.status===202){const challenge=result.data.challenge;const setup=await api('/auth/mfa/setup',{method:'POST',body:{challenge}});assert.equal(setup.status,200);setupSecret=setup.data.secret;result=await api('/auth/mfa/verify',{method:'POST',body:{challenge,code:totp(setupSecret)}});recoveryCodes=result.data.recoveryCodes;}
    assert.equal(result.status,200);return{cookie:result.cookie,csrfToken:result.data.csrfToken,user:result.data.user,setupSecret,recoveryCodes};
  }
  const reader=await login('reader'),other=await login('other');
  const staffSessions={};
  async function staff(role='owner'){return staffSessions[role]||=(await login(role));}
  function draft(slug='item-'+(++n)){return{slug,status:'draft',translations:{en:{title:'Original title',body:'Sample text',audioUrl:'https://example.com/en.mp3'},ur:{title:'اردو عنوان',body:'متن',audioUrl:'https://example.com/ur.mp3'}}};}
  async function book(actor){const result=await api('/admin/content/books',{method:'POST',body:draft(),actor});assert.equal(result.status,201);return result.data.item;}
  async function pdf(label='Private PDF'){const d=await PDFDocument.create();d.addPage().drawText(label);return Buffer.from(await d.save());}
  async function upload(path,bytes,{actor,field='document',filename='book.pdf',mime='application/pdf',csrf=true,second=false,extra=false}={}){
    const body=new FormData();if(bytes!==null)body.append(field,new Blob([bytes],{type:mime}),filename);
    if(second)body.append(field,new Blob([bytes],{type:mime}),filename);if(extra)body.append('unexpected','value');
    return api(path,{method:'POST',body,actor,csrf});
  }
  async function edition(item,actor,language='en'){
    const bytes=await pdf(language),result=await upload(`/admin/books/${item.id}/files/${language}`,bytes,{actor});assert.equal(result.status,201);return{...result.data.file,bytesData:bytes};
  }
  async function save(item,actor,changes={}){
    const {id,kind,createdAt,updatedAt,...body}=item;
    const result=await api('/admin/content/'+id,{method:'PUT',body:{...body,...changes},actor});return result;
  }
  async function sale(){const owner=await staff(),item=await book(owner),en=await edition(item,owner,'en'),ur=await edition(item,owner,'ur');
    const saved=await save(item,owner,{digitalAvailable:true,priceMinor:1000,currency:'usd',digitalFileIds:{en:en.id,ur:ur.id}});assert.equal(saved.status,200);
    assert.equal((await api(`/admin/content/${item.id}/publish`,{method:'POST',body:{},actor:owner})).status,200);return{owner,item,en,ur};
  }
  async function checkout(item){const r=await api('/payments/checkout',{method:'POST',body:{bookId:item.id},actor:reader});assert.equal(r.status,201);return r.data.orderId;}
  async function event(orderId,type='checkout.session.completed',paid=true){const o=await db.one('orders',{id:orderId});return{id:'evt_'+randomUUID(),type,data:{object:{id:o.stripe_session,payment_status:paid?'paid':'unpaid',amount_total:o.amount,currency:o.currency,payment_intent:'pi_'+orderId,metadata:{orderId}}}};}
  const refund=(id,full=true)=>({id:'evt_'+randomUUID(),type:'charge.refunded',data:{object:{payment_intent:'pi_'+id,amount:1000,amount_refunded:full?1000:200,refunded:full}}});
  async function webhook(e,forged=false){const body=JSON.stringify(e),res=await fetch(base+'/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':forged?'forged':signer.webhooks.generateTestHeaderString({payload:body,secret})},body});await res.arrayBuffer();return res.status;}
  const library=()=>api('/library',{actor:reader});
  const link=(id,actor=reader,csrf=true)=>api(`/library/${id}/download-links`,{method:'POST',body:{},actor,csrf});
  async function paid(){const s=await sale(),orderId=await checkout(s.item);assert.equal(await webhook(await event(orderId)),200);return{...s,orderId};}
  return{db,config,root,mail,api,primary,login,reader,other,staff,draft,book,pdf,upload,edition,save,sale,checkout,event,refund,webhook,library,link,paid,base};
}

test('Render private gate protects frontend and API; health and signed webhook remain reachable',async t=>{
  const f=await fixture(t,{privateTesting:true,production:true,testAccessUser:'reviewer',testAccessPassword:'private-testing-long-password',serveFrontend:true});
  const root=f.base.replace('/api/v1',''),authorization='Basic '+Buffer.from('reviewer:private-testing-long-password').toString('base64');
  assert.equal((await fetch(root+'/en/books')).status,401);
  assert.equal((await fetch(f.base+'/health')).status,401);
  assert.equal((await fetch(root+'/healthz')).status,200);
  const page=await fetch(root+'/ur/books',{headers:{authorization}});assert.equal(page.status,200);assert.match(await page.text(),/React shell/);assert.match(page.headers.get('x-robots-tag'),/noindex/);
  assert.equal((await fetch(root+'/asset.js',{headers:{authorization}})).status,200);
  assert.equal((await fetch(f.base+'/unknown',{headers:{authorization}})).status,404);
  assert.equal((await f.api('/auth/login',{method:'POST',body:{email:'reader@example.com',password}})).headers.get('set-cookie').includes('Secure'),true);
  assert.equal(await f.webhook({id:'evt_invalid',type:'unknown',data:{object:{}}},true),400);
});

test('GridFS restores private PDFs after disposable disk loss without bypassing ownership',async t=>{
  const f=await fixture(t,{mediaStorageMode:'mongodb'}),s=await f.paid();
  assert.equal(await f.db.database.collection('media.files').countDocuments(),2);
  await unlink(join(f.root,'books',s.en.id+'.pdf'));
  await unlink(join(f.root,'books',s.ur.id+'.pdf'));
  const item=(await f.library()).data.items.find(i=>i.language==='en');
  assert.equal((await f.link(item.id,f.other)).status,404);
  const url=(await f.link(item.id)).data.url,result=await f.api(url,{actor:f.reader,raw:true});
  assert.equal(result.status,200);assert.deepEqual(Buffer.from(await result.arrayBuffer()),s.en.bytesData);
});

test('GridFS restores covers and narration after cache loss; failed metadata leaves no durable file',async t=>{
  const f=await fixture(t,{mediaStorageMode:'mongodb'}),actor=await f.staff();
  const image=await sharp({create:{width:10,height:10,channels:3,background:'red'}}).png().toBuffer();
  const cover=await f.upload('/admin/uploads/covers',image,{actor,field:'cover',filename:'cover.png',mime:'image/png'});assert.equal(cover.status,201);
  const filename=cover.data.cover.url.split('/').at(-1);await unlink(join(f.root,'covers',filename));
  const restored=await f.api(cover.data.cover.url,{raw:true});assert.equal(restored.status,200);await restored.arrayBuffer();
  const source=join(f.root,'voice.wav');await run(ffmpeg,['-f','lavfi','-i','sine=frequency=440:duration=1','-y',source],{windowsHide:true});
  const audio=await f.upload('/admin/uploads/narration/en',await readFile(source),{actor,field:'audio',filename:'voice.wav',mime:'audio/wav'});assert.equal(audio.status,201);
  await unlink(join(f.root,'audio',audio.data.audio.url.split('/').at(-1)));
  const response=await f.api(audio.data.audio.url,{raw:true,headers:{Range:'bytes=0-9'}});assert.equal(response.status,206);await response.arrayBuffer();
  const insert=f.db.insert;f.db.insert=(name,...args)=>name==='audit'?Promise.reject(new Error('Audit unavailable')):insert(name,...args);
  assert.equal((await f.upload('/admin/uploads/covers',image,{actor,field:'cover',filename:'cover.png',mime:'image/png'})).status,500);
  assert.equal(await f.db.database.collection('media.files').countDocuments(),2);
});

test('Render email uses HTTPS and fails safely without leaking provider responses',async()=>{
  let captured;
  const config={mailMode:'resend',resendApiKey:'test-only',mailFrom:'Author <author@example.com>'};
  const mail=createMailer(config,async(url,options)=>{captured={url,options};return{ok:true};});
  await mail({to:'reader@example.com',subject:'Verify',text:'Verification link'});
  assert.equal(captured.url,'https://api.resend.com/emails');assert.equal(captured.options.method,'POST');assert.deepEqual(JSON.parse(captured.options.body).to,['reader@example.com']);
  await assert.rejects(createMailer(config,async()=>({ok:false}))({to:'reader@example.com'}),/Email provider rejected/);
});

test('native MongoDB replica set, indexes and transaction rollback',async t=>{
  const f=await fixture(t);assert.equal(f.db.kind,'mongodb');
  assert.equal((await f.api('/health')).data.database,'mongodb');
  await assert.rejects(f.db.transaction(async()=>{await f.db.insert('audit',{id:'rollback',action:'test'});await f.db.insert('users',{id:randomUUID(),email:'reader@example.com'});}),e=>e.code===11000);
  assert.equal(await f.db.one('audit',{id:'rollback'}),null);
  const index=await f.db.database.collection('sessions').indexes();assert.ok(index.some(i=>i.expireAfterSeconds===0));
});
test('registration, neutral duplicates, email verification and single-use tokens',async t=>{
  const f=await fixture(t),body={name:'New reader',email:'new@example.com',password,acceptTerms:true,language:'ur'};
  assert.equal((await f.api('/auth/register',{method:'POST',body})).status,202);
  assert.equal((await f.api('/auth/login',{method:'POST',body:{email:body.email,password}})).status,403);
  const raw=f.mail.at(-1).text.match(/token=([a-f0-9]{64})/)[1];
  assert.equal((await f.api('/auth/verify-email',{method:'POST',body:{token:raw}})).status,200);
  assert.equal((await f.api('/auth/verify-email',{method:'POST',body:{token:raw}})).status,400);
  assert.equal((await f.api('/auth/register',{method:'POST',body})).status,202);
  const r=await f.api('/auth/login',{method:'POST',body:{email:body.email,password}});assert.equal(r.status,200);assert.equal(r.data.user.password_hash,undefined);assert.equal(r.data.user.language,'ur');
});
test('profile updates require origin and CSRF; reader cannot promote self',async t=>{
  const f=await fixture(t);
  assert.equal((await f.api('/users/me',{method:'PATCH',body:{name:'Changed'},actor:f.reader,csrf:false})).status,403);
  assert.equal((await f.api('/users/me',{method:'PATCH',body:{name:'Changed'},actor:f.reader,headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await f.api('/users/me',{method:'PATCH',body:{role:'owner'},actor:f.reader})).status,400);
  const r=await f.api('/users/me',{method:'PATCH',body:{profile:{interests:['Travel']},marketingConsent:true},actor:f.reader});assert.deepEqual(r.data.user.profile.interests,['Travel']);assert.equal(r.data.user.marketingConsent,true);
});
test('password reset expires old sessions and outstanding challenges',async t=>{
  const f=await fixture(t);await f.api('/auth/forgot-password',{method:'POST',body:{email:'reader@example.com'}});
  const raw=f.mail.at(-1).text.match(/token=([a-f0-9]{64})/)[1];
  assert.equal((await f.api('/auth/reset-password',{method:'POST',body:{token:raw,password}})).status,200);
  assert.equal((await f.api('/auth/me',{actor:f.reader})).status,401);
  assert.equal((await f.api('/auth/reset-password',{method:'POST',body:{token:raw,password}})).status,400);
});
test('staff password alone grants no session; enrolment encrypts secrets and enforces MFA',async t=>{
  const f=await fixture(t),first=await f.primary('owner');assert.equal(first.status,202);assert.equal(first.cookie,undefined);
  const setup=await f.api('/auth/mfa/setup',{method:'POST',body:{challenge:first.data.challenge}});
  const done=await f.api('/auth/mfa/verify',{method:'POST',body:{challenge:first.data.challenge,code:totp(setup.data.secret)}});assert.equal(done.status,200);assert.equal(done.data.recoveryCodes.length,10);
  assert.notEqual((await f.db.one('mfa_secrets',{user_id:done.data.user.id})).encrypted_secret,setup.data.secret);
  assert.equal((await f.api('/admin/users',{actor:{cookie:done.cookie}})).status,200);
  const raw=token();await f.db.insert('sessions',{token_hash:digest(raw),user_id:done.data.user.id,csrf:'csrf',expires_at:Date.now()+60000,mfa_verified:0});
  assert.equal((await f.api('/admin/users',{actor:{cookie:`manzar_session=${raw}`}})).status,403);
});
test('concurrent MFA code attempts accept only once; recovery codes cannot replay',async t=>{
  const f=await fixture(t),owner=await f.staff();let next=await f.primary('owner');
  const code=totp(owner.setupSecret,(Math.floor(Date.now()/30000)+1)*30000),body={challenge:next.data.challenge,code};
  const results=await Promise.all([f.api('/auth/mfa/verify',{method:'POST',body}),f.api('/auth/mfa/verify',{method:'POST',body})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);
  next=await f.primary('owner');const recovery={challenge:next.data.challenge,code:owner.recoveryCodes[0]};assert.equal((await f.api('/auth/mfa/verify',{method:'POST',body:recovery})).status,200);
  next=await f.primary('owner');assert.equal((await f.api('/auth/mfa/verify',{method:'POST',body:{...recovery,challenge:next.data.challenge}})).status,401);
});
test('MFA lockout survives fresh challenges and expired challenges fail',async t=>{
  const f=await fixture(t);await f.staff();
  for(let i=0;i<5;i++){const r=await f.primary('owner');assert.equal(r.status,202);assert.equal((await f.api('/auth/mfa/verify',{method:'POST',body:{challenge:r.data.challenge,code:'invalid-code'}})).status,401);}
  assert.equal((await f.primary('owner')).status,429);
  const editor=await f.primary('editor');await f.db.updateMany('mfa_challenges',{mode:'setup'},{$set:{expires_at:1}});
  assert.equal((await f.api('/auth/mfa/setup',{method:'POST',body:{challenge:editor.data.challenge}})).status,401);
});
test('owner/editor permissions and suspension revoke customer sessions',async t=>{
  const f=await fixture(t),owner=await f.staff(),editor=await f.staff('editor');
  assert.equal((await f.api('/admin/users',{actor:editor})).status,403);assert.equal((await f.api('/admin/users',{actor:f.reader})).status,403);
  assert.equal((await f.api(`/admin/users/${f.reader.user.id}/status`,{method:'PATCH',body:{suspended:true,reason:'Testing suspension'},actor:owner})).status,200);
  assert.equal((await f.api('/auth/me',{actor:f.reader})).status,401);
  assert.equal((await f.api(`/admin/users/${owner.user.id}/status`,{method:'PATCH',body:{suspended:true,reason:'Cannot suspend owner'},actor:owner})).status,409);
});
test('draft preview, publish, draft/live isolation, restore and unpublish',async t=>{
  const f=await fixture(t),actor=await f.staff(),item=await f.book(actor);
  assert.equal((await f.api('/content/books/'+item.slug)).status,404);
  assert.equal((await f.api(`/admin/content/${item.id}/preview`,{actor})).data.readiness.canPublish,true);
  assert.equal((await f.api(`/admin/content/${item.id}/publish`,{method:'POST',body:{},actor})).status,200);
  const changed=await f.save(item,actor,{translations:{...item.translations,en:{...item.translations.en,title:'Draft rewrite'}}});assert.equal(changed.status,200);
  assert.equal((await f.api('/content/books/'+item.slug)).data.item.translations.en.title,'Original title');
  const revisions=(await f.api(`/admin/content/${item.id}/revisions`,{actor})).data.items;
  const revision=revisions.find(r=>r.snapshot.translations.en.title==='Original title');
  assert.equal((await f.api(`/admin/content/${item.id}/revisions/${revision.id}/restore`,{method:'POST',body:{},actor})).data.item.status,'draft');
  assert.equal((await f.api(`/admin/content/${item.id}/unpublish`,{method:'POST',body:{},actor})).status,200);assert.equal((await f.api('/content/books/'+item.slug)).status,404);
});
test('publish validation and unique live slugs roll back revisions',async t=>{
  const f=await fixture(t),actor=await f.staff(),body=f.draft('reserved');
  const first=await f.api('/admin/content/articles',{method:'POST',body:{...body,status:'published'},actor});
  assert.equal((await f.save(first.data.item,actor,{slug:'working',status:'draft'})).status,200);
  const second=await f.api('/admin/content/articles',{method:'POST',body,actor});
  assert.equal((await f.api(`/admin/content/${second.data.item.id}/publish`,{method:'POST',body:{},actor})).status,409);
  assert.equal(await f.db.count('revisions',{content_id:second.data.item.id}),0);
  const bad=f.draft();delete bad.translations.en.audioUrl;
  const invalid=await f.api('/admin/content/articles',{method:'POST',body:bad,actor});assert.equal((await f.api(`/admin/content/${invalid.data.item.id}/publish`,{method:'POST',body:{},actor})).status,400);
});
test('bilingual search is literal and does not accept MongoDB operator injection',async t=>{
  const f=await fixture(t),actor=await f.staff();await f.api('/admin/content/articles',{method:'POST',body:{...f.draft(),status:'published'},actor});
  assert.equal((await f.api('/content/articles?q='+encodeURIComponent('اردو'))).data.items.length,1);
  assert.equal((await f.api('/content/articles?q='+encodeURIComponent('.*'))).data.items.length,0);
  assert.equal((await f.api('/auth/login',{method:'POST',body:{email:{$ne:null},password}})).status,400);
});
test('cover upload uses native MongoDB metadata, converts image and protects upload access',async t=>{
  const f=await fixture(t),actor=await f.staff(),bytes=await sharp({create:{width:30,height:45,channels:3,background:'#793044'}}).png().toBuffer();
  const route='/admin/uploads/covers',opts={actor,field:'cover',filename:'cover.png',mime:'image/png'};
  assert.equal((await f.upload(route,bytes,{...opts,actor:f.reader})).status,403);
  assert.equal((await f.upload(route,bytes,{...opts,csrf:false})).status,403);
  const r=await f.upload(route,bytes,opts);assert.equal(r.status,201);assert.equal(await f.db.count('cover_uploads'),1);
  const response=await f.api(r.data.cover.url,{raw:true});assert.equal(response.status,200);assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format,'webp');
  assert.equal((await f.upload(route,Buffer.from('<svg/>'),opts)).status,422);
  assert.equal((await f.upload(route,bytes,{...opts,second:true})).status,400);
});
test('cover database failure rolls back metadata and removes derivative',async t=>{
  const f=await fixture(t),actor=await f.staff(),bytes=await sharp({create:{width:10,height:10,channels:3,background:'#fff'}}).png().toBuffer();
  await f.db.database.command({collMod:'audit',validator:{_id:{$exists:false}}});
  assert.equal((await f.upload('/admin/uploads/covers',bytes,{actor,field:'cover',filename:'x.png',mime:'image/png'})).status,500);
  assert.equal(await f.db.count('cover_uploads'),0);assert.deepEqual(await readdir(f.config.coverDirectory),[]);
});
test('private PDFs parse, bind to book/language and remain staff-only',async t=>{
  const f=await fixture(t),actor=await f.staff(),item=await f.book(actor),file=await f.edition(item,actor,'ur');
  assert.equal((await f.api(`/admin/books/${item.id}/files/${file.id}/download`,{actor:f.reader})).status,403);
  const res=await f.api(`/admin/books/${item.id}/files/${file.id}/download`,{actor,raw:true});assert.equal(res.status,200);assert.deepEqual(Buffer.from(await res.arrayBuffer()),file.bytesData);
  assert.equal((await f.api(`/media/books/${file.id}.pdf`)).status,404);
  assert.equal((await f.save(item,actor,{digitalFileIds:{en:file.id}})).status,400);
  const js=await PDFDocument.create();js.addPage();js.addJavaScript('bad','app.alert("bad")');
  assert.equal((await f.upload(`/admin/books/${item.id}/files/en`,Buffer.from(await js.save()),{actor})).status,422);
});
test('narration is decoded to MP3, linked by language and supports seeking',async t=>{
  const f=await fixture(t),actor=await f.staff(),source=join(f.root,'voice.wav');
  await run(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.6',source],{windowsHide:true});
  const r=await f.upload('/admin/uploads/narration/ur',await readFile(source),{actor,field:'audio',filename:'voice.wav',mime:'audio/wav'});assert.equal(r.status,201);assert.equal(await f.db.count('narration_uploads'),1);
  const response=await f.api(r.data.audio.url,{raw:true,headers:{Range:'bytes=0-31'}});assert.equal(response.status,206);await response.arrayBuffer();
  const item=await f.book(actor);assert.equal((await f.save(item,actor,{translations:{en:{title:'Wrong language',audioUrl:r.data.audio.url}}})).status,400);
  assert.deepEqual(await readdir(f.config.audioWorkDirectory),[]);
});
test('checkout snapshots editions; unpaid, forged and failed events never grant access',async t=>{
  const f=await fixture(t),s=await f.sale(),id=await f.checkout(s.item);
  assert.equal(await f.db.count('order_editions',{order_id:id}),2);assert.equal((await f.library()).data.items.length,0);
  assert.equal(await f.webhook(await f.event(id),true),400);
  assert.equal(await f.webhook(await f.event(id,'checkout.session.completed',false)),200);
  assert.equal(await f.webhook(await f.event(id,'checkout.session.async_payment_failed',false)),200);
  assert.equal((await f.library()).data.items.length,0);
});
test('concurrent signed payment events grant exactly once in MongoDB',async t=>{
  const f=await fixture(t),s=await f.sale(),id=await f.checkout(s.item),event=await f.event(id,'checkout.session.async_payment_succeeded');
  const results=await Promise.all([f.webhook(event),f.webhook(event)]);assert.deepEqual(results,[200,200]);
  assert.equal((await f.library()).data.items.length,2);assert.equal(await f.db.count('entitlements',{order_id:id}),2);
  assert.equal(await f.db.count('payment_events',{id:event.id}),1);
});
test('library and links enforce ownership, CSRF, expiry and one-time concurrent claims',async t=>{
  const f=await fixture(t);await f.paid();const item=(await f.library()).data.items[0];
  assert.equal((await f.api('/library')).status,401);assert.equal((await f.link(item.id,f.other)).status,404);assert.equal((await f.link(item.id,f.reader,false)).status,403);
  let url=(await f.link(item.id)).data.url;
  assert.equal((await f.api(url,{actor:f.other,raw:true})).status,404);
  await f.db.updateMany('download_links',{},{$set:{expires_at:1}});assert.equal((await f.api(url,{actor:f.reader,raw:true})).status,404);
  url=(await f.link(item.id)).data.url;
  const responses=await Promise.all([f.api(url,{actor:f.reader,raw:true}),f.api(url,{actor:f.reader,raw:true})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,404]);
  const ok=responses.find(r=>r.status===200);assert.equal(ok.headers.get('cache-control'),'private, no-store');assert.match(ok.headers.get('content-disposition'),/^attachment/);await ok.arrayBuffer();
});
test('purchased edition stays immutable after book edits/unpublish',async t=>{
  const f=await fixture(t),s=await f.sale(),id=await f.checkout(s.item);
  await f.api(`/admin/content/${s.item.id}/unpublish`,{method:'POST',body:{},actor:s.owner});
  assert.equal(await f.webhook(await f.event(id)),200);
  const item=(await f.library()).data.items.find(i=>i.language==='en'),url=(await f.link(item.id)).data.url;
  const res=await f.api(url,{actor:f.reader,raw:true});assert.deepEqual(Buffer.from(await res.arrayBuffer()),s.en.bytesData);
});
test('refunds revoke old links and late payment cannot regrant; partial refund retains access',async t=>{
  const f=await fixture(t),s=await f.paid(),item=(await f.library()).data.items[0],url=(await f.link(item.id)).data.url;
  assert.equal(await f.webhook(f.refund(s.orderId,false)),200);assert.equal((await f.library()).data.items.length,2);
  assert.equal(await f.webhook(f.refund(s.orderId)),200);assert.equal((await f.library()).data.items.length,0);assert.equal((await f.api(url,{actor:f.reader,raw:true})).status,404);
  assert.equal(await f.webhook(await f.event(s.orderId)),200);assert.equal((await f.library()).data.items.length,0);
});
test('refund-before-payment and logout cannot be bypassed by stale links',async t=>{
  const f=await fixture(t),s=await f.sale(),id=await f.checkout(s.item);
  assert.equal(await f.webhook(f.refund(id)),200);assert.equal(await f.webhook(await f.event(id)),200);assert.equal((await f.library()).data.items.length,0);
  const id2=await f.checkout(s.item);assert.equal(await f.webhook(await f.event(id2)),200);const item=(await f.library()).data.items[0],url=(await f.link(item.id)).data.url;
  assert.equal((await f.api('/auth/logout',{method:'POST',actor:f.reader,raw:true})).status,204);assert.equal((await f.api(url,{actor:f.reader,raw:true})).status,401);
});
test('missing private files fail safely without consuming download links',async t=>{
  const f=await fixture(t),s=await f.paid(),item=(await f.library()).data.items.find(i=>i.language==='en'),url=(await f.link(item.id)).data.url;
  await unlink(join(f.config.privateBookDirectory,s.en.id+'.pdf'));assert.equal((await f.api(url,{actor:f.reader,raw:true})).status,503);
  assert.equal((await f.db.one('download_links',{})).used_at,null);assert.equal((await f.link(item.id)).status,503);
});
test('contact/enquiries and order data remain permission scoped',async t=>{
  const f=await fixture(t),actor=await f.staff();
  assert.equal((await f.api('/enquiries',{method:'POST',body:{name:'Reader',email:'reader@example.com',kind:'contact',message:'A literary enquiry',language:'en'}})).status,201);
  assert.equal((await f.api('/admin/enquiries',{actor})).data.items.length,1);
  const s=await f.sale(),id=await f.checkout(s.item);assert.equal((await f.api('/orders/'+id,{actor:f.other})).status,404);
});
test('TOTP matches RFC vectors; encryption stays authenticated and user-bound',()=>{
  const secret=base32(Buffer.from('12345678901234567890'));
  for(const [seconds,value]of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']])assert.equal(totp(secret,seconds*1000,8),value);
  const now=1234567890000;assert.equal(verifyTotp(secret,totp(secret,now),Math.floor(now/30000),now),null);
  const key=randomBytes(32),packed=seal('secret',key,'one');assert.equal(unseal(packed,key,'one'),'secret');assert.throws(()=>unseal(packed,key,'two'));
});
test('expired/reset verification links reject replay without account enumeration',async t=>{
  const f=await fixture(t);const before=f.mail.length;
  const absent=await f.api('/auth/forgot-password',{method:'POST',body:{email:'absent@example.com'}});
  assert.equal(absent.status,202);assert.equal(f.mail.length,before);
  await f.api('/auth/forgot-password',{method:'POST',body:{email:'reader@example.com'}});
  const raw=f.mail.at(-1).text.match(/token=([a-f0-9]{64})/)[1];await f.db.updateMany('tokens',{},{$set:{expires_at:1}});
  assert.equal((await f.api('/auth/reset-password',{method:'POST',body:{token:raw,password}})).status,400);
});
test('cover byte/pixel/animation/type limits persist no invalid assets',async t=>{
  const f=await fixture(t),actor=await f.staff(),opts={actor,field:'cover',filename:'cover.png',mime:'image/png'},route='/admin/uploads/covers';
  assert.equal((await f.upload(route,Buffer.alloc(5*1024*1024+1),opts)).status,413);
  const large=await sharp({create:{width:5000,height:5000,channels:3,background:'#fff'}}).png().toBuffer();
  assert.equal((await f.upload(route,large,opts)).status,422);
  const animated=await sharp(Buffer.from([255,0,0,0,255,0]),{raw:{width:1,height:2,channels:3,pageHeight:1}}).webp({loop:0,delay:[100,100]}).toBuffer();
  assert.equal((await f.upload(route,animated,{...opts,filename:'cover.webp',mime:'image/webp'})).status,422);
  assert.equal((await f.upload(route,Buffer.from('fake'),{...opts,mime:'text/html'})).status,415);
  assert.equal(await f.db.count('cover_uploads'),0);
});
test('private files reject embedded attachments/forms, oversized content and extra fields',async t=>{
  const f=await fixture(t),actor=await f.staff(),item=await f.book(actor),route=`/admin/books/${item.id}/files/en`;
  const attachment=await PDFDocument.create();attachment.addPage();await attachment.attach(Buffer.from('payload'),'payload.exe');
  assert.equal((await f.upload(route,Buffer.from(await attachment.save()),{actor})).status,422);
  const form=await PDFDocument.create();form.getForm().createTextField('field').addToPage(form.addPage());
  assert.equal((await f.upload(route,Buffer.from(await form.save()),{actor})).status,422);
  assert.equal((await f.upload(route,Buffer.alloc(50*1024*1024+1),{actor})).status,413);
  assert.equal((await f.upload(route,await f.pdf(),{actor,extra:true})).status,400);
  assert.equal(await f.db.count('private_book_files'),0);
});
test('PDF metadata and file both roll back on audit failure',async t=>{
  const f=await fixture(t),actor=await f.staff(),item=await f.book(actor);
  await f.db.database.command({collMod:'audit',validator:{_id:{$exists:false}}});
  assert.equal((await f.upload(`/admin/books/${item.id}/files/en`,await f.pdf(),{actor})).status,500);
  assert.equal(await f.db.count('private_book_files'),0);assert.deepEqual(await readdir(f.config.privateBookDirectory),[]);
});
test('narration accepts all supported containers and rejects mismatched/corrupt/oversized data',async t=>{
  const f=await fixture(t),actor=await f.staff(),source=join(f.root,'recording.wav');
  await run(ffmpeg,['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.6',source],{windowsHide:true});
  for(const [ext,mime]of [['mp3','audio/mpeg'],['m4a','audio/mp4']]){
    const path=join(f.root,'recording.'+ext);await run(ffmpeg,['-nostdin','-v','error','-i',source,path],{windowsHide:true});
    const r=await f.upload('/admin/uploads/narration/en',await readFile(path),{actor,field:'audio',filename:'recording.'+ext,mime});assert.equal(r.status,201);
  }
  const opts={actor,field:'audio',filename:'bad.wav',mime:'audio/wav'};
  assert.equal((await f.upload('/admin/uploads/narration/en',Buffer.from('RIFF1234WAVEbroken'),opts)).status,422);
  assert.equal((await f.upload('/admin/uploads/narration/en',Buffer.alloc(50*1024*1024+1),opts)).status,413);
  assert.equal((await f.upload('/admin/uploads/narration/fr',await readFile(source),opts)).status,400);
});
test('checkout rejects client prices and mismatched paid events roll back grants',async t=>{
  const f=await fixture(t),s=await f.sale();
  assert.equal((await f.api('/payments/checkout',{method:'POST',body:{bookId:s.item.id,amount:1},actor:f.reader})).status,400);
  const id=await f.checkout(s.item),event=await f.event(id);event.data.object.amount_total=1;
  assert.equal(await f.webhook(event),409);assert.equal((await f.db.one('orders',{id})).status,'pending');assert.equal(await f.db.count('entitlements'),0);
});
test('HEAD and ranges cannot spend a single-use download and legacy paid orders inherit no files',async t=>{
  const f=await fixture(t),s=await f.paid(),item=(await f.library()).data.items[0],url=(await f.link(item.id)).data.url;
  assert.equal((await f.api(url,{method:'HEAD',actor:f.reader,raw:true})).status,405);
  assert.equal((await f.api(url,{actor:f.reader,headers:{Range:'bytes=0-20'},raw:true})).status,400);
  const response=await f.api(url,{actor:f.reader,raw:true});assert.equal(response.status,200);await response.arrayBuffer();
  await f.db.insert('orders',{id:randomUUID(),user_id:f.other.user.id,book_id:s.item.id,amount:1000,currency:'usd',status:'paid',created_at:Date.now()});
  assert.equal((await f.api('/library',{actor:f.other})).data.items.length,0);
});
