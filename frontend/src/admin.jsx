import React, { useEffect, useRef, useState } from 'react';
import { Plus, BookOpen, FileText, Video, Layers, Users, MessageSquare, ShoppingBag, Upload, Eye, Save, History, X, CheckCircle2, LayoutDashboard } from 'lucide-react';
import { api, safeMedia } from './api';
import { useApp } from './context';
import { useLang, useText, LocalLink, choose, useApiData, ErrorMessage, Notice, Loading, Empty } from './ui';
import { ContentBody } from './pages';

const blank = () => ({ slug: '', status: 'draft', category: '', digitalAvailable: false,
  translations: { en: { title: '', summary: '', body: '', audioUrl: '' }, ur: { title: '', summary: '', body: '', audioUrl: '' } } });
function payload(item) {
  const { id, kind, createdAt, updatedAt, ...data } = item;
  return { ...data, translations: { ...blank().translations, ...data.translations } };
}
function clean(form) {
  const data = structuredClone(form);
  data.status = 'draft';
  for (const lang of ['en', 'ur']) {
    const v = data.translations[lang];
    if (!v.title.trim()) { delete data.translations[lang]; continue; }
    if (!v.audioUrl) delete v.audioUrl;
  }
  for (const key of ['coverUrl', 'videoUrl', 'publicationYear', 'priceMinor', 'currency']) if (data[key] === '' || data[key] == null) delete data[key];
  return data;
}
export function Admin() {
  const t = useText(), lang = useLang(), { user, authLoading } = useApp();
  if (authLoading) return <Loading/>;
  if (!user) return <section className="wrap page-section narrow"><h1>{t('Author workspace', 'مصنف کی ورک اسپیس')}</h1><p className="lead">{t('Sign in with a staff account to manage the website.', 'ویب سائٹ کا انتظام کرنے کے لیے منتظم کے اکاؤنٹ سے سائن اِن کریں۔')}</p><LocalLink className="button" to={`sign-in?next=/${lang}/admin`}>{t('Staff sign in', 'منتظم سائن اِن')}</LocalLink><details className="setup-guide"><summary>{t('First local admin account', 'پہلا مقامی منتظم اکاؤنٹ')}</summary><p>{t('From the project folder, run npm.cmd run setup:admin in a terminal. Enter your name, email and a password when prompted. The password is hidden as you type. Public registration always creates a reader.', 'پروجیکٹ کے فولڈر میں ٹرمینل کھول کر npm.cmd run setup:admin چلائیں۔ اپنا نام، ای میل اور پاس ورڈ درج کریں۔ پاس ورڈ نظر نہیں آئے گا۔ عام رجسٹریشن صرف قاری کا اکاؤنٹ بناتی ہے۔')}</p></details></section>;
  if (!['owner', 'editor'].includes(user.role)) return <section className="wrap page-section narrow"><Empty title={t('Staff access required', 'منتظم کی اجازت درکار ہے')}>{t('Your account is a reader account. Admin access is not granted through public registration.', 'آپ کا اکاؤنٹ قاری کا ہے۔ عام رجسٹریشن سے انتظامی رسائی نہیں ملتی۔')}</Empty><LocalLink className="button" to="account">{t('My account', 'میرا اکاؤنٹ')}</LocalLink></section>;
  return <Workspace user={user}/>;
}
function Workspace({ user }) {
  const t = useText(), lang = useLang(), [tab, setTab] = useState('books'), [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState(null), [form, setForm] = useState(blank()), [editLang, setEditLang] = useState(lang);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [preview, setPreview] = useState(null), [revisions, setRevisions] = useState(null), [files, setFiles] = useState([]);
  const contentTab = ['books', 'articles', 'pages', 'videos'].includes(tab);
  const path = contentTab ? `/admin/content/${tab}?limit=100` : `/admin/${tab}?limit=100`;
  const list = useApiData(path, refresh);
  const dialog = useRef(null);
  useEffect(() => { setSelected(null); setForm(blank()); setError(''); setMessage(''); setFiles([]); }, [tab]);
  useEffect(() => { if (preview && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [preview]);
  function pick(item) { setSelected(item.id); setForm(payload(item)); setError(''); setMessage(''); setRevisions(null); setFiles([]); if (tab === 'books') api(`/admin/books/${item.id}/files`).then(r => setFiles(r.items)).catch(e => setError(e.message)); }
  const update = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const editTranslation = (key, value) => setForm(f => ({ ...f, translations: { ...f.translations, [editLang]: { ...f.translations[editLang], [key]: value } } }));
  async function run(task) { setBusy(true); setError(''); setMessage(''); try { await task(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function save() {
    const result = await api(selected ? `/admin/content/${selected}` : `/admin/content/${tab}`, { method: selected ? 'PUT' : 'POST', body: clean(form) });
    setSelected(result.item.id); setForm(payload(result.item)); setRefresh(n => n + 1); setMessage(t('Draft saved. Preview before publishing.', 'مسودہ محفوظ ہو گیا۔ شائع کرنے سے پہلے پیش منظر دیکھیں۔')); return result.item;
  }
  async function uploadFile(e, type) {
    const chosenFile = e.target.files?.[0]; e.target.value = ''; if (!chosenFile) return;
    await run(async () => {
      const body = new FormData(); body.append(type === 'cover' ? 'cover' : type === 'audio' ? 'audio' : 'document', chosenFile);
      const route = type === 'cover' ? '/admin/uploads/covers' : type === 'audio' ? `/admin/uploads/narration/${editLang}` : `/admin/books/${selected}/files/${editLang}`;
      const result = await api(route, { method: 'POST', body });
      if (type === 'cover') update('coverUrl', result.cover.url);
      if (type === 'audio') editTranslation('audioUrl', result.audio.url);
      if (type === 'document') { setFiles(prev => [result.file, ...prev]); setForm(f => ({ ...f, digitalFileIds: { ...f.digitalFileIds, [editLang]: result.file.id } })); }
      setMessage(t('Upload complete. Save the draft to attach it.', 'فائل اپ لوڈ ہو گئی۔ اسے منسلک کرنے کے لیے مسودہ محفوظ کریں۔'));
    });
  }
  async function publishAction(action) {
    if (!selected) return;
    if (action === 'publish') await save();
    const result = await api(`/admin/content/${selected}/${action}`, { method: 'POST', body: {} });
    setForm(payload(result.item)); setRefresh(n => n + 1); setMessage(action === 'publish' ? t('Published. The live website is updated.', 'شائع ہو گیا۔ ویب سائٹ پر مواد اپ ڈیٹ ہو گیا ہے۔') : t('Unpublished. A draft is retained.', 'اشاعت ختم کر دی گئی۔ مسودہ محفوظ ہے۔'));
  }
  const nav = [ ['books', BookOpen, 'Books', 'کتابیں'], ['articles', FileText, 'Articles', 'مضامین'], ['pages', Layers, 'Pages', 'صفحات'], ['videos', Video, 'Videos', 'ویڈیوز'], ['enquiries', MessageSquare, 'Enquiries', 'پیغامات'], ...(user.role === 'owner' ? [['users', Users, 'Readers', 'قارئین'], ['orders', ShoppingBag, 'Orders', 'آرڈر']] : []) ];
  return <section className="admin-shell"><aside className="admin-sidebar"><div className="workspace-title"><LayoutDashboard size={20}/><span>{t('Author workspace', 'مصنف کی ورک اسپیس')}</span></div><p>{user.name}<small>{user.role}</small></p><nav aria-label={t('Admin sections', 'انتظامی حصے')}>{nav.map(([key, Icon, en, ur]) => <button className={tab === key ? 'selected' : ''} key={key} disabled={busy} onClick={() => setTab(key)}><Icon size={18}/>{t(en, ur)}</button>)}</nav><div className="workspace-help"><ShieldNote t={t}/></div></aside>
    <div className="admin-main"><div className="admin-top"><div><p className="eyebrow">{t('MANAGE YOUR LITERARY WORLD', 'اپنی ادبی دنیا کا انتظام کریں')}</p><h1>{t(...nav.find(n => n[0] === tab).slice(2))}</h1></div>{contentTab && <button className="button" disabled={busy} onClick={() => { setSelected(null); setForm(blank()); setError(''); setMessage(''); setFiles([]); setRevisions(null); }}><Plus size={18}/>{t('New entry', 'نیا اندراج')}</button>}</div><ErrorMessage error={list.error || error}/>{message && <Notice>{message}</Notice>}
      {list.loading && <Loading/>}
      {contentTab ? <div className="admin-content-grid"><div className="entry-list"><div className="list-label">{t('ENTRIES', 'اندراجات')} <span>{list.data?.items?.length || 0}</span></div>{list.data?.items?.length ? list.data.items.map(item => <button key={item.id} className={selected === item.id ? 'entry selected' : 'entry'} disabled={busy} onClick={() => pick(item)}><strong>{choose(item, lang)?.title || item.slug}</strong><span><small>{item.slug}</small><em className={`badge ${item.status}`}>{item.status}</em></span></button>) : <p className="muted list-empty">{t('No entries yet. Create the first draft.', 'ابھی کوئی اندراج نہیں۔ پہلا مسودہ بنائیں۔')}</p>}</div>
        <form className="editor" onSubmit={e => { e.preventDefault(); run(save); }}><div className="editor-heading"><h2>{selected ? t('Edit entry', 'اندراج میں ترمیم') : t('New draft', 'نیا مسودہ')}</h2><span className={`badge ${form.status}`}>{form.status}</span></div><div className="two-fields"><label>{t('Page slug', 'صفحے کا سلگ')}<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.slug} placeholder="my-first-book" onChange={e => update('slug', e.target.value)} dir="ltr" maxLength={120}/></label><label>{t('Category', 'موضوع')}<input value={form.category || ''} onChange={e => update('category', e.target.value)} maxLength={80}/></label></div>
          <div className="language-tabs" role="group" aria-label={t('Edit content language', 'مواد کی زبان')}><button type="button" className={editLang === 'en' ? 'selected' : ''} onClick={() => setEditLang('en')}>English</button><button type="button" className={editLang === 'ur' ? 'selected' : ''} onClick={() => setEditLang('ur')}>اردو</button><small>{t('Add one or both languages.', 'ایک یا دونوں زبانیں شامل کریں۔')}</small></div>
          <div dir={editLang === 'ur' ? 'rtl' : 'ltr'} lang={editLang}><label>{t('Title', 'عنوان')}<input value={form.translations[editLang]?.title || ''} onChange={e => editTranslation('title', e.target.value)} maxLength={250}/></label><label>{t('Introduction / summary', 'تعارف / خلاصہ')}<textarea rows={3} value={form.translations[editLang]?.summary || ''} onChange={e => editTranslation('summary', e.target.value)} maxLength={2000}/></label><label>{t('Reading text / excerpt', 'تحریر / اقتباس')}<textarea className="body-editor" rows={8} value={form.translations[editLang]?.body || ''} onChange={e => editTranslation('body', e.target.value)} maxLength={100000}/></label></div>
          <div className="upload-section"><h3>{t('Narration', 'آواز میں قرأت')} · {editLang === 'en' ? 'English' : 'اردو'}</h3><label>{t('Audio URL', 'آڈیو کا لنک')}<input value={form.translations[editLang]?.audioUrl || ''} onChange={e => editTranslation('audioUrl', e.target.value)} dir="ltr"/></label><label className={`upload-control ${busy ? 'disabled' : ''}`}><Upload size={17}/>{t('Upload MP3, WAV or M4A', 'MP3، WAV یا M4A اپ لوڈ کریں')}<input type="file" accept=".mp3,.wav,.m4a" disabled={busy} onChange={e => uploadFile(e, 'audio')}/></label><small>{t('50 MiB maximum. Recording is public after upload.', 'زیادہ سے زیادہ ۵۰ MiB۔ اپ لوڈ کے بعد آڈیو عوامی ہوگی۔')}</small></div>
          {tab === 'books' && <><div className="upload-section"><h3>{t('Book cover', 'کتاب کا سرورق')}</h3><div className="cover-editor">{safeMedia(form.coverUrl) && <img src={safeMedia(form.coverUrl)} alt={t('Uploaded cover', 'اپ لوڈ شدہ سرورق')}/>}<div><label>{t('Cover URL', 'سرورق کا لنک')}<input value={form.coverUrl || ''} onChange={e => update('coverUrl', e.target.value)} dir="ltr"/></label><label className={`upload-control ${busy ? 'disabled' : ''}`}><Upload size={17}/>{t('Upload cover', 'سرورق اپ لوڈ کریں')}<input type="file" accept=".jpg,.jpeg,.png,.webp" disabled={busy} onChange={e => uploadFile(e, 'cover')}/></label><small>{t('JPEG, PNG or WebP · maximum 5 MiB', 'JPEG، PNG یا WebP ۔ زیادہ سے زیادہ ۵ MiB')}</small></div></div><label>{t('Publication year', 'سالِ اشاعت')}<input type="number" min="1800" max="2200" value={form.publicationYear || ''} onChange={e => update('publicationYear', e.target.value ? Number(e.target.value) : '')}/></label></div>
          <div className="upload-section"><h3>{t('Private PDF edition', 'نجی PDF نسخہ')} · {editLang}</h3>{!selected && <p className="muted">{t('Save the draft first, then upload the book file.', 'پہلے مسودہ محفوظ کریں، پھر کتاب اپ لوڈ کریں۔')}</p>}<label className={`upload-control ${!selected || busy ? 'disabled' : ''}`}><Upload size={17}/>{t('Upload private PDF', 'نجی PDF اپ لوڈ کریں')}<input type="file" accept=".pdf" disabled={!selected || busy} onChange={e => uploadFile(e, 'document')}/></label><small>{t('Staff-only access · maximum 50 MiB · no customer downloads yet', 'صرف منتظم کی رسائی ۔ زیادہ سے زیادہ ۵۰ MiB ۔ خریداروں کے ڈاؤن لوڈ ابھی باقی ہیں')}</small>{files.map(file => <div className="private-file" key={file.id}><span>{file.language.toUpperCase()} · {file.pageCount} {t('pages', 'صفحات')} · {(file.bytes / 1024).toFixed(0)} KB</span><button type="button" className="text-button" onClick={() => setForm(f => ({ ...f, digitalFileIds: { ...f.digitalFileIds, [file.language]: file.id } }))}>{form.digitalFileIds?.[file.language] === file.id ? t('Attached', 'منسلک') : t('Use edition', 'یہ نسخہ منتخب کریں')}</button><a href={`/api/v1/admin/books/${selected}/files/${file.id}/download`} target="_blank" rel="noreferrer">{t('Review PDF', 'PDF دیکھیں')}</a></div>)}</div>
          <label className="checkbox"><input type="checkbox" checked={form.digitalAvailable} onChange={e => setForm(f => ({ ...f, digitalAvailable: e.target.checked, ...(e.target.checked && !f.currency ? { currency: 'usd' } : {}) }))}/>{t('Enable digital purchase (test mode)', 'ڈیجیٹل خریداری فعال کریں (آزمائشی)')}</label>{form.digitalAvailable && <div className="two-fields"><label>{t('Price in minor units (1000 = 10.00)', 'قیمت چھوٹی اکائی میں (1000 = 10.00)')}<input type="number" min="50" max="10000000" value={form.priceMinor || ''} onChange={e => update('priceMinor', Number(e.target.value))}/></label><label>{t('Currency', 'کرنسی')}<select value={form.currency || 'usd'} onChange={e => update('currency', e.target.value)}><option value="usd">USD</option><option value="gbp">GBP</option><option value="eur">EUR</option><option value="cad">CAD</option><option value="aed">AED</option></select></label></div>}</>}
          {tab === 'videos' && <label>{t('Video HTTPS link', 'ویڈیو کا HTTPS لنک')}<input value={form.videoUrl || ''} onChange={e => update('videoUrl', e.target.value)} type="url"/></label>}
          <div className="editor-actions"><button className="button" disabled={busy}><Save size={17}/>{busy ? t('Working…', 'کام جاری ہے…') : t('Save draft', 'مسودہ محفوظ کریں')}</button><button type="button" className="button secondary" disabled={!selected || busy} onClick={() => run(async () => { const item = await save(); setPreview(await api(`/admin/content/${item.id}/preview`)); })}><Eye size={17}/>{t('Preview', 'پیش منظر')}</button><button type="button" className="button secondary" disabled={!selected || busy} onClick={() => run(async () => setRevisions((await api(`/admin/content/${selected}/revisions`)).items))}><History size={17}/>{t('Revisions', 'سابقہ نسخے')}</button></div>
          {selected && <div className="publish-actions"><button type="button" className="button publish" disabled={busy} onClick={() => run(() => publishAction('publish'))}><CheckCircle2 size={17}/>{t('Publish saved draft', 'محفوظ مسودہ شائع کریں')}</button><button type="button" className="text-button" disabled={busy} onClick={() => run(() => publishAction('unpublish'))}>{t('Unpublish live version', 'اشاعت ختم کریں')}</button></div>}
          {revisions && <div className="revision-list"><h3>{t('Previous versions', 'سابقہ نسخے')}</h3>{!revisions.length && <p className="muted">{t('No previous versions yet.', 'ابھی سابقہ نسخہ موجود نہیں۔')}</p>}{revisions.map(rev => <div key={rev.id}><span><strong>{choose(rev.snapshot, lang)?.title || rev.snapshot.slug}</strong><small>{new Date(rev.created_at).toLocaleString()}</small></span><button type="button" className="button small secondary" disabled={busy} onClick={() => run(async () => { const result = await api(`/admin/content/${selected}/revisions/${rev.id}/restore`, { method: 'POST', body: {} }); setForm(payload(result.item)); setRefresh(n => n + 1); setRevisions(null); setMessage(t('Restored as a draft. Live content is unchanged.', 'مسودہ بحال ہو گیا۔ شائع شدہ مواد تبدیل نہیں ہوا۔')); })}>{t('Restore as draft', 'مسودہ بحال کریں')}</button></div>)}</div>}
        </form></div> : <Records tab={tab} items={list.data?.items || []} busy={busy} run={run} refresh={() => setRefresh(n => n + 1)}/>}
    </div>
    <dialog className="preview-dialog" ref={dialog} onCancel={() => setPreview(null)}><div className="preview-toolbar"><strong>{t('Draft preview', 'مسودے کا پیش منظر')}</strong><button className="icon-button" aria-label={t('Close preview', 'پیش منظر بند کریں')} onClick={() => { dialog.current.close(); setPreview(null); }}><X size={22}/></button></div>{preview && <><Notice>{preview.readiness.canPublish ? t('Ready to publish.', 'شائع کرنے کے لیے تیار۔') : t('Not ready to publish. Resolve the issues below.', 'اشاعت کے لیے تیار نہیں۔ نیچے دیے گئے مسائل حل کریں۔')}</Notice>{preview.readiness.issues.map((issue, i) => <ErrorMessage key={i} error={issue.message}/>)}<ContentBody item={preview.item} preview/></>}</dialog>
  </section>;
}
function ShieldNote({ t }) { return <><strong>{t('Protected workspace', 'محفوظ ورک اسپیس')}</strong><p>{t('Staff permissions and two-factor authentication are enforced by the server.', 'منتظم کی اجازت اور دو مرحلوں کی تصدیق سرور پر نافذ ہیں۔')}</p></>; }
function Records({ tab, items, busy, run, refresh }) {
  const t = useText();
  if (!items.length) return <Empty title={t('No records yet', 'ابھی کوئی ریکارڈ نہیں')}>{t('New activity will appear here.', 'نئی سرگرمی یہاں نظر آئے گی۔')}</Empty>;
  return <div className="records">{items.map(item => <div className="record" key={item.id}><div><strong>{item.name || item.email || item.id.slice(0, 8)}</strong><p>{item.email || item.user_id}</p>{item.message && <p className="record-message">{item.message}</p>}<small>{tab === 'users' ? `${item.role} · ${item.verified ? t('Verified', 'تصدیق شدہ') : t('Unverified', 'غیر تصدیق شدہ')}` : item.kind || item.status}{tab === 'orders' && ` · ${(item.amount / 100).toFixed(2)} ${item.currency.toUpperCase()}`}</small></div>{tab === 'users' && item.role !== 'owner' && <button className="button small secondary" disabled={busy} onClick={() => { const reason = window.prompt(t('Reason for this account-status change (at least 5 characters):', 'اکاؤنٹ کی حالت بدلنے کی وجہ (کم از کم ۵ حروف):')); if (reason) run(async () => { await api(`/admin/users/${item.id}/status`, { method: 'PATCH', body: { suspended: !item.suspended, reason } }); refresh(); }); }}>{item.suspended ? t('Reactivate', 'دوبارہ فعال کریں') : t('Suspend', 'معطل کریں')}</button>}</div>)}</div>;
}
