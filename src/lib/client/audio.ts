'use client';
/* Central audio manager. Plays the supplied ElevenLabs clips by their real filenames (see
   src/data/audio-manifest.json, built from the actual archive). One clip at a time, queued; missing
   files are skipped; nothing plays until the browser has seen a user gesture (autoplay rules). */
import manifest from '@/data/audio-manifest.json';

type Manifest = { clips: Record<string, { src: string }>; missingFromArchive: string[]; notInManifest: string[] };
const M = manifest as Manifest;

const PRIORITY: Record<string, number> = { emergency_pause: 100, catch_reported: 80, gps_unavailable: 70, connection_lost: 70, game_paused: 60, game_resumed: 60, winner: 90, game_over: 85 };

class AudioManager {
  private queue: string[][] = [];
  private playing = false;
  private el: HTMLAudioElement | null = null;
  private unlocked = false;
  private seen = new Set<string>();
  volume = 0.9;
  muted = false;

  constructor() {
    if (typeof window === 'undefined') return;
    try {
      const p = JSON.parse(localStorage.getItem('mh.audio') || '{}');
      if (typeof p.volume === 'number') this.volume = p.volume;
      if (typeof p.muted === 'boolean') this.muted = p.muted;
    } catch { /* defaults */ }
    const unlock = () => { this.unlocked = true; this.pump(); };
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
  }
  get isUnlocked() { return this.unlocked; }
  has(clip: string) { return !!M.clips[clip]; }
  save() { try { localStorage.setItem('mh.audio', JSON.stringify({ volume: this.volume, muted: this.muted })); } catch { /* ignore */ } }
  setVolume(v: number) { this.volume = Math.max(0, Math.min(1, v)); if (this.el) this.el.volume = this.volume; this.save(); }
  setMuted(m: boolean) { this.muted = m; if (m) this.stop(); this.save(); }

  /** Play a sequence (e.g. ["sector_closing_3_minutes","sector_04"]). `key` de-duplicates replays of the same event. */
  play(clips: string[], key?: string) {
    if (key) { if (this.seen.has(key)) return; this.seen.add(key); }
    const list = clips.filter((c) => this.has(c)); // gracefully skip files that are not in the pack
    if (!list.length || this.muted) return;
    const pr = PRIORITY[list[0]] ?? 0;
    if (pr >= 80) { this.queue = []; this.stop(); }
    this.queue.push(list);
    if (this.queue.length > 4) this.queue.splice(0, this.queue.length - 4); // drop stale backlog, keep newest
    this.pump();
  }
  stop() { if (this.el) { this.el.pause(); this.el = null; } this.playing = false; }

  private async pump() {
    if (this.playing || !this.unlocked || this.muted) return;
    const next = this.queue.shift();
    if (!next) return;
    this.playing = true;
    for (const clip of next) {
      if (this.muted) break;
      await new Promise<void>((done) => {
        const a = new Audio(M.clips[clip].src);
        a.volume = this.volume; this.el = a;
        const end = () => { a.onended = a.onerror = null; done(); };
        a.onended = end; a.onerror = end;
        a.play().catch(end);
        setTimeout(end, 15000);
      });
    }
    this.el = null; this.playing = false;
    this.pump();
  }
}

let inst: AudioManager | null = null;
export const audio = () => (inst ||= new AudioManager());
export const audioPackNotes = { missing: M.missingFromArchive, extra: M.notInManifest };
