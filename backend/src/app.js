import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { z,ZodError } from 'zod';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { publicUser } from './security.js';
import * as schemas from './schemas.js';
import { installAuth } from './auth-routes.js';
import { createPayments } from './payments.js';
import { createCoverHandlers,coverPath } from './covers.js';
import { createAudioHandlers,audioPath } from './audio.js';
import { createPrivateBookHandlers } from './private-books.js';
import { createLibrary } from './library.js';
import { createMediaStorage } from './media-storage.js';
import { testingAccess } from './testing-access.js';
import { resolve } from 'node:path';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const kinds=new Set(['books','articles','pages','videos']);
const paging=req=>({limit:Math.min(100,Math.max(1,Math.trunc(Number(req.query.limit)||20))),skip:Math.max(0,Math.trunc(Number(req.query.offset)||0))});
const view=row=>({id:row.id,kind:row.kind,...row.payload,createdAt:row.created_at,updatedAt:row.updated_at});
const publicView=row=>{const data={...row.published_payload},digitalLanguages=Object.keys(data.digitalFileIds||{});delete data.digitalFileIds;return{id:row.id,kind:row.kind,...data,digitalLanguages,createdAt:row.created_at,updatedAt:row.updated_at};};
export function createApp({db,config,sendMail,stripe=config.stripeKey?new Stripe(config.stripeKey):null}){
  if(db.kind!=='mongodb')throw new Error('The API requires the MongoDB data store.');
  const app=express();app.disable('x-powered-by');app.use(helmet({contentSecurityPolicy:{directives:{
    'style-src':["'self'","'unsafe-inline'",'https://fonts.googleapis.com'],
    'font-src':["'self'",'https://fonts.gstatic.com','data:'],
    'img-src':["'self'",'https:','data:','blob:'],
    'media-src':["'self'",'https:','blob:'],
  }}}));app.use(cors({origin:config.origin,credentials:true}));
  const audit=(actor,action,target)=>db.insert('audit',{id:randomUUID(),actor_id:actor,action,target_id:target,created_at:Date.now()});
  const limiter=(limit,windowMs=900000)=>rateLimit({windowMs,limit,standardHeaders:'draft-8',legacyHeaders:false,skip:()=>config.disableRateLimits===true});
  app.use(limiter(500));
  app.get('/healthz',async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{await db.database.command({ping:1});res.status(200).send('ok');}
    catch{res.status(503).send('unavailable');}
  });
  if(config.privateTesting)app.use(testingAccess(config));
  const storage=config.mediaStorage || (config.mediaStorageMode==='mongodb'?createMediaStorage(db.database):undefined);
  const covers=createCoverHandlers({db,directory:config.coverDirectory,audit,storage}),narration=createAudioHandlers({db,config:{...config,mediaStorage:storage},audit});
  const privateBooks=createPrivateBookHandlers({db,directory:config.privateBookDirectory,audit,storage}),library=createLibrary({db,directory:config.privateBookDirectory,audit,storage});
  const payments=createPayments({db,config,stripe,library,privateBooks});
  app.get('/api/v1/media/covers/:filename',covers.serve);app.get('/api/v1/media/narration/:filename',narration.serve);
  app.post('/api/v1/payments/webhook',express.raw({type:'application/json',limit:'1mb'}),payments.webhook);
  app.use(express.json({limit:'256kb'}));app.use(cookieParser());
  const {auth,verified,csrf,staff,owner,staffMfa}=installAuth(app,{db,config,sendMail,audit,limiter});
  app.get('/api/v1/health',async(req,res)=>{await db.database.command({ping:1});res.json({status:'ok',version:'0.2.0',database:'mongodb',mode:config.privateTesting?'private-testing':'development'});});
  app.use(['/api/v1/library','/api/v1/downloads'],(req,res,next)=>{res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});next();});
  app.get('/api/v1/library',auth,verified,library.list);
  app.post('/api/v1/library/:id/download-links',limiter(20),auth,verified,csrf,library.issue);
  app.head('/api/v1/downloads/:token',(req,res)=>res.status(405).set('Allow','GET').end());
  app.get('/api/v1/downloads/:token',limiter(40),auth,verified,library.download);
  app.get('/api/v1/content/:kind',async(req,res)=>{
    if(!kinds.has(req.params.kind))throw fail(404,'Not found');
    const {limit,skip}=paging(req),search=z.string().max(120).parse(req.query.q||''),filter={kind:req.params.kind,published_payload:{$ne:null}};
    if(search){const regex=search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');filter.$or=['en','ur'].flatMap(lang=>['title','summary','body'].map(field=>({[`published_payload.translations.${lang}.${field}`]:{$regex:regex,$options:'i'}})));}
    res.json({items:(await db.many('content',filter,{sort:{created_at:-1},limit,skip})).map(publicView),limit,offset:skip});
  });
  app.get('/api/v1/content/:kind/:slug',async(req,res)=>{const row=await db.one('content',{kind:req.params.kind,published_slug:req.params.slug,published_payload:{$ne:null}});if(!row)throw fail(404,'Content not found');res.json({item:publicView(row)});});
  app.post('/api/v1/enquiries',limiter(5,3600000),async(req,res)=>{const data=schemas.enquiry.parse(req.body),id=randomUUID();await db.insert('enquiries',{id,...data,status:'new',created_at:Date.now()});res.status(201).json({message:'Enquiry received',id});});
  app.use('/api/v1/admin',auth,verified,staff,staffMfa,(req,res,next)=>{res.set('Cache-Control','no-store');return['GET','HEAD','OPTIONS'].includes(req.method)?next():csrf(req,res,next);});
  app.post('/api/v1/admin/uploads/covers',limiter(20,3600000),covers.capacity,covers.multipart,covers.upload);
  app.post('/api/v1/admin/uploads/narration/:language',limiter(20,3600000),narration.capacity,narration.multipart,narration.upload);
  app.post('/api/v1/admin/books/:bookId/files/:language',limiter(20,3600000),privateBooks.admission,privateBooks.multipart,privateBooks.upload);
  app.get('/api/v1/admin/books/:bookId/files',privateBooks.list);
  app.get('/api/v1/admin/books/:bookId/files/:fileId/download',privateBooks.download);
  async function checkContent(kind,id,data){
    if(data.coverUrl&&coverPath.test(data.coverUrl)&&!await db.one('cover_uploads',{filename:data.coverUrl.split('/').at(-1)}))throw fail(400,'Uploaded cover does not exist');
    for(const [language,v]of Object.entries(data.translations))if(v?.audioUrl&&audioPath.test(v.audioUrl)){
      const row=await db.one('narration_uploads',{filename:v.audioUrl.split('/').at(-1)});
      if(!row)throw fail(400,'Uploaded narration does not exist');if(row.language!==language)throw fail(400,'Uploaded narration language must match the content language');
    }
    if(data.digitalAvailable&&kind!=='books')throw fail(400,'Only books can be sold as digital editions');
    await privateBooks.validateReferences(kind,id,data);
  }
  async function getContent(id){const row=await db.one('content',{id});if(!row)throw fail(404,'Content not found');return row;}
  async function saveContent(id,data,actor,action,clearLive=false){
    await db.transaction(async()=>{
      const row=await getContent(id);if(!clearLive)await checkContent(row.kind,id,data);
      await db.insert('revisions',{id:randomUUID(),content_id:id,snapshot:row.payload,actor_id:actor,created_at:Date.now()});
      const publish=data.status==='published'&&!clearLive;
      await db.update('content',{id},{$set:{slug:data.slug,status:data.status,payload:data,updated_at:Date.now(),published_payload:clearLive?null:publish?data:row.published_payload,published_slug:clearLive?null:publish?data.slug:row.published_slug}});
      await audit(actor,action,id);
    });return view(await getContent(id));
  }
  app.get('/api/v1/admin/content/:kind',async(req,res)=>{if(!kinds.has(req.params.kind))throw fail(404,'Not found');res.json({items:(await db.many('content',{kind:req.params.kind},{...paging(req),sort:{updated_at:-1}})).map(view)});});
  app.post('/api/v1/admin/content/:kind',async(req,res)=>{
    if(!kinds.has(req.params.kind))throw fail(404,'Not found');const data=schemas.contentSchema.parse(req.body),id=randomUUID(),now=Date.now();
    await db.transaction(async()=>{await checkContent(req.params.kind,id,data);await db.insert('content',{id,kind:req.params.kind,slug:data.slug,status:data.status,payload:data,created_at:now,updated_at:now,published_payload:data.status==='published'?data:null,published_slug:data.status==='published'?data.slug:null});await audit(req.user.id,'content.create',id);});
    res.status(201).json({item:view(await getContent(id))});
  });
  app.put('/api/v1/admin/content/:id',async(req,res)=>res.json({item:await saveContent(req.params.id,schemas.contentSchema.parse(req.body),req.user.id,'content.update')}));
  app.get('/api/v1/admin/content/:id/preview',async(req,res)=>{
    const row=await getContent(req.params.id);let issues=[];
    try{const data=schemas.contentSchema.parse({...row.payload,status:'published'});await checkContent(row.kind,row.id,data);}
    catch(error){if(error instanceof ZodError)issues=error.issues.map(i=>({path:i.path,message:i.message}));else if(error.status&&error.status<500)issues=[{message:error.message}];else throw error;}
    res.json({item:view(row),live:row.published_payload?publicView(row):null,readiness:{canPublish:!issues.length,issues}});
  });
  for(const action of ['publish','unpublish'])app.post(`/api/v1/admin/content/:id/${action}`,async(req,res)=>{
    z.object({}).strict().parse(req.body||{});const row=await getContent(req.params.id),data=schemas.contentSchema.parse({...row.payload,status:action==='publish'?'published':'draft'});
    res.json({item:await saveContent(row.id,data,req.user.id,`content.${action}`,action==='unpublish')});
  });
  app.get('/api/v1/admin/content/:id/revisions',async(req,res)=>res.json({items:await db.many('revisions',{content_id:req.params.id},{sort:{created_at:-1},limit:100})}));
  app.post('/api/v1/admin/content/:id/revisions/:revisionId/restore',async(req,res)=>{
    z.object({}).strict().parse(req.body||{});const revisionId=z.string().regex(/^(?:[a-f0-9-]{36}|\d+)$/).parse(req.params.revisionId);
    const revision=await db.one('revisions',{id:revisionId,content_id:req.params.id});if(!revision)throw fail(404,'Revision not found for this content');
    res.json({item:await saveContent(req.params.id,schemas.contentSchema.parse({...revision.snapshot,status:'draft'}),req.user.id,'content.restore')});
  });
  app.get('/api/v1/admin/users',owner,async(req,res)=>res.json({items:(await db.many('users',{}, {...paging(req),sort:{created_at:-1}})).map(publicUser)}));
  app.patch('/api/v1/admin/users/:id/status',owner,async(req,res)=>{
    const data=z.object({suspended:z.boolean(),reason:z.string().min(5).max(250)}).strict().parse(req.body);
    await db.transaction(async()=>{const user=await db.one('users',{id:req.params.id});if(!user)throw fail(404,'User not found');if(user.role==='owner')throw fail(409,'Owner accounts cannot be suspended through this endpoint');
      await db.update('users',{id:user.id},{$set:{suspended:Number(data.suspended)}});
      if(data.suspended){await db.delete('sessions',{user_id:user.id});await db.delete('mfa_challenges',{user_id:user.id});}
      await audit(req.user.id,`${data.suspended?'user.suspend':'user.reactivate'}: ${data.reason}`,user.id);
    });res.json({user:publicUser(await db.one('users',{id:req.params.id}))});
  });
  app.get('/api/v1/admin/enquiries',async(req,res)=>res.json({items:await db.many('enquiries',{}, {...paging(req),sort:{created_at:-1}})}));
  app.get('/api/v1/admin/audit',owner,async(req,res)=>res.json({items:await db.many('audit',{}, {...paging(req),sort:{created_at:-1}})}));
  app.get('/api/v1/admin/orders',owner,async(req,res)=>res.json({items:await db.many('orders',{}, {...paging(req),sort:{created_at:-1}})}));
  app.post('/api/v1/payments/checkout',limiter(10),auth,verified,csrf,payments.checkout);
  app.get('/api/v1/orders',auth,async(req,res)=>{res.set('Cache-Control','no-store');res.json({items:await db.many('orders',{user_id:req.user.id},{...paging(req),sort:{created_at:-1},projection:{_id:0,id:1,book_id:1,amount:1,currency:1,status:1,created_at:1}})});});
  app.get('/api/v1/orders/:id',auth,async(req,res)=>{res.set('Cache-Control','no-store');const order=await db.one('orders',{id:req.params.id,user_id:req.user.id},{projection:{_id:0,id:1,book_id:1,amount:1,currency:1,status:1,created_at:1}});if(!order)throw fail(404,'Order not found');res.json({order});});
  app.use('/api',(req,res)=>res.status(404).json({error:{message:'Endpoint not found'}}));
  if(config.frontendDirectory){
    app.use(express.static(config.frontendDirectory,{index:false,dotfiles:'deny'}));
    app.get('/{*path}',(req,res,next)=>{
      if(!req.accepts('html'))return next();
      res.sendFile(resolve(config.frontendDirectory,'index.html'));
    });
  }
  app.use((req,res)=>res.status(404).json({error:{message:'Endpoint not found'}}));
  app.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    if(error instanceof ZodError)return res.status(400).json({error:{message:'Validation failed',issues:error.issues.map(i=>({path:i.path,message:i.message}))}});
    if(error.code===11000)return res.status(409).json({error:{message:'Record conflicts with an existing record'}});
    const status=error.status||500;if(status>=500)console.error(JSON.stringify({event:'request_failed',requestId:req.requestId,name:error.name}));
    res.status(status).json({error:{message:status>=500&&status!==503?'Service temporarily unavailable':error.message}});
  });return app;
}
