'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, saveSession } from '@/lib/client/api';
import { Icon } from './ui';

export function EntryForm({ mode, initialCode = '', sim = false }: { mode: 'create' | 'join'; initialCode?: string; sim?: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode.replace(/\D/g, '').slice(0, 6));
  const [nick, setNick] = useState(() => { try { return localStorage.getItem('mh.nick') || ''; } catch { return ''; } });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = nick.trim().length >= 2 && (mode === 'create' || code.length === 6);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!ok || busy) return;
    setBusy(true); setErr(null);
    try {
      const s = mode === 'create' ? await api.create(nick.trim(), sim) : await api.join(code, nick.trim(), sim);
      saveSession({ ...s, sim });
      try { localStorage.setItem('mh.nick', nick.trim()); } catch { /* ignore */ }
      router.push(`/g/${s.gameId}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <form className="page" onSubmit={submit}>
      <div className="navrow"><Link className="back" href={sim ? '/sim' : '/'}>{Icon.back}Back</Link></div>
      <h1 className="h1">{mode === 'create' ? (sim ? 'New simulation' : 'Create game') : sim ? 'Join simulation' : 'Join game'}</h1>
      {mode === 'join' && (
        <div className="field"><label htmlFor="code">Game code</label>
          <input id="code" className="input code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} data-testid="code-input" />
        </div>
      )}
      <div className="field"><label htmlFor="nick">Nickname</label>
        <input id="nick" className="input" maxLength={20} autoComplete="nickname" placeholder="What friends call you" value={nick} onChange={(e) => setNick(e.target.value)} data-testid="nick-input" />
        <span className="small">No account needed. Your nickname is only shown inside this game.</span>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="spacer" />
      <button className="btn" type="submit" disabled={!ok || busy} data-testid="submit-entry">{busy ? 'One moment…' : mode === 'create' ? 'Create game' : 'Join'}</button>
    </form>
  );
}
