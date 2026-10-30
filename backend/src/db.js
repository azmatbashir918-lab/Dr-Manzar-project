import { MongoClient } from 'mongodb';
import { AsyncLocalStorage } from 'node:async_hooks';

export const COLLECTIONS = ['users','sessions','tokens','content','revisions','audit','enquiries','orders','payment_events',
  'mfa_secrets','mfa_challenges','mfa_recovery','mfa_attempts','cover_uploads','narration_uploads','private_book_files',
  'order_editions','entitlements','download_links','payment_reversals'];
const indexes = {
  users: [[{id:1},{unique:true}],[{email:1},{unique:true}]],
  sessions: [[{token_hash:1},{unique:true}],[{user_id:1},{}]],
  tokens: [[{token_hash:1},{unique:true}],[{user_id:1,purpose:1},{}]],
  content: [[{id:1},{unique:true}],[{kind:1,slug:1},{unique:true}],[{kind:1,published_slug:1},{unique:true,partialFilterExpression:{published_slug:{$type:'string'}}}]],
  orders: [[{id:1},{unique:true}],[{user_id:1,created_at:-1},{}],...['stripe_session','payment_intent'].map(k=>[{[k]:1},{unique:true,partialFilterExpression:{[k]:{$type:'string'}}}])],
  payment_events: [[{id:1},{unique:true}]],
  revisions: [[{id:1},{unique:true}],[{content_id:1,created_at:-1},{}]],
  audit: [[{id:1},{unique:true}],[{created_at:-1},{}]],
  enquiries: [[{id:1},{unique:true}]],
  mfa_secrets: [[{user_id:1},{unique:true}]],
  mfa_challenges: [[{token_hash:1},{unique:true}],[{user_id:1},{}]],
  mfa_recovery: [[{code_hash:1},{unique:true}]],
  mfa_attempts: [[{user_id:1},{unique:true}]],
  cover_uploads: [[{id:1},{unique:true}],[{filename:1},{unique:true}]],
  narration_uploads: [[{id:1},{unique:true}],[{filename:1},{unique:true}]],
  private_book_files: [[{id:1},{unique:true}],[{filename:1},{unique:true}],[{book_id:1},{}]],
  order_editions: [[{order_id:1,language:1},{unique:true}]],
  entitlements: [[{id:1},{unique:true}],[{order_id:1,file_id:1},{unique:true}],[{user_id:1,created_at:-1},{}]],
  download_links: [[{token_hash:1},{unique:true}]],
  payment_reversals: [[{payment_intent:1},{unique:true}]],
};

export async function openDatabase({uri,name,client:suppliedClient}={}) {
  if (!uri && !suppliedClient) throw new Error('MONGODB_URI is required.');
  if (!name || /[\/\\. "$*<>:|?\x00]/.test(name)) throw new Error('A valid MONGODB_DB is required.');
  const client=suppliedClient || new MongoClient(uri,{serverSelectionTimeoutMS:10000,connectTimeoutMS:10000,socketTimeoutMS:20000,maxPoolSize:10,appName:'DrManzarAPI'});
  try {
    await client.connect();
    const database=client.db(name), hello=await database.command({hello:1});
    if (!hello.setName && hello.msg!=='isdbgrid') throw new Error('MongoDB must be a replica set or sharded cluster for atomic payments and authentication.');
    for (const collection of COLLECTIONS) for (const [key,options] of indexes[collection] || []) await database.collection(collection).createIndex(key,options);
    for (const collection of ['sessions','tokens','mfa_challenges','download_links']) await database.collection(collection).createIndex({expires_on:1},{expireAfterSeconds:0});
    const scope=new AsyncLocalStorage();
    const options=extra=>({...extra,...(scope.getStore()?{session:scope.getStore()}:{})});
    const withExpiry=doc=>doc.expires_at!==undefined?{...doc,expires_on:new Date(doc.expires_at)}:doc;
    return {
      kind:'mongodb',client,database,
      one:(name,filter,extra={})=>database.collection(name).findOne(filter,options({projection:{_id:0},...extra})),
      many:(name,filter={},extra={})=>database.collection(name).find(filter,options({projection:{_id:0},...extra})).toArray(),
      count:(name,filter={})=>database.collection(name).countDocuments(filter,options()),
      insert:async(name,doc)=>{const row=withExpiry({...doc});await database.collection(name).insertOne(row,options());delete row._id;return row;},
      update:(name,filter,update,extra={})=>database.collection(name).updateOne(filter,update.$set?.expires_at!==undefined?{...update,$set:withExpiry(update.$set)}:update,options(extra)),
      updateMany:(name,filter,update)=>database.collection(name).updateMany(filter,update,options()),
      delete:(name,filter)=>database.collection(name).deleteMany(filter,options()),
      aggregate:(name,pipeline)=>database.collection(name).aggregate(pipeline,options()).toArray(),
      close:()=>suppliedClient?Promise.resolve():client.close(),
      async transaction(fn){
        if(scope.getStore())return fn();
        const session=client.startSession();
        try{return await session.withTransaction(()=>scope.run(session,fn),{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary',maxCommitTimeMS:10000,timeoutMS:20000});}
        finally{await session.endSession();}
      },
    };
  }catch(error){if(!suppliedClient)await client.close().catch(()=>{});throw error;}
}
export const transaction=(db,fn)=>db.transaction(fn);
