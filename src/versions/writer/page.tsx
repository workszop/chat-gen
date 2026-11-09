/**
 * Writer – a notes app built from Astryx parts (no single template matched):
 *   notes panel (List/ListItem + search) | editor (TextArea) | live preview (Markdown)
 * The footer shows word, character and reading-time counts. Notes persist in
 * localStorage (best effort; works without it).
 */

import {useEffect, useMemo, useState, type CSSProperties} from 'react';

import {
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  LayoutPanel,
  HStack,
  VStack,
  StackItem,
} from '@astryxdesign/core/Layout';
import {Text, Heading} from '@astryxdesign/core/Text';
import {List, ListItem} from '@astryxdesign/core/List';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Markdown} from '@astryxdesign/core/Markdown';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Icon} from '@astryxdesign/core/Icon';
import {Badge} from '@astryxdesign/core/Badge';
import {Divider} from '@astryxdesign/core/Divider';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {useMediaQuery} from '@astryxdesign/core/hooks';

import {
  DocumentTextIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';

// ─── Constants ───

const STORAGE_KEY = 'astryx-writer-notes-v1';

interface Note {
  id: string;
  title: string;
  body: string;
  updated: string;
}

const SEED_NOTES: Note[] = [
  {
    id: 'n1',
    title: 'Why a design system?',
    updated: '2026-11-08T17:40:00',
    body: `# Why a design system?

A design system turns **hundreds of small decisions** into one shared vocabulary.

## What Astryx gives you

- 150+ accessible React components
- Themes as CSS custom properties – swap the whole look at once
- A CLI that agents and people both use

> Try the theme picker in the top bar: this note re-renders in every theme.

Inline \`code\`, [links](https://github.com/meta/astryx) and tables work too:

| Theme | Mood |
|-------|------|
| Neutral | calm, minimal |
| Y2K | playful pop |
| Gothic | dark only |
`,
  },
  {
    id: 'n2',
    title: 'Shopping list',
    updated: '2026-11-07T09:12:00',
    body: `# Shopping list

1. Coffee beans
2. Oat milk
3. Lemons

- [x] Bread
- [ ] Cheese`,
  },
  {
    id: 'n3',
    title: 'Workshop outline',
    updated: '2026-11-05T14:03:00',
    body: `# Workshop outline

## Part 1 – Tokens
Colour, spacing, radius, type.

## Part 2 – Components
Composition over configuration.

## Part 3 – Themes
One provider, seven looks.`,
  },
];

type ViewMode = 'write' | 'split' | 'preview';

const styles: Record<string, CSSProperties> = {
  root: {height: '100%', width: '100%'},
  editorFill: {height: '100%', minHeight: 0},
  pane: {minWidth: 0, minHeight: 0, height: '100%', overflowY: 'auto'},
  textAreaControl: {height: '100%', alignItems: 'stretch'},
  textAreaContainer: {height: '100%'},
};

// The native <textarea> sizes by `rows`; this lets it fill the editor column.
// Plain <style> tag (as in the ai-chat template) so no CSS compiler is needed.
const WRITER_CSS = `
.writer-editor > div { flex: 1 1 auto; min-height: 0; }
.writer-editor .astryx-text-area { height: 100%; }
.writer-editor textarea { height: 100% !important; resize: none; }
`;

// ─── Helpers ───

function loadNotes(): Note[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Note[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* storage unavailable – fall back to seed notes */
  }
  return SEED_NOTES;
}

function saveNotes(notes: Note[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch {
    /* ignore */
  }
}

function countWords(text: string): number {
  const stripped = text.replace(/[#>*_`|[\]()-]/g, ' ').trim();
  return stripped ? stripped.split(/\s+/).length : 0;
}

function titleFromBody(body: string): string {
  const first = body.split('\n').find(line => line.trim()) ?? '';
  return first.replace(/^#+\s*/, '').trim().slice(0, 60) || 'Untitled note';
}

// ─── Page ───

export default function WriterPage() {
  const [notes, setNotes] = useState<Note[]>(loadNotes);
  const [selectedId, setSelectedId] = useState<string>(() => loadNotes()[0].id);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<ViewMode>('split');
  const isNarrow = useMediaQuery('(max-width: 900px)');

  useEffect(() => saveNotes(notes), [notes]);

  const selected = notes.find(note => note.id === selectedId) ?? notes[0];
  const effectiveMode: ViewMode = isNarrow && mode === 'split' ? 'write' : mode;

  const visibleNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter(
      note =>
        note.title.toLowerCase().includes(q) ||
        note.body.toLowerCase().includes(q),
    );
  }, [notes, query]);

  const updateBody = (body: string) => {
    setNotes(prev =>
      prev.map(note =>
        note.id === selected.id
          ? {...note, body, title: titleFromBody(body), updated: new Date().toISOString()}
          : note,
      ),
    );
  };

  const addNote = () => {
    const note: Note = {
      id: `n-${Date.now()}`,
      title: 'Untitled note',
      body: '# Untitled note\n\nStart writing…',
      updated: new Date().toISOString(),
    };
    setNotes(prev => [note, ...prev]);
    setSelectedId(note.id);
    setQuery('');
  };

  const deleteNote = () => {
    if (!selected) return;
    const remaining = notes.filter(note => note.id !== selected.id);
    setNotes(remaining);
    if (remaining.length > 0) setSelectedId(remaining[0].id);
  };

  const words = selected ? countWords(selected.body) : 0;
  const chars = selected ? selected.body.length : 0;
  const minutes = Math.max(1, Math.round(words / 200));

  const notesPanel = (
    <VStack gap={2} padding={3} height="100%">
      <HStack gap={2} vAlign="center">
        <StackItem size="fill">
          <Heading level={5}>Notes</Heading>
        </StackItem>
        <Badge label={String(notes.length)} variant="neutral" />
        <IconButton
          label="New note"
          tooltip="New note"
          size="sm"
          variant="ghost"
          icon={<Icon icon={PlusIcon} size="sm" color="inherit" />}
          onClick={addNote}
        />
      </HStack>
      <TextInput
        label="Search notes"
        isLabelHidden
        size="sm"
        placeholder="Search notes..."
        startIcon={MagnifyingGlassIcon}
        value={query}
        onChange={setQuery}
      />
      <StackItem size="fill" style={{minHeight: 0, overflowY: 'auto'}}>
        <List density="compact" hasDividers={false}>
          {visibleNotes.map(note => (
            <ListItem
              key={note.id}
              label={note.title}
              description={<Timestamp value={note.updated} format="date" />}
              isSelected={note.id === selected?.id}
              onClick={() => setSelectedId(note.id)}
              startContent={
                <Icon icon={DocumentTextIcon} size="sm" color="secondary" />
              }
            />
          ))}
        </List>
        {visibleNotes.length === 0 && (
          <Text type="supporting" color="secondary">
            No notes match “{query}”.
          </Text>
        )}
      </StackItem>
    </VStack>
  );

  if (!selected) {
    return (
      <Layout
        height="fill"
        start={<LayoutPanel width={280} hasDivider padding={0}>{notesPanel}</LayoutPanel>}
        content={
          <LayoutContent>
            <EmptyState
              icon={<Icon icon={DocumentTextIcon} size="lg" />}
              title="No notes"
              description="Create a note to start writing."
              actions={<Button label="New note" variant="primary" onClick={addNote} />}
            />
          </LayoutContent>
        }
      />
    );
  }

  const editor = (
    <TextArea
      label="Note text (Markdown)"
      isLabelHidden
      value={selected.body}
      onChange={updateBody}
      rows={12}
      size="lg"
      containerStyle={styles.textAreaContainer}
      controlStyle={styles.textAreaControl}
      containerClassName="writer-editor"
    />
  );

  const preview = (
    <Markdown headingLevelStart={2} contentWidth="100%">
      {selected.body}
    </Markdown>
  );

  return (
    <div style={styles.root} data-writer-mode={effectiveMode} data-note-count={notes.length}>
      <style>{WRITER_CSS}</style>
      <Layout
        height="fill"
        start={
          isNarrow ? undefined : (
            <LayoutPanel width={280} hasDivider padding={0} isScrollable={false}>
              {notesPanel}
            </LayoutPanel>
          )
        }
        header={
          <LayoutHeader hasDivider>
            <HStack gap={3} vAlign="center" wrap="wrap">
              <StackItem size="fill">
                <VStack gap={0}>
                  <Heading level={4}>{selected.title}</Heading>
                  <Text type="supporting" color="secondary">
                    Edited <Timestamp value={selected.updated} format="relative" />
                  </Text>
                </VStack>
              </StackItem>
              <SegmentedControl
                label="View mode"
                size="sm"
                value={effectiveMode}
                onChange={value => setMode(value as ViewMode)}>
                <SegmentedControlItem
                  value="write"
                  label="Write"
                  icon={<Icon icon={PencilIcon} size="sm" color="inherit" />}
                />
                <SegmentedControlItem
                  value="split"
                  label="Split"
                  isDisabled={isNarrow}
                  icon={<Icon icon={ViewColumnsIcon} size="sm" color="inherit" />}
                />
                <SegmentedControlItem
                  value="preview"
                  label="Preview"
                  icon={<Icon icon={EyeIcon} size="sm" color="inherit" />}
                />
              </SegmentedControl>
              <IconButton
                label="Delete note"
                tooltip="Delete note"
                size="sm"
                variant="ghost"
                icon={<Icon icon={TrashIcon} size="sm" color="inherit" />}
                onClick={deleteNote}
              />
            </HStack>
          </LayoutHeader>
        }
        content={
          <LayoutContent padding={4} isScrollable={false}>
            <HStack gap={4} style={styles.editorFill}>
              {effectiveMode !== 'preview' && (
                <StackItem size="fill" style={styles.pane}>
                  {editor}
                </StackItem>
              )}
              {effectiveMode === 'split' && <Divider orientation="vertical" />}
              {effectiveMode !== 'write' && (
                <StackItem size="fill" style={styles.pane} data-testid="writer-preview">
                  {preview}
                </StackItem>
              )}
            </HStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <HStack gap={4} vAlign="center">
              <Text type="supporting" color="secondary" data-testid="writer-words">
                {words} words
              </Text>
              <Text type="supporting" color="secondary">
                {chars} characters
              </Text>
              <Text type="supporting" color="secondary">
                ~{minutes} min read
              </Text>
              <StackItem size="fill" />
              <Text type="supporting" color="secondary">
                Markdown · saved in this browser
              </Text>
            </HStack>
          </LayoutFooter>
        }
      />
    </div>
  );
}
