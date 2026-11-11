import Link from 'next/link';
import { SafetyRules } from '@/components/Play';
import { Icon } from '@/components/ui';
export default function RulesPage() {
  return (
    <div className="app"><div className="scroll"><div className="page">
      <div className="navrow"><Link className="back" href="/">{Icon.back}Back</Link></div>
      <h1 className="h1">Safety rules</h1>
      <SafetyRules />
      <div className="cap">PRIVACY</div>
      <p className="lead" style={{ fontSize: 14 }}>Games are private and need a code. Your location is shared with the game server only while you play. Other players never see your exact position: teammates see an approximate area, and seekers only see short-lived search zones and clues. No location history is stored, and games, photos and replays are deleted automatically.</p>
    </div></div></div>
  );
}
