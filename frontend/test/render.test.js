import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';

let server, ui, pages, auth, admin, library, AppContext;
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  ui = await server.ssrLoadModule('/src/ui.jsx');
  pages = await server.ssrLoadModule('/src/pages.jsx');
  auth = await server.ssrLoadModule('/src/auth.jsx');
  admin = await server.ssrLoadModule('/src/admin.jsx');
  library = await server.ssrLoadModule('/src/library.jsx');
  ({ AppContext } = await server.ssrLoadModule('/src/context.jsx'));
});
after(async () => { await server?.close(); });
function render(Component, { lang = 'en', props = {}, user = null, path = `/${lang}` } = {}) {
  return renderToString(React.createElement(AppContext.Provider, { value: {
    user, authLoading: false, online: true, setUser() {}, acceptSession() {}, logout() {},
  } }, React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(ui.Layout, { lang }, React.createElement(Component, props)))));
}
test('English homepage preserves reference sections and links to real routes', () => {
  const html = render(pages.Home);
  for (const label of ['Stories of life.', 'LATEST BOOK', 'All five books', 'Latest articles', 'Latest vlog', 'Newsletter subscriptions are coming soon.']) assert.ok(html.includes(label), label);
  assert.ok(html.includes('href="/en/books"'));
  assert.ok(html.includes('Author portrait to be added'));
  assert.ok(html.includes('COVER PLACEHOLDER'));
});
test('Urdu homepage has translated sections and locale-preserving navigation', () => {
  const html = render(pages.Home, { lang: 'ur' });
  assert.ok(html.includes('زندگی کی کہانیاں'));
  assert.ok(html.includes('پانچوں کتابیں'));
  assert.ok(html.includes('href="/ur/books"'));
  assert.ok(html.includes('href="/ur/sign-in"'));
});
test('registration renders real form fields and unchecked optional marketing consent', () => {
  const html = render(auth.AuthPage, { props: { mode: 'register' }, path: '/en/sign-up' });
  for (const name of ['name', 'email', 'password', 'confirmPassword', 'acceptTerms', 'marketing']) assert.ok(html.includes(`name="${name}"`));
  assert.ok(html.includes('minLength="12"') || html.includes('minlength="12"'));
  assert.equal(html.includes('checked=""'), false);
  assert.ok(html.includes('local testing terms'));
});
test('sign-in and recovery offer working routes without fake credentials', () => {
  const html = render(auth.AuthPage, { props: { mode: 'login' }, path: '/en/sign-in' });
  assert.ok(html.includes('href="/en/forgot-password"'));
  assert.ok(html.includes('href="/en/sign-up"'));
  assert.ok(html.includes('current-password'));
  const reset = render(auth.EmailAction, { props: { mode: 'reset' }, path: '/en/reset-password' });
  assert.ok(reset.includes('name="confirm"'));
});
test('public admin landing explains secure setup; reader cannot see staff editor', () => {
  assert.ok(render(admin.Admin).includes('npm.cmd run setup:admin'));
  const html = render(admin.Admin, { user: { id: 'reader', name: 'Reader', role: 'reader' } });
  assert.ok(html.includes('Staff access required'));
  assert.equal(html.includes('New draft'), false);
});
test('owner workspace exposes real draft, cover, narration and private-PDF controls', () => {
  const html = render(admin.Admin, { user: { id: 'staff', name: 'Staff', role: 'owner' } });
  for (const label of ['New draft', 'Save draft', 'Preview', 'Revisions', 'Upload cover', 'Upload private PDF', 'Upload MP3, WAV or M4A']) assert.ok(html.includes(label), label);
  assert.ok(html.includes('Readers')); assert.ok(html.includes('Orders'));
});
test('content respects selected language and never injects article markup', () => {
  const item = { id: 'item', kind: 'articles', translations: { en: { title: 'English title', body: '<script>alert(1)</script>' }, ur: { title: 'اردو عنوان', body: 'تحریر' } } };
  const en = render(pages.ContentBody, { props: { item } });
  assert.ok(en.includes('&lt;script&gt;')); assert.equal(en.includes('<script>'), false);
  const ur = render(pages.ContentBody, { lang: 'ur', props: { item } });
  assert.ok(ur.includes('اردو عنوان')); assert.ok(ur.includes('dir="rtl"'));
});
test('unavailable translations and narration are stated instead of invented', () => {
  const item = { kind: 'articles', translations: { en: { title: 'Original only', body: 'Text' } } };
  const html = render(pages.ContentBody, { lang: 'ur', props: { item } });
  assert.ok(html.includes('اس زبان میں ترجمہ ابھی دستیاب نہیں'));
  assert.ok(html.includes('آواز ابھی دستیاب نہیں'));
});
test('library guest page requests sign-in and account navigation exposes library to users', () => {
  const html = render(library.LibraryPage, { path: '/en/library' });
  assert.ok(html.includes('Sign in to access your purchased PDF editions.'));
  assert.ok(html.includes('href="/en/sign-in"'));
  const member = render(pages.Home, { user: { id: 'reader', name: 'Reader', role: 'reader' } });
  assert.ok(member.includes('href="/en/library"'));
});
test('library editions show bilingual language, PDF details and order links without private paths', () => {
  const items = [{ id: 'entitlement', orderId: 'order-1', title: '<Private book title>', language: 'ur', bytes: 1024 * 1024, pageCount: 120 }];
  const en = render(library.LibraryItems, { props: { items, busyId: '', onDownload() {} } });
  assert.ok(en.includes('Download PDF')); assert.ok(en.includes('120')); assert.ok(en.includes('href="/en/orders/order-1"'));
  assert.ok(en.includes('&lt;Private book title&gt;')); assert.equal(en.includes('private-books/'), false);
  const ur = render(library.LibraryItems, { lang: 'ur', props: { items, busyId: 'entitlement', onDownload() {} } });
  assert.ok(ur.includes('تیار ہو رہا ہے')); assert.ok(ur.includes('disabled=""'));
});
