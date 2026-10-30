import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppProvider } from './context';
import { Layout } from './ui';
import { Home, Catalogue, ContentPage, About, Contact, Account, OrderPage, NotFound } from './pages';
import { AuthPage, EmailAction } from './auth';
import { Admin } from './admin';
import { LibraryPage } from './library';
import './styles.css';
function LocalWebsite() {
  const { lang } = useParams();
  if (!['en', 'ur'].includes(lang)) return <Navigate to="/en" replace/>;
  return <Layout lang={lang}><Routes>
    <Route index element={<Home/>}/><Route path="books" element={<Catalogue kind="books"/>}/><Route path="articles" element={<Catalogue kind="articles"/>}/><Route path="videos" element={<Catalogue kind="videos"/>}/>
    <Route path="books/:slug" element={<ContentPage kind="books"/>}/><Route path="articles/:slug" element={<ContentPage kind="articles"/>}/><Route path="pages/:slug" element={<ContentPage kind="pages"/>}/><Route path="videos/:slug" element={<ContentPage kind="videos"/>}/>
    <Route path="about" element={<About/>}/><Route path="contact" element={<Contact/>}/>
    <Route path="sign-in" element={<AuthPage key="login" mode="login"/>}/><Route path="sign-up" element={<AuthPage key="register" mode="register"/>}/><Route path="forgot-password" element={<AuthPage key="forgot" mode="forgot"/>}/>
    <Route path="verify-email" element={<EmailAction mode="verify"/>}/><Route path="reset-password" element={<EmailAction mode="reset"/>}/>
    <Route path="account" element={<Account/>}/><Route path="library" element={<LibraryPage/>}/><Route path="orders/:id" element={<OrderPage/>}/><Route path="admin" element={<Admin/>}/><Route path="*" element={<NotFound/>}/>
  </Routes></Layout>;
}
createRoot(document.getElementById('root')).render(<AppProvider><BrowserRouter><Routes><Route path="/" element={<Navigate to="/en" replace/>}/><Route path="/:lang/*" element={<LocalWebsite/>}/></Routes></BrowserRouter></AppProvider>);
