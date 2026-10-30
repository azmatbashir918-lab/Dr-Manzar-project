import React, { useState } from 'react';
import { Download, RefreshCw, BookOpen, ShieldCheck } from 'lucide-react';
import { api } from './api';
import { useApp } from './context';
import { useText, LocalLink, useApiData, ErrorMessage, Notice, Empty, Loading } from './ui';

export function LibraryItems({ items, busyId, onDownload }) {
  const t = useText();
  return <div className="library-items">{items.map(item => <div className="library-item" key={item.id}><div className="library-book-icon"><BookOpen size={27} strokeWidth={1.3}/></div><div className="library-item-copy"><h3>{item.title}</h3><p>{item.language === 'ur' ? 'اردو' : 'English'} · PDF · {item.pageCount} {t('pages', 'صفحات')} · {(item.bytes / (1024 * 1024)).toFixed(1)} MB</p><LocalLink to={`orders/${item.orderId}`} className="text-link">{t('View order', 'آرڈر دیکھیں')}</LocalLink></div><button type="button" className="button small secondary" disabled={Boolean(busyId)} onClick={() => onDownload(item)}><Download size={16}/>{busyId === item.id ? t('Preparing…', 'تیار ہو رہا ہے…') : t('Download PDF', 'PDF ڈاؤن لوڈ کریں')}</button></div>)}</div>;
}
export function LibraryPanel() {
  const t = useText(), [refresh, setRefresh] = useState(0), [busyId, setBusyId] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const library = useApiData('/library?limit=100', refresh);
  async function download(item) {
    setBusyId(item.id); setError(''); setMessage('');
    try {
      const link = await api(`/library/${item.id}/download-links`, { method: 'POST', body: {} });
      if (!/^\/api\/v1\/downloads\/[a-f0-9]{64}$/.test(link.url)) throw new Error(t('Unexpected download address.', 'ڈاؤن لوڈ کا پتہ درست نہیں۔'));
      const response = await fetch(link.url, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(data?.error?.message || t('Download unavailable. Please try again.', 'ڈاؤن لوڈ دستیاب نہیں۔ دوبارہ کوشش کریں۔')); }
      if (!response.headers.get('content-type')?.startsWith('application/pdf')) throw new Error(t('Unexpected file type.', 'فائل کی قسم درست نہیں۔'));
      const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `book-${item.language}.pdf`; anchor.hidden = true; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage(t('Your PDF has been sent to your browser’s downloads.', 'PDF آپ کے براؤزر کے ڈاؤن لوڈ میں بھیج دی گئی ہے۔'));
    } catch (e) { setError(e.message); } finally { setBusyId(''); }
  }
  return <section className="library-panel"><div className="section-heading"><h2>{t('My library', 'میری لائبریری')}</h2><button type="button" className="text-button" disabled={library.loading || Boolean(busyId)} onClick={() => { setRefresh(n => n + 1); setError(''); setMessage(''); }}><RefreshCw size={15}/>{t('Refresh', 'تازہ کریں')}</button></div><ErrorMessage error={library.error || error}/>{message && <Notice>{message}</Notice>}{library.loading ? <Loading/> : library.data?.items?.length ? <LibraryItems items={library.data.items} busyId={busyId} onDownload={download}/> : !library.error && <Empty title={t('Your bookshelf is waiting', 'آپ کی کتابوں کا انتظار ہے')}>{t('PDF editions appear here after payment is confirmed. Pending, failed and fully refunded orders do not grant downloads.', 'ادائیگی کی تصدیق کے بعد PDF نسخے یہاں نظر آئیں گے۔ نامکمل، ناکام یا مکمل واپس کی گئی ادائیگی پر ڈاؤن لوڈ دستیاب نہیں۔')}</Empty>}<p className="library-security"><ShieldCheck size={16}/>{t('Private files · fresh, single-use links · signed-in access only', 'نجی فائلیں ۔ ایک بار استعمال ہونے والے تازہ لنک ۔ صرف سائن اِن صارف')}</p></section>;
}
export function LibraryPage() {
  const t = useText(), { user, authLoading } = useApp();
  if (authLoading) return <Loading/>;
  return <section className="wrap page-section"><p className="eyebrow">{t('YOUR READING COLLECTION', 'آپ کی مطالعاتی دنیا')}</p>{user ? <LibraryPanel/> : <><h1>{t('My library', 'میری لائبریری')}</h1><p className="lead">{t('Sign in to access your purchased PDF editions.', 'خریدے ہوئے PDF نسخے حاصل کرنے کے لیے سائن اِن کریں۔')}</p><LocalLink className="button" to="sign-in">{t('Sign in', 'سائن اِن')}</LocalLink></>}</section>;
}
