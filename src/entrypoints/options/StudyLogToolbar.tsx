import { Captions, List, MessageSquareQuote, Search, Sparkles, Type, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { SegmentedControl } from '@/components/SegmentedControl';
import type { TypeFilter } from '@/lib/study-log/filter';

const TYPE_OPTIONS: readonly { value: TypeFilter; label: string; icon: LucideIcon }[] = [
  { value: 'all', label: 'All', icon: List },
  { value: 'word', label: 'Words', icon: Type },
  { value: 'phrase', label: 'Phrases', icon: MessageSquareQuote },
  { value: 'idiom', label: 'Idioms', icon: Sparkles },
  { value: 'line', label: 'Lines', icon: Captions },
];

interface StudyLogToolbarProps {
  type: TypeFilter;
  onTypeChange(next: TypeFilter): void;
  query: string;
  onQueryChange(next: string): void;
  /** Page actions at the end of the toolbar (Task 12 puts the Export menu here). */
  actions?: ReactNode;
}

/** v2 spec §6.1: type filter (single choice), search over text and meaning, then page actions. */
export function StudyLogToolbar({ type, onTypeChange, query, onQueryChange, actions }: StudyLogToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedControl label="Item type" value={type} options={TYPE_OPTIONS} onChange={onTypeChange} />
      <label className="flex min-w-48 flex-1 items-center gap-2 rounded-2xl border-2 border-line bg-card px-3 py-2 focus-within:border-brand">
        <Search size={16} strokeWidth={2.5} className="shrink-0 text-mute" aria-hidden />
        <input
          type="search"
          aria-label="Search saved items"
          placeholder="Search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm font-bold text-ink outline-none placeholder:text-mute"
        />
      </label>
      {actions}
    </div>
  );
}
