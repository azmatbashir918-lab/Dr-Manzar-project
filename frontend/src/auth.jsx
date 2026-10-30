import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { KeyRound, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { api } from './api';
import { useApp } from './context';
import { useLang, useText, LocalLink, ErrorMessage, Notice, Arrow } from './ui';

export function AuthPage({ mode }) {
  const t = useText(), lang = useLang(), navigate = useNavigate(), location = useLocation(), { acceptSession } = useApp();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [challenge, setChallenge] = useState(null), [setup, setSetup] = useState(null), [qr, setQr] = useState(''), [recovery, setRecovery] = useState(null);
  const next = new URLSearchParams(location.search).get('next');
  const destination = next?.startsWith(`/${lang}/`) && !next.startsWith('//') ? next : `/${lang}/account`;
  useEffect(() => { if (setup?.otpauthUri) QRCode.toDataURL(setup.otpauthUri, { margin: 2, width: 220 }).then(setQr).catch(() => setQr('')); }, [setup]);
  async function submit(e) {
    e.preventDefault(); const values = Object.fromEntries(new FormData(e.currentTarget)); setError(''); setMessage(''); setBusy(true);
    try {
      if (challenge) {
        const result = await api('/auth/mfa/verify', { method: 'POST', body: { challenge: challenge.challenge, code: values.code.trim() } });
        acceptSession(result); setSetup(null); setQr('');
        if (result.recoveryCodes) setRecovery(result.recoveryCodes); else navigate(destination);
      } else if (mode === 'login') {
        const result = await api('/auth/login', { method: 'POST', body: { email: values.email, password: values.password } });
        if (result.mfaRequired) {
          setChallenge(result);
          if (result.setupRequired) setSetup(await api('/auth/mfa/setup', { method: 'POST', body: { challenge: result.challenge } }));
        } else { acceptSession(result); navigate(destination); }
      } else if (mode === 'register') {
        if (values.password !== values.confirmPassword) throw new Error(t('Passwords do not match.', 'پاس ورڈ یکساں نہیں۔'));
        await api('/auth/register', { method: 'POST', body: { name: values.name, email: values.email, password: values.password,
          language: lang, acceptTerms: values.acceptTerms === 'on', marketingConsent: values.marketing === 'on' } });
        setMessage(t('If this address is eligible, a verification email has been sent. Verify your email before signing in.', 'اگر یہ ای میل اہل ہے تو تصدیقی پیغام بھیج دیا گیا ہے۔ سائن اِن سے پہلے ای میل کی تصدیق کریں۔'));
      } else { await api('/auth/forgot-password', { method: 'POST', body: { email: values.email } }); setMessage(t('If this address has an account, a reset email has been sent.', 'اگر اس ای میل پر اکاؤنٹ موجود ہے تو پاس ورڈ تبدیل کرنے کا پیغام بھیج دیا گیا ہے۔')); }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function resend(e) {
    e.preventDefault(); const email = new FormData(e.currentTarget).get('email'); setBusy(true); setError('');
    try { await api('/auth/resend-verification', { method: 'POST', body: { email } }); setMessage(t('If eligible, a new verification email has been sent.', 'اہلیت کی صورت میں نیا تصدیقی پیغام بھیج دیا گیا ہے۔')); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="auth-section wrap"><div className="auth-aside"><p className="eyebrow">{t('THE READER’S CIRCLE', 'قارئین کا حلقہ')}</p><h1>{t(<>A place for<br/>your next chapter.</>, <>آپ کے اگلے باب<br/>کے لیے ایک جگہ۔</>)}</h1><p>{t('Keep your reading preferences and book orders together in your own reader space.', 'اپنی پسند اور کتابوں کے آرڈر ایک ذاتی اکاؤنٹ میں محفوظ رکھیں۔')}</p><div className="auth-ornament">م</div><LocalLink to="books" className="text-link">{t('Explore the bookshelf', 'کتابیں دیکھیں')}<Arrow/></LocalLink></div>
    <div className="auth-card">{recovery ? <><ShieldCheck size={32}/><h2>{t('Save your recovery codes', 'بازیابی کے کوڈ محفوظ کریں')}</h2><Notice>{t('Shown once. Keep these offline and private; each works once if your authenticator is unavailable.', 'یہ کوڈ صرف ایک بار دکھائے جاتے ہیں۔ انہیں محفوظ رکھیں؛ ہر کوڈ ایک بار استعمال ہو سکتا ہے۔')}</Notice><div className="recovery-codes" dir="ltr">{recovery.map(code => <code key={code}>{code}</code>)}</div><button className="button" onClick={() => { setRecovery(null); navigate(destination); }}>{t('I have saved my codes', 'میں نے کوڈ محفوظ کر لیے ہیں')}</button></> : <>
      <div className="auth-icon">{challenge ? <ShieldCheck size={25}/> : <KeyRound size={25}/>}</div><h2>{challenge ? t(challenge.setupRequired ? 'Set up your authenticator' : 'Two-factor verification', challenge.setupRequired ? 'تصدیقی ایپ ترتیب دیں' : 'دو مرحلوں کی تصدیق') : t(mode === 'register' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : 'Welcome back', mode === 'register' ? 'اپنا اکاؤنٹ بنائیں' : mode === 'forgot' ? 'پاس ورڈ کی بازیابی' : 'خوش آمدید')}</h2><p className="muted">{challenge ? t('Staff access requires a second verification step.', 'منتظم کے لیے دوسرے مرحلے کی تصدیق ضروری ہے۔') : t('Your literary world, a little closer.', 'آپ کی ادبی دنیا، کچھ اور قریب۔')}</p>
      <ErrorMessage error={error}/>{message && <Notice>{message}</Notice>}
      {setup && <div className="authenticator-setup">{qr && <img src={qr} alt={t('Authenticator setup QR code', 'تصدیقی ایپ کا کیو آر کوڈ')} width="220" height="220"/>}<p>{t('Scan in your authenticator app, or enter this key manually:', 'تصدیقی ایپ میں اسکین کریں یا یہ کلید درج کریں:')}</p><code className="secret-key" dir="ltr">{setup.secret}</code></div>}
      <form onSubmit={submit} className="stack-form">{challenge ? <label>{t('Authenticator or recovery code', 'تصدیقی یا بازیابی کا کوڈ')}<input name="code" autoComplete="one-time-code" autoFocus required maxLength={40} dir="ltr"/></label> : <>
        {mode === 'register' && <label>{t('Your name', 'آپ کا نام')}<input name="name" required autoComplete="name" maxLength={120}/></label>}
        <label>{t('Email address', 'ای میل')}<input name="email" type="email" required autoComplete="email" maxLength={254}/></label>
        {mode !== 'forgot' && <label>{t('Password', 'پاس ورڈ')}<input name="password" type="password" required minLength={mode === 'register' ? 12 : 1} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'}/>{mode === 'register' && <small>{t('Use at least 12 characters.', 'کم از کم ۱۲ حروف استعمال کریں۔')}</small>}</label>}
        {mode === 'register' && <><label>{t('Confirm password', 'پاس ورڈ دوبارہ درج کریں')}<input name="confirmPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label><label className="checkbox"><input name="acceptTerms" type="checkbox" required/>{t('I agree to the local testing terms and privacy notice below.', 'میں نیچے دی گئی مقامی جانچ کی شرائط اور رازداری کی اطلاع سے اتفاق کرتا ہوں۔')}</label><details className="terms-note"><summary>{t('Testing terms & privacy notice', 'جانچ کی شرائط اور رازداری')}</summary><p>{t('Local development only. Your name, email, preferences and consent are stored in the local database. Verification mail is written to the backend data/mail folder unless SMTP is configured. Do not use sensitive personal information. This is not the final legal policy for launch.', 'یہ مقامی ترقیاتی نسخہ ہے۔ نام، ای میل، پسند اور رضامندی مقامی ڈیٹابیس میں محفوظ ہوتی ہے۔ SMTP نہ ہونے پر تصدیقی ای میل backend کے data/mail فولڈر میں لکھی جاتی ہے۔ حساس ذاتی معلومات استعمال نہ کریں۔ اجرا کے لیے حتمی قانونی پالیسی ابھی باقی ہے۔')}</p></details><label className="checkbox"><input name="marketing" type="checkbox"/>{t('Send me literary updates by email (optional).', 'مجھے ای میل پر ادبی خبریں بھیجیں (اختیاری)۔')}</label></>}
      </>}<button className="button full" disabled={busy}>{busy ? t('Please wait…', 'انتظار کریں…') : challenge ? t('Verify & continue', 'تصدیق کریں') : t(mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Sign in', mode === 'register' ? 'اکاؤنٹ بنائیں' : mode === 'forgot' ? 'بازیابی کا لنک بھیجیں' : 'سائن اِن')}<Arrow/></button></form>
      {challenge ? <button className="text-button auth-bottom" onClick={() => { setChallenge(null); setSetup(null); setQr(''); setError(''); }}>{t('Start sign-in again', 'دوبارہ سائن اِن کریں')}</button> : <div className="auth-bottom">{mode === 'login' ? <><LocalLink to="forgot-password">{t('Forgot password?', 'پاس ورڈ بھول گئے؟')}</LocalLink><p>{t('New here? ', 'نئے صارف؟ ')}<LocalLink to="sign-up">{t('Create an account', 'اکاؤنٹ بنائیں')}</LocalLink></p></> : <LocalLink to="sign-in">{t('Already registered? Sign in', 'اکاؤنٹ موجود ہے؟ سائن اِن کریں')}</LocalLink>}</div>}
      {!challenge && <details className="resend"><summary>{t('Need another verification email?', 'نئی تصدیقی ای میل چاہیے؟')}</summary><form onSubmit={resend} className="stack-form"><label>{t('Email address', 'ای میل')}<input name="email" type="email" required/></label><button className="button secondary" disabled={busy}>{t('Resend verification', 'تصدیقی پیغام دوبارہ بھیجیں')}</button></form></details>}
    </>}</div></section>;
}
export function EmailAction({ mode }) {
  const t = useText(), location = useLocation();
  const [value, setValue] = useState(new URLSearchParams(location.hash.slice(1)).get('token') || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  useEffect(() => { const token = new URLSearchParams(location.hash.slice(1)).get('token'); if (token) { setValue(token); window.history.replaceState(null, '', location.pathname); } }, [location.pathname, location.hash]);
  return <section className="wrap page-section narrow"><div className="form-card"><ShieldCheck size={30}/><h1>{t(mode === 'verify' ? 'Verify your email' : 'Choose a new password', mode === 'verify' ? 'ای میل کی تصدیق' : 'نیا پاس ورڈ منتخب کریں')}</h1><ErrorMessage error={error}/>{done ? <><Notice>{t(mode === 'verify' ? 'Email verified. You can sign in now.' : 'Password updated. Sign in again.', mode === 'verify' ? 'ای میل کی تصدیق ہو گئی۔ اب سائن اِن کریں۔' : 'پاس ورڈ تبدیل ہو گیا۔ دوبارہ سائن اِن کریں۔')}</Notice><LocalLink className="button" to="sign-in">{t('Sign in', 'سائن اِن')}</LocalLink></> : <form className="stack-form" onSubmit={async e => { e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError(''); try { if (mode === 'reset' && form.get('password') !== form.get('confirm')) throw new Error(t('Passwords do not match.', 'پاس ورڈ یکساں نہیں۔')); await api(`/auth/${mode === 'verify' ? 'verify-email' : 'reset-password'}`, { method: 'POST', body: { token: value, ...(mode === 'reset' ? { password: form.get('password') } : {}) } }); setDone(true); setValue(''); } catch (e) { setError(e.message); } finally { setBusy(false); } }}><label>{t('Verification token from your email', 'ای میل میں موصول ہونے والا کوڈ')}<input value={value} onChange={e => setValue(e.target.value)} type="password" required minLength={64} maxLength={64} autoComplete="off"/></label>{mode === 'reset' && <><label>{t('New password', 'نیا پاس ورڈ')}<input type="password" name="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label><label>{t('Confirm new password', 'نیا پاس ورڈ دوبارہ درج کریں')}<input type="password" name="confirm" required minLength={12} maxLength={128} autoComplete="new-password"/></label></>}<button className="button" disabled={busy}>{t('Confirm', 'تصدیق کریں')}</button></form>}</div></section>;
}
