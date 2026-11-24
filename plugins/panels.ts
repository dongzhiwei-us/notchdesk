import { TodoPanel } from './todo/Panel';
import { ClipPanel } from './clipline/Panel';
import { SnippetsPanel } from './snippets/Panel';
import { VocabularyPanel } from './vocabulary/Panel';
import { TrendsPanel } from './trends/Panel';
import { MorningPanel } from './morning/Panel';
import { AttentionPanel } from './attention/Panel';
import { WellnessPanel } from './wellness/Panel';
import type { ReactNode } from 'react';
import type { PanelProps } from '../src/ui/primitives';

export const panels: Record<string, (props: PanelProps) => ReactNode> = {
  todo: TodoPanel, clipline: ClipPanel, snippets: SnippetsPanel, vocabulary: VocabularyPanel,
  trends: TrendsPanel, morning: MorningPanel, attention: AttentionPanel, wellness: WellnessPanel,
};
