'use client';
export type ThemePref = 'system' | 'light' | 'dark';

export function getTheme(): ThemePref {
  try { const t = localStorage.getItem('mh.theme'); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; }
}
/** System (default) follows prefers-color-scheme live through CSS; Light/Dark pin it with data-theme. */
export function applyTheme(t: ThemePref) {
  const r = document.documentElement;
  if (t === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', t);
  try { if (t === 'system') localStorage.removeItem('mh.theme'); else localStorage.setItem('mh.theme', t); } catch { /* ignore */ }
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101012' : '#ffffff');
}
/** Inline script for <head> so the saved theme applies before first paint. */
export const themeBootScript = `try{var t=localStorage.getItem('mh.theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;
