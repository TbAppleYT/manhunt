'use client';
import { useEffect, useRef, type ReactNode } from 'react';

export const Icon = {
  camera: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M4 8h3.2l1.8-2.5h6L16.8 8H20a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.3" r="3.6" /></svg>,
  group: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5c.6-3.1 2.8-4.8 5.5-4.8s4.9 1.7 5.5 4.8" /><circle cx="17" cy="9.5" r="2.4" /><path d="M16.3 14.8c2.2 0 3.8 1.4 4.3 4" /></svg>,
  events: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>,
  more: <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18.5" cy="12" r="1.7" /></svg>,
  target: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="2.6" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></svg>,
  vote: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="3.5" /><path d="m8.5 12.3 2.4 2.4 4.6-5" /></svg>,
  arrow: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3 3 10.6l7.4 2.1 2.1 7.3z" /></svg>,
  close: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>,
  back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>,
  host: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>,
};

/** Bottom sheet with the Phase 1 QA behaviour: when closed it is inert and hidden from assistive tech;
    opening focuses Close; closing returns focus to whatever opened it. */
export function Sheet({ open, title, onClose, children, testId }: { open: boolean; title: string; onClose: () => void; children: ReactNode; testId?: string }) {
  const ref = useRef<HTMLElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.inert = !open;
    if (open) { opener.current = document.activeElement; closeBtn.current?.focus({ preventScroll: true }); }
    else if (opener.current instanceof HTMLElement && opener.current.isConnected) { opener.current.focus({ preventScroll: true }); opener.current = null; }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  }, [open, onClose]);
  return (<>
    <div className={'scrim' + (open ? ' show' : '')} onClick={onClose} />
    <section ref={ref} className={'sheet' + (open ? ' show' : '')} role="dialog" aria-modal="true" aria-hidden={!open} aria-label={title} data-testid={testId}>
      <div className="grab" />
      <div className="sh-head"><h2>{title}</h2><button className="x" ref={closeBtn} onClick={onClose} aria-label="Close">{Icon.close}</button></div>
      <div className="sh-body">{open && children}</div>
    </section>
  </>);
}

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => <button key={String(v)} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="sw" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export const initial = (n: string) => n.replace(/^Bot /, '').slice(0, 1).toUpperCase();
