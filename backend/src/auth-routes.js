import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { token,digest,hashPassword,checkPassword,publicUser } from './security.js';
import * as schemas from './schemas.js';
import { createMfa } from './mfa.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const neutral={message:'If the address is eligible, an email will be sent.'};
export function installAuth(app,{db,config,sendMail,audit,limiter}){
  const cookieName='manzar_session';
  app.use(async(req,res,next)=>{
    req.requestId=randomUUID();res.set('X-Request-Id',req.requestId);
    if(req.path.startsWith('/api/v1/auth')||req.path.startsWith('/api/v1/users'))res.set('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin&&req.headers.origin!==config.origin)throw fail(403,'Origin not allowed');
    if(req.cookies[cookieName]){
      const session=await db.one('sessions',{token_hash:digest(req.cookies[cookieName]),expires_at:{$gt:Date.now()}});
      const user=session?await db.one('users',{id:session.user_id}):null;
      if(user&&!user.suspended){req.session=session;req.user=user;}
    }next();
  });
  const auth=(req,res,next)=>req.user?next():next(fail(401,'Sign in required'));
  const verified=(req,res,next)=>req.user?.verified?next():next(fail(403,'Verify your email first'));
  const csrf=(req,res,next)=>req.session&&req.get('x-csrf-token')===req.session.csrf?next():next(fail(403,'Invalid CSRF token'));
  const staff=(req,res,next)=>['owner','editor'].includes(req.user?.role)?next():next(fail(403,'Staff access required'));
  const owner=(req,res,next)=>req.user?.role==='owner'?next():next(fail(403,'Owner access required'));
  const staffMfa=async(req,res,next)=>req.session?.mfa_verified===1&&await db.one('mfa_secrets',{user_id:req.user.id})?next():next(fail(403,'Admin two-factor verification required. Sign in again.'));
  async function makeSession(user,previous,mfa=false){
    const sessionToken=token(),csrfToken=token();
    if(previous)await db.delete('sessions',{token_hash:previous});
    await db.delete('sessions',{expires_at:{$lte:Date.now()}});
    await db.insert('sessions',{token_hash:digest(sessionToken),user_id:user.id,csrf:csrfToken,expires_at:Date.now()+28800000,mfa_verified:Number(mfa)});
    return{sessionToken,user:publicUser(user),csrfToken};
  }
  function sendSession(res,{sessionToken,...data}){
    res.cookie(cookieName,sessionToken,{httpOnly:true,secure:config.production,sameSite:'lax',path:'/api',maxAge:28800000});res.json(data);
  }
  const mfa=createMfa({db,key:config.mfaKey,audit,makeSession,sendSession}),emailLimiter=limiter(5,3600000),loginLimiter=limiter(12),mfaLimiter=limiter(20),dummyHash=hashPassword(token());
  app.post('/api/v1/auth/mfa/setup',mfaLimiter,mfa.setup);app.post('/api/v1/auth/mfa/verify',mfaLimiter,mfa.verify);
  async function mailToken(user,purpose){
    const raw=token(),hash=digest(raw);
    await db.insert('tokens',{token_hash:hash,user_id:user.id,purpose,expires_at:Date.now()+(purpose==='verify'?86400000:1800000)});
    try{await sendMail({to:user.email,subject:purpose==='verify'?'Verify your email - Dr Manzar':'Reset your password - Dr Manzar',text:`${purpose==='verify'?'Verify your email':'Reset your password'}: ${config.origin}/${user.language}/${purpose==='verify'?'verify-email':'reset-password'}#token=${raw}\nIf you did not request this, ignore this email.`});}
    catch(error){await db.delete('tokens',{token_hash:hash});throw error;}
  }
  async function consume(raw,purpose,fn){
    return db.transaction(async()=>{
      const row=await db.one('tokens',{token_hash:digest(raw),purpose,expires_at:{$gt:Date.now()}});
      if(!row)throw fail(400,'Invalid or expired link');
      const user=await db.one('users',{id:row.user_id});if(!user||user.suspended)throw fail(403,'Account unavailable');
      await fn(user);await db.delete('tokens',{user_id:user.id,purpose});
    });
  }
  app.post('/api/v1/auth/register',emailLimiter,async(req,res)=>{
    const data=schemas.signup.parse(req.body),encoded=await hashPassword(data.password);
    if(!await db.one('users',{email:data.email})){
      const user={id:randomUUID(),email:data.email,name:data.name,password_hash:encoded,role:'reader',verified:0,suspended:0,language:data.language,profile:{},marketing:Number(data.marketingConsent),consent_at:data.marketingConsent?Date.now():null,terms_version:'1.1',created_at:Date.now()};
      try{await db.insert('users',user);}catch(error){if(error.code===11000)return res.status(202).json(neutral);throw error;}
      await mailToken(user,'verify');
    }res.status(202).json(neutral);
  });
  app.post('/api/v1/auth/resend-verification',emailLimiter,async(req,res)=>{
    const {email}=z.object({email:schemas.email}).strict().parse(req.body),user=await db.one('users',{email});
    if(user&&!user.verified&&!user.suspended)await mailToken(user,'verify');res.status(202).json(neutral);
  });
  app.post('/api/v1/auth/verify-email',limiter(20),async(req,res)=>{
    const {token:raw}=z.object({token:z.string().length(64)}).strict().parse(req.body);
    await consume(raw,'verify',user=>db.update('users',{id:user.id},{$set:{verified:1}}));res.json({message:'Email verified. You can now sign in.'});
  });
  app.post('/api/v1/auth/login',loginLimiter,async(req,res)=>{
    const data=z.object({email:schemas.email,password:z.string().min(1).max(128)}).strict().parse(req.body),user=await db.one('users',{email:data.email});
    const correct=await checkPassword(data.password,user?.password_hash||await dummyHash);
    if(!user||!correct||user.suspended)throw fail(401,'Invalid credentials');if(!user.verified)throw fail(403,'Verify your email first');
    if(['owner','editor'].includes(user.role))return res.status(202).json(await mfa.begin(user));
    const result=await db.transaction(async()=>{
      const current=await db.one('users',{id:user.id});
      if(!current||current.suspended||!current.verified||current.password_hash!==user.password_hash)throw fail(401,'Credentials changed. Sign in again.');
      await db.update('users',{id:user.id},{$inc:{auth_serial:1}});
      return makeSession(current,req.session?.token_hash);
    });sendSession(res,result);
  });
  app.get('/api/v1/auth/me',auth,(req,res)=>res.json({user:publicUser(req.user),csrfToken:req.session.csrf}));
  app.post('/api/v1/auth/logout',auth,csrf,async(req,res)=>{await db.delete('sessions',{token_hash:req.session.token_hash});res.clearCookie(cookieName,{path:'/api',httpOnly:true,secure:config.production,sameSite:'lax'});res.status(204).end();});
  app.post('/api/v1/auth/forgot-password',emailLimiter,async(req,res)=>{const {email}=z.object({email:schemas.email}).strict().parse(req.body),user=await db.one('users',{email});if(user&&!user.suspended)await mailToken(user,'reset');res.status(202).json(neutral);});
  app.post('/api/v1/auth/reset-password',limiter(10),async(req,res)=>{
    const data=z.object({token:z.string().length(64),password:schemas.password}).strict().parse(req.body),encoded=await hashPassword(data.password);
    await consume(data.token,'reset',async user=>{await db.update('users',{id:user.id},{$set:{password_hash:encoded}});await db.delete('sessions',{user_id:user.id});await db.delete('mfa_challenges',{user_id:user.id});});res.json({message:'Password updated. Sign in again.'});
  });
  app.patch('/api/v1/users/me',auth,csrf,async(req,res)=>{
    const data=schemas.profile.parse(req.body);
    await db.transaction(async()=>{
      const user=await db.one('users',{id:req.user.id});
      await db.update('users',{id:user.id},{$set:{name:data.name??user.name,language:data.language??user.language,profile:{...user.profile,...data.profile},marketing:data.marketingConsent===undefined?user.marketing:Number(data.marketingConsent),consent_at:data.marketingConsent===undefined?user.consent_at:Date.now()}});
    });res.json({user:publicUser(await db.one('users',{id:req.user.id}))});
  });
  return{auth,verified,csrf,staff,owner,staffMfa};
}
