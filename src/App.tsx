/**
 * Astryx Text Studio – one text app, three versions, in the edulab theme.
 * Top bar: version switcher. The version lives in the URL hash (#v=writer)
 * so it can be linked or reloaded.
 */

import {useEffect, useState, type CSSProperties} from 'react';

import {Theme} from '@astryxdesign/core/theme';
import {TopNav, TopNavHeading} from '@astryxdesign/core/TopNav';
import {VStack, StackItem} from '@astryxdesign/core/Layout';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {Icon} from '@astryxdesign/core/Icon';
import {Text} from '@astryxdesign/core/Text';
import {Divider} from '@astryxdesign/core/Divider';
import {useMediaQuery} from '@astryxdesign/core/hooks';
import {
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

import {themes, defaultThemeSlug} from './astryx-themes';
import MessagingPage from './versions/messaging-shell/page';
import WriterPage from './versions/writer/page';
import AIChatPage from './versions/ai-chat/page';

// ─── Constants ───

const VERSIONS = {
  messages: {label: 'Messages', icon: ChatBubbleLeftRightIcon, Page: MessagingPage},
  writer: {label: 'Writer', icon: DocumentTextIcon, Page: WriterPage},
  ai: {label: 'AI Chat', icon: SparklesIcon, Page: AIChatPage},
} as const;
type VersionId = keyof typeof VERSIONS;

const styles: Record<string, CSSProperties> = {
  root: {height: '100dvh', width: '100%', background: 'var(--color-background-body)'},
  stage: {minHeight: 0},
};

// ─── Helpers ───

interface HashState {
  version: VersionId;
}

function readHash(): HashState {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const v = params.get('v');
  return {version: v && v in VERSIONS ? (v as VersionId) : 'messages'};
}

// ─── App ───

export default function App() {
  const [state, setState] = useState<HashState>(readHash);

  useEffect(() => {
    const hash = `v=${state.version}`;
    if (window.location.hash.slice(1) !== hash) {
      window.history.replaceState(null, '', `#${hash}`);
    }
  }, [state]);

  useEffect(() => {
    const onHash = () => setState(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const set = (patch: Partial<HashState>) => setState(prev => ({...prev, ...patch}));
  const {Page} = VERSIONS[state.version];
  const isPhone = useMediaQuery('(max-width: 768px)');

  const versionControl = (
    <SegmentedControl
      label="App version"
      size={isPhone ? 'sm' : 'md'}
      layout={isPhone ? 'fill' : 'hug'}
      value={state.version}
      onChange={value => set({version: value as VersionId})}>
      {(Object.keys(VERSIONS) as VersionId[]).map(id => (
        <SegmentedControlItem
          key={id}
          value={id}
          label={VERSIONS[id].label}
          icon={<Icon icon={VERSIONS[id].icon} size="sm" color="inherit" />}
        />
      ))}
    </SegmentedControl>
  );

  return (
    <Theme theme={themes[defaultThemeSlug]} mode="light">
      <VStack style={styles.root} data-version={state.version}>
        {isPhone ? (
          <VStack gap={2} padding={2}>
            <Text weight="semibold">Astryx Text Studio</Text>
            {versionControl}
          </VStack>
        ) : (
          <TopNav
            label="Showcase controls"
            heading={<TopNavHeading heading="Astryx Text Studio" />}
            centerContent={versionControl}
          />
        )}
        <Divider />
        <StackItem size="fill" style={styles.stage}>
          <Page key={state.version} />
        </StackItem>
      </VStack>
    </Theme>
  );
}
