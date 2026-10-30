import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { token,digest } from './security.js';
import { newSecret,seal,unseal,verifyTotp } from './totp.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const challengeSchema=z.string().regex(/^[a-f0-9]{64}$/);
export function createMfa({db,key,audit,makeSession,sendSession}){
  if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('A 32-byte MFA key is required');
  async function checkLock(userId){
    const state=await db.one('mfa_attempts',{user_id:userId});
    if(state?.locked_until>Date.now())throw fail(429,'Too many two-factor attempts. Try again in 15 minutes.');
  }
  async function challenge(raw){
    const row=await db.one('mfa_challenges',{token_hash:digest(raw),expires_at:{$gt:Date.now()}});
    if(!row)throw fail(401,'Invalid or expired two-factor challenge. Sign in again.');
    const user=await db.one('users',{id:row.user_id});
    if(!user||user.suspended||!user.verified||!['owner','editor'].includes(user.role))throw fail(401,'Account unavailable');
    await checkLock(user.id);return{row,user};
  }
  async function begin(user){
    return db.transaction(async()=>{
      const current=await db.one('users',{id:user.id});
      if(!current||current.suspended||!current.verified||current.password_hash!==user.password_hash)throw fail(401,'Credentials changed. Sign in again.');
      await db.update('users',{id:user.id},{$inc:{auth_serial:1}});
      await db.update('mfa_attempts',{user_id:user.id},{$inc:{serial:1},$setOnInsert:{failures:0,locked_until:0}},{upsert:true});
      await checkLock(user.id);
      const mode=await db.one('mfa_secrets',{user_id:user.id})?'login':'setup',raw=token();
      await db.delete('mfa_challenges',{$or:[{user_id:user.id},{expires_at:{$lte:Date.now()}}]});
      await db.insert('mfa_challenges',{token_hash:digest(raw),user_id:user.id,mode,encrypted_secret:null,expires_at:Date.now()+300000});
      return{mfaRequired:true,setupRequired:mode==='setup',challenge:raw,expiresIn:300};
    });
  }
  async function setup(req,res){
    const {challenge:raw}=z.object({challenge:challengeSchema}).strict().parse(req.body);
    const data=await db.transaction(async()=>{
      const {row,user}=await challenge(raw);
      if(row.mode!=='setup'||await db.one('mfa_secrets',{user_id:user.id}))throw fail(409,'Two-factor authentication is already enabled');
      const secret=row.encrypted_secret?unseal(row.encrypted_secret,key,user.id):newSecret();
      await db.update('mfa_challenges',{token_hash:row.token_hash},{$set:{encrypted_secret:seal(secret,key,user.id)}});
      return{secret,otpauthUri:`otpauth://totp/${encodeURIComponent(`Dr Manzar:${user.email}`)}?secret=${secret}&issuer=Dr%20Manzar&algorithm=SHA1&digits=6&period=30`};
    });res.json(data);
  }
  async function verify(req,res){
    const {challenge:raw,code}=z.object({challenge:challengeSchema,code:z.string().min(6).max(40)}).strict().parse(req.body);
    const result=await db.transaction(async()=>{
      const first=await challenge(raw);
      await db.update('mfa_attempts',{user_id:first.user.id},{$inc:{serial:1},$setOnInsert:{failures:0,locked_until:0}},{upsert:true});
      const {row,user}=await challenge(raw),enabled=await db.one('mfa_secrets',{user_id:user.id});
      let accepted=false,usedRecovery=false,step=null,recoveryCodes;
      if(row.mode==='setup'){
        if(enabled||!row.encrypted_secret)throw fail(409,'Start authenticator setup first');
        step=verifyTotp(unseal(row.encrypted_secret,key,user.id),code);accepted=step!==null;
      }else if(enabled){
        step=verifyTotp(unseal(enabled.encrypted_secret,key,user.id),code,enabled.last_step);accepted=step!==null;
        if(!accepted&&/^[a-f0-9]{8}(?:-[a-f0-9]{8}){2}$/i.test(code)){
          accepted=Boolean((await db.delete('mfa_recovery',{user_id:user.id,code_hash:digest(code.toLowerCase())})).deletedCount);usedRecovery=accepted;
        }
      }
      if(!accepted){
        const state=await db.one('mfa_attempts',{user_id:user.id});
        const failures=(state?.locked_until>0&&state.locked_until<=Date.now()?0:state?.failures||0)+1;
        await db.update('mfa_attempts',{user_id:user.id},{$set:{failures,locked_until:failures>=5?Date.now()+900000:0}});
        await audit(user.id,'mfa.failed',user.id);return null;
      }
      if(row.mode==='setup'){
        await db.insert('mfa_secrets',{user_id:user.id,encrypted_secret:row.encrypted_secret,last_step:step,enabled_at:Date.now()});
        recoveryCodes=Array.from({length:10},()=>randomBytes(12).toString('hex').match(/.{8}/g).join('-'));
        for(const value of recoveryCodes)await db.insert('mfa_recovery',{code_hash:digest(value),user_id:user.id});
        await db.delete('sessions',{user_id:user.id});await audit(user.id,'mfa.enabled',user.id);
      }else if(!usedRecovery)await db.update('mfa_secrets',{user_id:user.id},{$set:{last_step:step}});
      await db.update('mfa_attempts',{user_id:user.id},{$set:{failures:0,locked_until:0}});
      await db.delete('mfa_challenges',{user_id:user.id});
      await audit(user.id,usedRecovery?'mfa.recovery.used':'mfa.verified',user.id);
      return{...(await makeSession(user,req.session?.token_hash,true)),...(recoveryCodes?{recoveryCodes}:{})};
    });
    if(!result)throw fail(401,'Invalid or already-used two-factor code');
    sendSession(res,result);
  }
  return{begin,setup,verify};
}
