'use client';
import { useState } from 'react';
import type { PlayerView } from '@/lib/engine/view';
import type { Command } from '@/lib/engine/engine';

/** Developer simulator controls (simulation games only, host only). */
export function SimPanel({ view: v, send, selected, setSelected, say }: { view: PlayerView; send: (c: Command) => Promise<unknown>; selected: string | null; setSelected: (id: string | null) => void; say: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const go = (c: Command, ok?: string) => send(c).then(() => ok && say(ok)).catch((e) => say((e as Error).message));
  const sel = v.players.find((p) => p.id === selected) ?? null;
  const hiders = v.players.filter((p) => p.role === 'hider' && !p.left);

  if (!open) return (
    <button className="chipbtn" data-nopan style={{ position: 'absolute', left: 10, bottom: 10, zIndex: 6, background: 'var(--glass)', boxShadow: 'var(--shadow)' }} onClick={() => setOpen(true)} data-testid="sim-open">
      Simulator · {v.game.config.speed}×
    </button>
  );
  return (
    <div className="sim-panel" data-nopan data-testid="sim-panel" style={{ top: 'auto', bottom: 8 }}>
      <div className="row"><b>Simulator</b><span className="small">isolated test game</span><span className="spacer" /><button className="chipbtn" onClick={() => setOpen(false)}>Hide</button></div>
      <div className="row">Speed {[1, 5, 10, 30].map((s) => <button key={s} className="chipbtn" aria-pressed={v.game.config.speed === s} onClick={() => go({ type: 'simSetSpeed', speed: s })}>{s}×</button>)}</div>
      <div className="row">Skip {(['headstart', 'vote', 'zone', 'photo', 'closing'] as const).map((w) => <button key={w} className="chipbtn" onClick={() => go({ type: 'simSkip', what: w }, `Skipped ${w}`)} data-testid={'skip-' + w}>{w === 'headstart' ? 'head start' : w}</button>)}</div>
      <div className="small">Tap the map to move <b>{sel ? sel.nickname : 'yourself'}</b>. Tap a marker to select a player.</div>
      {sel && sel.isBot && (<>
        <div className="row">
          <button className="chipbtn" onClick={() => go({ type: 'simBotFlags', playerId: sel.id, flags: { offline: true } }, `${sel.nickname} offline`)}>Disconnect</button>
          <button className="chipbtn" onClick={() => go({ type: 'simBotFlags', playerId: sel.id, flags: { offline: false, gpsFail: false } }, `${sel.nickname} restored`)}>Restore</button>
          <button className="chipbtn" onClick={() => go({ type: 'simBotFlags', playerId: sel.id, flags: { gpsFail: true } }, `${sel.nickname} GPS failed`)}>GPS fail</button>
          {sel.role === 'hider' && <button className="chipbtn" onClick={() => go({ type: 'simBotFlags', playerId: sel.id, flags: { disputeNext: true } }, `${sel.nickname} will dispute`)}>Dispute next catch</button>}
          {sel.role === 'hider' && <button className="chipbtn" onClick={() => go({ type: 'simBotAction', playerId: sel.id, action: 'submitPhoto' }, 'Photo submitted')}>Submit photo</button>}
        </div>
        {sel.role === 'seeker' && (
          <div className="row">
            <select className="select" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Hider to catch"><option value="">Hider…</option>{hiders.map((h) => <option key={h.id} value={h.id}>{h.nickname}</option>)}</select>
            <button className="chipbtn" disabled={!target} onClick={() => go({ type: 'simBotAction', playerId: sel.id, action: 'reportCatch', target }, 'Catch reported')}>Report catch as {sel.nickname}</button>
          </div>
        )}
      </>)}
      {sel && <button className="chipbtn" onClick={() => setSelected(null)}>Select myself</button>}
    </div>
  );
}
