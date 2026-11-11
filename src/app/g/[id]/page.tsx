import { GameClient } from '@/components/GameClient';
export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GameClient gameId={id} />;
}
