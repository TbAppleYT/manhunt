import { EntryForm } from '@/components/EntryForm';
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ code?: string; sim?: string }> }) {
  const sp = await searchParams;
  return <div className="app"><div className="scroll"><EntryForm mode="join" initialCode={sp.code ?? ''} sim={sp.sim === '1'} /></div></div>;
}
