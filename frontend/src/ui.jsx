import React, { createContext, useContext, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, BookOpen, Menu, X, UserRound, Headphones, LogOut } from 'lucide-react';
import { useApp } from './context';
import { api, safeMedia } from './api';

const Language = createContext('en');
export const useLang = () => useContext(Language);
export const useText = () => { const lang = useLang(); return (en, ur) => lang === 'ur' ? ur : en; };
export const choose = (item, lang) => item?.translations?.[lang] || item?.translations?.en || item?.translations?.ur;
export function LocalLink({ to = '', ...props }) { const lang = useLang(); return <Link to={`/${lang}/${to}`.replace(/\/$/, '')} {...props} />; }
export function Layout({ lang, children }) {
  const location = useLocation(), navigate = useNavigate(), { user, online, logout } = useApp();
  const [menu, setMenu] = useState(false), [error, setError] = useState('');
  const t = (en, ur) => lang === 'ur' ? ur : en;
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr'; localStorage.setItem('manzar-language', lang); setMenu(false); window.scrollTo(0, 0); }, [lang, location.pathname]);
  const switchLanguage = () => navigate(location.pathname.replace(/^\/(en|ur)/, lang === 'en' ? '/ur' : '/en') + location.search + location.hash);
  const links = [['books', 'Books', 'کتابیں'], ['articles', 'Articles', 'مضامین'], ['videos', 'Vlogs', 'ویڈیوز'], ['about', 'About', 'تعارف'], ['contact', 'Contact', 'رابطہ']];
  return <Language.Provider value={lang}><a className="skip" href="#main">{t('Skip to content', 'مواد پر جائیں')}</a>
    <header className="site-header wrap">
      <LocalLink className="wordmark" aria-label={t('Home', 'صفحۂ اول')}><span>DR. MANZAR</span><small>{t('UL HAQUE · LITERARY WORKS', 'الحق ۔ ادبی تخلیقات')}</small></LocalLink>
      <button className="icon-button mobile-menu" aria-label={t('Toggle navigation', 'مینو کھولیں')} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={22}/> : <Menu size={22}/>}</button>
      <nav className={menu ? 'main-nav open' : 'main-nav'} aria-label={t('Main navigation', 'مرکزی مینو')}>{links.map(([path, en, ur]) => <LocalLink key={path} to={path} className={location.pathname.includes('/' + path) ? 'active' : ''}>{t(en, ur)}</LocalLink>)}</nav>
      <div className="header-actions"><button className="language-switch" onClick={switchLanguage}>{lang === 'en' ? 'اردو' : 'English'}</button><span className="header-line"/>
        {user && <LocalLink to="library" className="small-link">{t('My library', 'میری لائبریری')}</LocalLink>}
        <LocalLink className="account-link" to={user ? 'account' : 'sign-in'}><UserRound size={18}/><span>{user ? t('Account', 'اکاؤنٹ') : t('Sign in', 'سائن اِن')}</span></LocalLink>
        {['owner', 'editor'].includes(user?.role) && <LocalLink to="admin" className="small-link">{t('Admin', 'انتظامیہ')}</LocalLink>}
      </div>
    </header>
    <main id="main">{children}</main>
    <footer className="site-footer"><div className="wrap footer-inner"><div><LocalLink className="footer-brand">{t('Dr. Manzar ul Haque', 'ڈاکٹر منظر الحق')}</LocalLink><p>{t('A life observed. A world in words.', 'زندگی کا مشاہدہ، لفظوں کی دنیا۔')}</p><small>© {new Date().getFullYear()} {t('All rights reserved.', 'جملہ حقوق محفوظ ہیں۔')}</small></div><div className="footer-links"><LocalLink to="about">{t('About the author', 'مصنف کا تعارف')}</LocalLink><LocalLink to="contact">{t('Media & speaking', 'میڈیا اور ادبی نشستیں')}</LocalLink><LocalLink to="contact">{t('Contact', 'رابطہ')}</LocalLink>{user && <button className="text-button" onClick={async () => { try { await logout(); navigate(`/${lang}`); } catch (e) { setError(e.message); } }}><LogOut size={15}/>{t('Sign out', 'سائن آؤٹ')}</button>}</div></div>
      <div className="local-strip wrap"><span><i className={online ? 'status-dot' : 'status-dot offline'}/>{online === null ? t('Checking connection…', 'رابطہ چیک ہو رہا ہے…') : online ? t('Local preview · API connected', 'مقامی پیش منظر ۔ API منسلک') : t('Local preview · API offline', 'مقامی پیش منظر ۔ API دستیاب نہیں')}</span><span>{t('Author imagery and editorial copy await approval.', 'مصنف کی تصاویر اور تحریری مواد کی منظوری باقی ہے۔')}</span></div><ErrorMessage error={error}/>
    </footer></Language.Provider>;
}
export function ErrorMessage({ error }) { return error ? <div className="notice error" role="alert">{error}</div> : null; }
export function Notice({ children }) { return <div className="notice" role="status">{children}</div>; }
export function Empty({ title, children }) { return <div className="empty"><BookOpen size={30} strokeWidth={1.2}/><h3>{title}</h3><p>{children}</p></div>; }
export function Loading() { const t = useText(); return <div className="loading" role="status"><span className="spinner"/>{t('Loading…', 'لوڈ ہو رہا ہے…')}</div>; }
export function Arrow({ size = 18 }) { return <ArrowUpRight size={size} className="arrow"/>; }
export function useApiData(path, refresh = 0) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError(''); setData(null);
    api(path, { signal: controller.signal }).then(setData).catch(e => { if (e.name !== 'AbortError') setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, refresh]); return { data, error, loading };
}
export function Cover({ item, index = 0, placeholder = false }) {
  const lang = useLang(), t = useText(), v = choose(item, lang), url = safeMedia(item?.coverUrl);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  return <div className={`book-cover cover-${index % 5}`}>
    {url && !broken ? <img src={url} alt={v?.title || ''} onError={() => setBroken(true)}/> : <><div className="cover-rule"/><span className="cover-author">{t('DR. MANZAR UL HAQUE', 'ڈاکٹر منظر الحق')}</span><div className="cover-emblem">م</div><div className="cover-bottom"><strong>{v?.title || t(`Book ${index + 1}`, `کتاب ${index + 1}`)}</strong><small>{placeholder ? t('COVER PLACEHOLDER', 'سرورق کا نمونہ') : t('LITERARY WORKS', 'ادبی تخلیقات')}</small></div></>}
  </div>;
}
export function AudioPlayer({ url, language }) {
  const t = useText(), src = safeMedia(url); const [open, setOpen] = useState(false), [error, setError] = useState('');
  useEffect(() => { setOpen(false); setError(''); }, [src, language]);
  if (!src) return <span className="audio-unavailable"><Headphones size={17}/>{t('Narration not available yet', 'آواز ابھی دستیاب نہیں')}</span>;
  return <div className="audio-block"><button className="button secondary" onClick={() => setOpen(!open)} aria-expanded={open}><Headphones size={18}/>{t('Listen to this page', 'یہ صفحہ سنیں')}</button>{open && <div className="audio-controls"><audio key={src + language} src={src} controls preload="metadata" onError={() => setError(t('Recording could not be loaded.', 'آڈیو لوڈ نہیں ہو سکی۔'))}/><label>{t('Speed', 'رفتار')}<select defaultValue="1" onChange={e => { const audio = e.currentTarget.closest('.audio-controls').querySelector('audio'); audio.playbackRate = Number(e.target.value); }}><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label></div>}<ErrorMessage error={error}/></div>;
}
