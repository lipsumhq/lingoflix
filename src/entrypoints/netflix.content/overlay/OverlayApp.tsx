import { Card } from './Card';
import type { Box, CardState } from './card-state';
import type { ExplainController } from './explain-controller';
import { useStore, type Store } from './store';

export interface OverlayAppProps {
  store: Store<CardState | null>;
  explain: Pick<ExplainController, 'regenerate' | 'retry' | 'askFollowUp' | 'toggleSave' | 'close'>;
  playerRect(): Box | null;
  openSettings(): void;
  onCardElement(element: HTMLElement | null): void;
}

export function OverlayApp({ store, explain, playerRect, openSettings, onCardElement }: OverlayAppProps) {
  const card = useStore(store);
  if (!card) return null;
  return (
    <Card
      key={card.key}
      card={card}
      player={playerRect()}
      onRegenerate={explain.regenerate}
      onRetry={explain.retry}
      onFollowUp={explain.askFollowUp}
      onToggleSave={explain.toggleSave}
      onClose={explain.close}
      onOpenSettings={openSettings}
      cardRef={onCardElement}
    />
  );
}
