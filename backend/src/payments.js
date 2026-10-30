import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { contentSchema } from './schemas.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function createPayments({db,config,stripe,library,privateBooks}){
  async function lockIntent(intent){
    await db.update('payment_reversals',{payment_intent:intent},{$inc:{serial:1},$setOnInsert:{fully_refunded:0,amount_refunded:0}},{upsert:true});
    return db.one('payment_reversals',{payment_intent:intent});
  }
  async function process(event){
    await db.transaction(async()=>{
      if(await db.one('payment_events',{id:event.id}))return;
      const object=event.data.object;
      if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&object.payment_status==='paid'){
        const order=await db.one('orders',{stripe_session:object.id});
        if(!order)throw fail(409,'Unknown checkout session; retry after order reconciliation');
        if(object.amount_total!==order.amount||object.currency!==order.currency||object.metadata?.orderId!==order.id)throw fail(409,'Payment does not match order');
        const intent=typeof object.payment_intent==='string'?object.payment_intent:object.payment_intent?.id||null;
        if(order.payment_intent&&order.payment_intent!==intent)throw fail(409,'Payment intent does not match order');
        const reversal=intent?await lockIntent(intent):null;
        const status=order.status==='refunded'||reversal?.fully_refunded?'refunded':reversal?.amount_refunded||order.status==='partially_refunded'?'partially_refunded':'paid';
        await db.update('orders',{id:order.id},{$set:{status,...(intent?{payment_intent:intent}:{})}});
        if(status==='refunded')await library.revoke(order.id);else await library.grant(order);
      }
      if(event.type==='charge.refunded'){
        const intent=typeof object.payment_intent==='string'?object.payment_intent:object.payment_intent?.id;
        if(intent&&Number.isInteger(object.amount_refunded)&&object.amount_refunded>0&&Number.isInteger(object.amount)){
          await lockIntent(intent);
          await db.update('payment_reversals',{payment_intent:intent},{$max:{fully_refunded:Number(object.refunded===true&&object.amount_refunded>=object.amount),amount_refunded:object.amount_refunded}});
          const reversal=await db.one('payment_reversals',{payment_intent:intent}),order=await db.one('orders',{payment_intent:intent});
          if(order){await db.update('orders',{id:order.id},{$set:{status:reversal.fully_refunded?'refunded':'partially_refunded'}});if(reversal.fully_refunded)await library.revoke(order.id);}
        }
      }
      if(['checkout.session.async_payment_failed','checkout.session.expired'].includes(event.type))await db.update('orders',{stripe_session:object.id,status:'pending'},{$set:{status:'failed'}});
      await db.insert('payment_events',{id:event.id,created_at:Date.now()});
    });
  }
  async function webhook(req,res){
    if(!stripe||!config.webhookSecret)throw fail(503,'Stripe is not configured');
    let event;try{event=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],config.webhookSecret);}catch{throw fail(400,'Invalid Stripe signature');}
    try{await process(event);}catch(error){
      // Concurrent event/intent creation can produce a duplicate-key error rather
      // than a labelled write conflict. Retry against a fresh snapshot.
      if(error.code!==11000)throw error;
      if(!await db.one('payment_events',{id:event.id}))await process(event);
    }res.json({received:true});
  }
  async function checkout(req,res){
    if(!stripe)throw fail(503,'Stripe test credentials have not been configured');
    const {bookId}=z.object({bookId:z.uuid()}).strict().parse(req.body);
    const book=await db.one('content',{id:bookId,kind:'books',published_payload:{$ne:null}});
    if(!book)throw fail(404,'Book not found');
    const data=contentSchema.parse(book.published_payload);
    await privateBooks.validateReferences('books',book.id,data);
    if(!data.digitalAvailable||!data.priceMinor||!data.currency)throw fail(409,'Book is not available for digital purchase');
    const id=randomUUID();
    await db.transaction(async()=>{
      await db.insert('orders',{id,user_id:req.user.id,book_id:bookId,amount:data.priceMinor,currency:data.currency,status:'pending',created_at:Date.now()});
      for(const [language,fileId]of Object.entries(data.digitalFileIds||{}))await db.insert('order_editions',{order_id:id,file_id:fileId,language,title:(data.translations[language]||data.translations.ur||data.translations.en).title});
    });
    try{
      const session=await stripe.checkout.sessions.create({mode:'payment',customer_email:req.user.email,metadata:{orderId:id},
        line_items:[{price_data:{currency:data.currency,unit_amount:data.priceMinor,product_data:{name:(data.translations[req.user.language]||data.translations.ur||data.translations.en).title,description:`PDF editions: ${Object.keys(data.digitalFileIds||{}).join(', ')}`}},quantity:1}],
        success_url:`${config.origin}/${req.user.language}/orders/${id}?checkout=returned`,cancel_url:`${config.origin}/${req.user.language}/books/${data.slug}`},{idempotencyKey:id});
      await db.update('orders',{id},{$set:{stripe_session:session.id}});res.status(201).json({orderId:id,checkoutUrl:session.url});
    }catch{throw fail(502,'Checkout unavailable; order retained for reconciliation');}
  }
  return{webhook,checkout};
}
