import { resolve } from 'node:path';
import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { token,digest } from './security.js';
export const DOWNLOAD_TTL_MS=300000;
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function createLibrary({db,directory,audit,storage}){
  const root=resolve(directory||'data/private-books');
  async function eligible(id,userId){
    const e=await db.one('entitlements',{id,user_id:userId,revoked_at:null});if(!e)return null;
    const order=await db.one('orders',{id:e.order_id,user_id:userId,status:{$in:['paid','partially_refunded']}});
    const file=order?await db.one('private_book_files',{id:e.file_id,book_id:order.book_id,language:e.language}):null;
    return file?{...e,filename:file.filename,bytes:file.bytes,page_count:file.page_count,book_id:order.book_id}:null;
  }
  async function grant(order){
    for(const edition of await db.many('order_editions',{order_id:order.id})){
      await db.update('entitlements',{order_id:order.id,file_id:edition.file_id},{$setOnInsert:{id:randomUUID(),user_id:order.user_id,order_id:order.id,file_id:edition.file_id,language:edition.language,title:edition.title,created_at:Date.now(),revoked_at:null}},{upsert:true});
    }
  }
  const revoke=orderId=>db.updateMany('entitlements',{order_id:orderId,revoked_at:null},{$set:{revoked_at:Date.now()}});
  async function list(req,res){
    const limit=Math.min(100,Math.max(1,Math.trunc(Number(req.query.limit)||20))),offset=Math.max(0,Math.trunc(Number(req.query.offset)||0));
    const rows=await db.aggregate('entitlements',[
      {$match:{user_id:req.user.id,revoked_at:null}},
      {$lookup:{from:'orders',localField:'order_id',foreignField:'id',as:'order'}},{$unwind:'$order'},
      {$match:{'order.user_id':req.user.id,'order.status':{$in:['paid','partially_refunded']}}},
      {$lookup:{from:'private_book_files',localField:'file_id',foreignField:'id',as:'file'}},{$unwind:'$file'},
      {$sort:{created_at:-1,id:1}},{$skip:offset},{$limit:limit},
      {$project:{_id:0,id:1,orderId:'$order_id',bookId:'$order.book_id',language:1,title:1,acquiredAt:'$created_at',bytes:'$file.bytes',pageCount:'$file.page_count',format:{$literal:'pdf'}}}
    ]);res.json({items:rows,limit,offset});
  }
  async function issue(req,res){
    z.object({}).strict().parse(req.body||{});z.uuid().parse(req.params.id);
    const item=await eligible(req.params.id,req.user.id);if(!item)throw fail(404,'Purchased edition not found');
    await storage?.ensure('books',item.filename,resolve(root,item.filename));
    let handle;try{handle=await open(resolve(root,item.filename),'r');}catch{throw fail(503,'Your purchased file is temporarily unavailable. Please contact support.');}await handle.close();
    const raw=token(),expiresAt=Date.now()+DOWNLOAD_TTL_MS;
    await db.transaction(async()=>{
      if(!await eligible(item.id,req.user.id))throw fail(404,'Purchased edition not found');
      await db.update('entitlements',{id:item.id,revoked_at:null},{$inc:{link_version:1}});
      await db.delete('download_links',{$or:[{expires_at:{$lte:Date.now()}},{entitlement_id:item.id,session_hash:req.session.token_hash}]});
      await db.insert('download_links',{token_hash:digest(raw),entitlement_id:item.id,user_id:req.user.id,session_hash:req.session.token_hash,expires_at:expiresAt,used_at:null});
      await audit(req.user.id,'library.download_link.created',item.id);
    });res.status(201).json({url:`/api/v1/downloads/${raw}`,expiresAt,singleUse:true});
  }
  async function download(req,res,next){
    if(!/^[a-f0-9]{64}$/.test(req.params.token))throw fail(404,'Download link not found');
    if(req.headers.range)throw fail(400,'Use a fresh download without a Range header');
    async function lookup(){
      const link=await db.one('download_links',{token_hash:digest(req.params.token),user_id:req.user.id,session_hash:req.session.token_hash,used_at:null,expires_at:{$gt:Date.now()}});
      if(!link)throw fail(404,'Download link expired, used or unavailable. Create a new link from your library.');
      const item=await eligible(link.entitlement_id,req.user.id);if(!item)throw fail(404,'Purchased edition not found');return{item,link};
    }
    const {item}=await lookup();let file;
    await storage?.ensure('books',item.filename,resolve(root,item.filename));
    try{file=await open(resolve(root,item.filename),'r');}catch{throw fail(503,'Your purchased file is temporarily unavailable. Please contact support.');}
    try{
      const details=await file.stat();if(!details.isFile()||details.size!==item.bytes)throw fail(503,'Purchased file requires a storage integrity check');
      await db.transaction(async()=>{
        await lookup();
        // Writes force conflicts with simultaneous refund, logout and suspension.
        const session=await db.update('sessions',{token_hash:req.session.token_hash,user_id:req.user.id,expires_at:{$gt:Date.now()}},{$inc:{download_claims:1}});
        const user=await db.update('users',{id:req.user.id,suspended:0,verified:1},{$inc:{download_claims:1}});
        if(!session.matchedCount||!user.matchedCount)throw fail(401,'Sign in again to download');
        if(!(await db.update('entitlements',{id:item.id,revoked_at:null},{$inc:{download_claims:1}})).matchedCount)throw fail(404,'Purchased edition not found');
        const claimed=await db.update('download_links',{token_hash:digest(req.params.token),used_at:null,expires_at:{$gt:Date.now()}},{$set:{used_at:Date.now()}});
        if(!claimed.matchedCount)throw fail(404,'Download link unavailable');
        await audit(req.user.id,'library.download.started',item.id);
      });
      res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="book-${item.language}.pdf"`,'Content-Length':String(details.size),'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','Accept-Ranges':'none','X-Content-Type-Options':'nosniff'});
      const stream=file.createReadStream();stream.on('error',()=>{if(res.headersSent)res.destroy();else next(fail(503,'Download interrupted. Request a new link.'));});res.on('close',()=>stream.destroy());stream.pipe(res);
    }catch(error){await file.close();throw error;}
  }
  return{grant,revoke,list,issue,download};
}
