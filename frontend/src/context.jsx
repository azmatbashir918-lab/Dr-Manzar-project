import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, setCsrf } from './api';
export const AppContext = createContext(null);
export function AppProvider({ children }) {
  const [user, setUser] = useState(null), [authLoading, setAuthLoading] = useState(true);
  const [online, setOnline] = useState(null);
  function acceptSession(data) { setUser(data.user); setCsrf(data.csrfToken); }
  useEffect(() => {
    api('/auth/me').then(acceptSession).catch(() => {}).finally(() => setAuthLoading(false));
    api('/health').then(() => setOnline(true)).catch(() => setOnline(false));
  }, []);
  async function logout() { await api('/auth/logout', { method: 'POST' }); setUser(null); setCsrf(''); }
  return <AppContext.Provider value={{ user, setUser, authLoading, acceptSession, logout, online }}>{children}</AppContext.Provider>;
}
export const useApp = () => useContext(AppContext);
