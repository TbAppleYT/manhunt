'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { lastGameId, loadSession } from '@/lib/client/api';

export default function Welcome() {
  const [resume, setResume] = useState<{ id: string; code: string } | null>(null);
  useEffect(() => { const id = lastGameId(); const s = id ? loadSession(id) : null; if (s && !s.sim) setResume({ id: s.gameId, code: s.code }); }, []);
  return (
    <div className="app"><div className="scroll"><div className="page">
      <div className="welcome-hero">
        <h1 className="wm">manhunt.</h1>
        <p className="lead">Private hide-and-seek for your friends at Town Center, Virginia Beach.</p>
      </div>
      <div className="spacer" />
      <div className="stack">
        {resume && <Link className="btn blue" style={{ display: 'grid', placeItems: 'center' }} href={`/g/${resume.id}`} data-testid="resume">Rejoin game {resume.code}</Link>}
        <Link className="btn" style={{ display: 'grid', placeItems: 'center' }} href="/create" data-testid="go-create">Create game</Link>
        <Link className="btn ghost" style={{ display: 'grid', placeItems: 'center' }} href="/join" data-testid="go-join">Join with a code</Link>
      </div>
      <div className="row" style={{ justifyContent: 'center', gap: 18, flexWrap: 'wrap' }}>
        <Link className="small" href="/rules">Safety rules</Link>
        <Link className="small" href="/settings">Settings</Link>
        <Link className="small" href="/sim">Simulator</Link>
        <Link className="small" href="/editor">Sector editor</Link>
      </div>
    </div></div></div>
  );
}
