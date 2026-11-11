import Link from 'next/link';
import { SettingsList } from '@/components/SettingsList';
import { Icon } from '@/components/ui';
export default function SettingsPage() {
  return (
    <div className="app"><div className="scroll"><div className="page">
      <div className="navrow"><Link className="back" href="/">{Icon.back}Back</Link></div>
      <h1 className="h1">Settings</h1>
      <SettingsList />
      <p className="small">Appearance follows your device by default. The satellite map looks the same in light and dark mode.</p>
    </div></div></div>
  );
}
