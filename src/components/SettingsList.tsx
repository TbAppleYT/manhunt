'use client';
import { useEffect, useState } from 'react';
import { applyTheme, getTheme, type ThemePref } from '@/lib/client/theme';
import { audio } from '@/lib/client/audio';
import { Seg, Toggle } from './ui';

/** Appearance (System default), announcements and volume. Used in-game (More) and on /settings. */
export function SettingsList() {
  const [theme, setTheme] = useState<ThemePref>('system');
  const [muted, setMuted] = useState(false);
  const [vol, setVol] = useState(0.9);
  useEffect(() => { setTheme(getTheme()); setMuted(audio().muted); setVol(audio().volume); }, []);
  return (
    <div className="list">
      <div className="li"><span className="tx"><span className="t1">Appearance</span></span>
        <div style={{ width: 190 }}><Seg label="Appearance" value={theme} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(t) => { setTheme(t); applyTheme(t); }} /></div>
      </div>
      <div className="li"><span className="tx"><span className="t1">Announcements</span><span className="t2">Spoken game announcements</span></span><Toggle label="Announcements" on={!muted} onChange={(on) => { setMuted(!on); audio().setMuted(!on); }} /></div>
      <div className="li"><span className="tx"><span className="t1">Volume</span></span>
        <input type="range" className="range" style={{ width: 140 }} min={0} max={1} step={0.05} value={vol} aria-label="Volume" onChange={(e) => { const x = Number(e.target.value); setVol(x); audio().setVolume(x); }} />
      </div>
      <button className="li" onClick={() => audio().play(['welcome'])}><span className="tx"><span className="t1">Test sound</span></span></button>
    </div>
  );
}
