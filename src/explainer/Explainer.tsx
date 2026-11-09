/**
 * How a chat writes its answer – a visual explainer of text generation.
 *
 * Left: what the person sees (a chat window). Right: what happens behind it,
 * as six stages. The data is a real recording from a small chat model
 * (see data.ts), replayed token by token.
 *
 * DOM contract on the root: data-trace, data-stage, data-step, data-temperature,
 * data-answer-length. Bar rows carry data-chosen="true" for the picked token.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { Theme } from "@astryxdesign/core/theme";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import { HStack, VStack, Stack, StackItem } from "@astryxdesign/core/Layout";
import { Text, Heading } from "@astryxdesign/core/Text";
import { Selector } from "@astryxdesign/core/Selector";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Stepper, Step } from "@astryxdesign/core/Stepper";
import { Token } from "@astryxdesign/core/Token";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Section } from "@astryxdesign/core/Section";
import { Divider } from "@astryxdesign/core/Divider";
import { Switch } from "@astryxdesign/core/Switch";
import { Kbd } from "@astryxdesign/core/Kbd";
import { Icon } from "@astryxdesign/core/Icon";
import { Avatar } from "@astryxdesign/core/Avatar";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Banner } from "@astryxdesign/core/Banner";
import { Spinner } from "@astryxdesign/core/Spinner";
import {
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatSystemMessage,
} from "@astryxdesign/core/Chat";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ForwardIcon,
  PauseIcon,
  PlayIcon,
} from "@heroicons/react/24/outline";

import { themes, defaultThemeSlug } from "../astryx-themes";
import {
  DATA,
  answerParts,
  finalAnswer,
  END_THINK,
  classifyPrompt,
  formatPercent,
  isEos,
  visible,
  splitTurns,
  getTrace,
  leadingTokens,
  modelName,
  SPECIAL,
  type Part,
  type TokenInfo,
  type Trace,
  type TraceFile,
} from "./data";
import { useLiveModel } from "./live/useLiveModel";
import { LIVE_MAX_NEW, LIVE_TEMPS, LIVE_TOPK } from "./live/config";

// ─── Constants ───

const STAGES = [
  { label: "One text", description: "Chat is joined" },
  { label: "Tokens", description: "Text is split" },
  { label: "Score", description: "Chance of each token" },
  { label: "Pick & append", description: "Draw one, add it, repeat" },
  { label: "Stop", description: "End-of-turn token" },
] as const;

const STAGE = {
  template: 0,
  tokens: 1,
  score: 2,
  pick: 3, // the token is drawn and appended in the same step
  stop: 4,
} as const;

const PART_COLOR: Record<
  Part,
  "purple" | "gray" | "blue" | "default" | "green"
> = {
  special: "purple",
  role: "default",
  system: "gray",
  user: "blue",
  answer: "green",
};

const PART_LABEL: Record<Part, string> = {
  special: "Template marker",
  role: "Role name",
  system: "System instruction",
  user: "Your question",
  answer: "Generated answer",
};

const PLAY_INTERVAL_MS = 650;
const CONTEXT_TAIL = 16; // last tokens shown in the "Text so far" strip
const SHOWN = 5; // candidates shown as bars (the recording holds the top 10)
/** Example questions offered for the live model. */
const LIVE_EXAMPLES = DATA.questions.map((q) => q.question);
const DEFAULT_T = "0.7";

/** What each temperature does, in plain words. */
const TEMPERATURE_NOTE: Record<string, string> = {
  "0": "Temperature 0: no lottery – the top token always wins, so the answer is the same every time.",
  "0.3": "Low temperature: the favourite gets even more of the chance, so the answer is very predictable.",
  "0.7": "A common default: mostly the favourite, sometimes another likely token.",
  "1": "Temperature 1: the model's own chances, unchanged.",
  "1.5": "High temperature: the chances spread out and unlikely tokens get picked, so the text turns random.",
};

const styles: Record<string, CSSProperties> = {
  root: {
    height: "100dvh",
    width: "100%",
    background: "var(--color-background-body)",
  },
  body: { minHeight: 0 },
  chatPanel: { minHeight: 0, minWidth: 0 },
  // position: relative keeps visually-hidden labels (absolute) inside the scroller
  chatScroll: { minHeight: 0, overflowY: "auto", position: "relative" },
  stagePanel: { minHeight: 0, minWidth: 0 },
  stageScroll: { minHeight: 0, overflowY: "auto", position: "relative" },
  tokenWrap: { rowGap: "var(--spacing-1)" },
  barLabel: { width: 150, flexShrink: 0, overflow: "hidden" },
  runLabel: { width: 64, flexShrink: 0 },
  barValue: { minWidth: 0 },
  caret: { opacity: 0.6 },
  // keep the model's new lines (poems) in the chat and the comparison
  keepLines: { whiteSpace: "pre-line" },
};

// ─── State ───

interface View {
  trace: number;
  /** temperature key; each temperature is a separate recorded run */
  temp: string;
  stage: number;
  /** index of the token being generated (0-based); at "pick" it has just been added */
  step: number;
}

const START: View = { trace: 0, temp: DEFAULT_T, stage: STAGE.template, step: 0 };

function nextView(v: View, trace: Trace): View {
  const last = trace.steps.length - 1;
  switch (v.stage) {
    case STAGE.template:
      return { ...v, stage: STAGE.tokens };
    case STAGE.tokens:
      return { ...v, stage: STAGE.score, step: 0 };
    case STAGE.score:
      return { ...v, stage: STAGE.pick };
    case STAGE.pick:
      return v.step < last && !isEos(trace.steps[v.step].chosen, trace.eosId)
        ? { ...v, stage: STAGE.score, step: v.step + 1 }
        : { ...v, stage: STAGE.stop };
    default:
      return v;
  }
}

function prevView(v: View): View {
  switch (v.stage) {
    case STAGE.tokens:
      return { ...v, stage: STAGE.template };
    case STAGE.score:
      return v.step === 0
        ? { ...v, stage: STAGE.tokens }
        : { ...v, stage: STAGE.pick, step: v.step - 1 };
    case STAGE.pick:
      return { ...v, stage: STAGE.score };
    case STAGE.stop:
      return { ...v, stage: STAGE.pick };
    default:
      return v;
  }
}

/** Jump to "token picked and appended" for the next token (or Stop). */
function nextTokenView(v: View, trace: Trace): View {
  if (v.stage < STAGE.score) return { ...v, stage: STAGE.pick, step: 0 };
  if (v.stage === STAGE.stop) return v;
  if (v.stage === STAGE.score) return { ...v, stage: STAGE.pick };
  return nextView(v, trace).stage === STAGE.stop
    ? { ...v, stage: STAGE.stop }
    : { ...v, stage: STAGE.pick, step: v.step + 1 };
}

/** How many generated tokens the chat window shows in this view. */
function shownCount(v: View, trace: Trace): number {
  if (v.stage < STAGE.score) return 0;
  if (v.stage === STAGE.stop) return trace.steps.length;
  return v.stage === STAGE.pick ? v.step + 1 : v.step;
}

// ─── Small views ───

function TokenChip({
  text,
  part,
  id,
  showId,
  size = "sm",
}: {
  text: string;
  part: Part;
  id?: number;
  showId?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const label =
    showId && id !== undefined ? `${visible(text)} · ${id}` : visible(text);
  return (
    <Token
      label={label}
      size={size}
      color={PART_COLOR[part]}
      description={PART_LABEL[part]}
    />
  );
}

function Legend({ parts }: { parts: Part[] }) {
  return (
    <HStack gap={3} wrap="wrap" vAlign="center">
      {parts.map((p) => (
        <HStack key={p} gap={1} vAlign="center">
          <Token label={PART_LABEL[p]} size="md" color={PART_COLOR[p]} />
        </HStack>
      ))}
      <Text type="supporting" color="secondary">
        ↵ = new line
      </Text>
    </HStack>
  );
}

function ProbabilityBars({
  data,
  trace,
  step,
  temperature,
  isPicked,
}: {
  data: TraceFile;
  trace: Trace;
  step: number;
  temperature: string;
  isPicked: boolean;
}) {
  const s = trace.steps[step];
  const probs = s.probs[temperature].slice(0, SHOWN);
  // A picked token outside the top 5 gets its own row – only once it is picked,
  // so the Score step does not give the pick away.
  const chosenOutside = isPicked && (s.rank === null || s.rank > SHOWN);
  const extra = chosenOutside ? s.chosenProb[temperature] : 0;
  const topSum = probs.reduce((a, b) => a + b, 0);
  const rest = Math.max(0, 1 - topSum - extra);
  const others = data.vocabSize - SHOWN - (chosenOutside ? 1 : 0);

  const row = (
    key: string,
    label: string,
    p: number,
    chosen: boolean,
    isEnd: boolean,
  ) => (
    <HStack
      key={key}
      gap={3}
      vAlign="center"
      data-chosen={chosen ? "true" : undefined}
    >
      <StackItem style={styles.barLabel}>
        <Token
          label={label}
          size="md"
          color={chosen && isPicked ? "green" : isEnd ? "purple" : "default"}
        />
      </StackItem>
      <StackItem size="fill" style={styles.barValue}>
        <ProgressBar
          label={`Probability of ${label}`}
          isLabelHidden
          value={p * 100}
          max={100}
          hasValueLabel
          formatValueLabel={() => formatPercent(p)}
          variant={!isPicked ? "accent" : chosen ? "success" : "neutral"}
        />
      </StackItem>
    </HStack>
  );

  return (
    <VStack gap={1.5}>
      {s.candidates.slice(0, SHOWN).map((c, i) =>
        row(
          String(c.id),
          visible(c.text),
          probs[i],
          isPicked && c.id === s.chosen.id,
          isEos(c, trace.eosId),
        ),
      )}
      {chosenOutside &&
        row(
          "outside",
          visible(s.chosen.text),
          s.chosenProb[temperature],
          isPicked,
          false,
        )}
      <HStack gap={3} vAlign="center">
        <StackItem style={styles.barLabel}>
          <Text type="supporting" color="secondary">
            {others.toLocaleString("en")} other tokens
          </Text>
        </StackItem>
        <StackItem size="fill" style={styles.barValue}>
          <ProgressBar
            label="Probability of all other tokens"
            isLabelHidden
            value={rest * 100}
            max={100}
            hasValueLabel
            formatValueLabel={() => formatPercent(rest)}
            variant="neutral"
            isDisabled
          />
        </StackItem>
      </HStack>
    </VStack>
  );
}

function ContextStrip({
  trace,
  upto,
  withSlot,
}: {
  trace: Trace;
  upto: number;
  withSlot: boolean;
}) {
  const promptParts = classifyPrompt(trace.promptTokens);
  const all = [
    ...trace.promptTokens.map((t, i) => ({ text: t.text, part: promptParts[i] })),
    ...trace.steps
      .slice(0, upto)
      .filter((s) => !isEos(s.chosen, trace.eosId))
      .map((s) => ({
        text: s.chosen.text,
        part: (SPECIAL.has(s.chosen.text) ? "special" : "answer") as Part,
      })),
  ];
  const shown = all.slice(-CONTEXT_TAIL);
  return (
    <HStack gap={1} wrap="wrap" vAlign="center" style={styles.tokenWrap}>
      <Text type="supporting" color="secondary">
        … {all.length - shown.length} earlier tokens
      </Text>
      {shown.map((t, i) => (
        <TokenChip key={i} text={t.text} part={t.part} size="md" />
      ))}
      {withSlot && (
        <Token
          label="next token"
          size="md"
          color="orange"
          description="The next token, not chosen yet"
        />
      )}
    </HStack>
  );
}

// ─── Stage content ───

function StageBody({
  data,
  view,
  trace,
  questionIndex,
  temperature,
  setTemperature,
  showIds,
  setShowIds,
}: {
  data: TraceFile;
  view: View;
  trace: Trace;
  questionIndex: number;
  temperature: string;
  setTemperature: (t: string) => void;
  showIds: boolean;
  setShowIds: (b: boolean) => void;
}) {
  const s = trace.steps[Math.min(view.step, trace.steps.length - 1)];
  const generatedCount = trace.steps.filter((x) => !isEos(x.chosen, trace.eosId)).length;
  const name = modelName(data);
  const hasSystem = trace.promptTokens.some((t, i) => t.text === "system" && trace.promptTokens[i - 1]?.text === "<|im_start|>");
  const hasThink = trace.promptTokens.some((t) => t.text === "<think>");
  const notTop = trace.steps.filter((x) => x.rank !== 1).length;

  const temperatureControl = (
    <HStack gap={2} vAlign="center">
      <Text weight="semibold">Temperature</Text>
      <SegmentedControl
        label="Temperature"
        size="sm"
        value={temperature}
        onChange={setTemperature}
      >
        {data.temperatures.map((t) => (
          <SegmentedControlItem key={t} value={String(t)} label={String(t)} />
        ))}
      </SegmentedControl>
    </HStack>
  );

  switch (view.stage) {
    case STAGE.template:
      return (
        <VStack gap={4}>
          <Text>
            The model does not see chat bubbles. The app glues the conversation
            into <b>one long text</b>, with markers that say who is talking. It
            ends with the start of an <b>assistant</b> turn, so the most natural
            thing to write next is the answer.
          </Text>
          <TemplateView trace={trace} />
          {hasThink && (
            <Text type="supporting" color="secondary">
              {name} can think out loud before it answers. The app switched
              that off, so the template already holds an empty thinking block
              (<b>&lt;think&gt;&lt;/think&gt;</b>) and the answer comes straight
              after it.
            </Text>
          )}
          <Text type="supporting" color="secondary">
            {hasSystem && "The system instruction was added by the app, not typed by you. "}
            Each model family has its own template; this is the one {name} was
            trained with.
          </Text>
        </VStack>
      );

    case STAGE.tokens:
      return (
        <VStack gap={4}>
          <Text>
            Next the text is cut into <b>tokens</b> – whole words, pieces of
            words and punctuation. Each token is a number in the model's
            vocabulary of <b>{data.vocabSize.toLocaleString("en")}</b> tokens.
            The model only ever works with these numbers.
          </Text>
          <HStack gap={3} vAlign="center">
            <Text weight="semibold">{trace.promptTokens.length} tokens</Text>
            <Switch
              label="Show token numbers"
              value={showIds}
              onChange={setShowIds}
            />
          </HStack>
          <TemplateView trace={trace} asTokens showIds={showIds} />
          <Legend parts={hasSystem ? ["special", "role", "system", "user"] : ["special", "role", "user"]} />
          <Text type="supporting" color="secondary">
            {hasSystem
              ? "Look for words split in two, like “H” + “ugging” or “ass” + “istant”."
              : "Common words are one token each; rare or long words are split into pieces."}
          </Text>
        </VStack>
      );

    case STAGE.score:
    case STAGE.pick: {
      const isPicked = view.stage === STAGE.pick;
      const isEnd = isEos(s.chosen, trace.eosId);
      const rankText =
        s.rank === 1
          ? "the most likely token"
          : s.rank === null
            ? `a rare token outside the top ${data.topK}`
            : `only number ${s.rank} on the list`;
      return (
        <VStack gap={4}>
          <Text>
            {view.stage === STAGE.score && (
              <>
                The model reads all the tokens so far and gives <b>every</b>{" "}
                token in its vocabulary a chance of coming next. Here are the
                top {SHOWN} for token {view.step + 1}.
              </>
            )}
            {isPicked && (
              <>
                {temperature === "0" ? (
                  <>
                    At temperature 0 there is no lottery: the app always takes
                    the most likely token, <b>“{visible(s.chosen.text)}”</b>.{" "}
                  </>
                ) : (
                  <>
                    The app draws one token at random, using these chances like
                    a weighted lottery. It picked{" "}
                    <b>“{visible(s.chosen.text)}”</b> (
                    {formatPercent(s.chosenProb[temperature])} chance) –{" "}
                    {rankText}.{" "}
                  </>
                )}
                {isEnd
                  ? "That is the end-of-turn marker, so nothing is added – the answer is finished."
                  : s.chosen.text === END_THINK
                  ? `That is the end-of-thinking marker: everything before it was the model's draft, which chat apps hide or fold away. The answer the person sees starts with token ${view.step + 2}.`
                  : `It is added to the end of the text and shown in the chat, and the whole text goes back into the model to score token ${view.step + 2}. One token at a time – that is the “typing” you see.`}
              </>
            )}
          </Text>
          <Card padding={3}>
            <VStack gap={2}>
              <Text type="label" color="secondary">
                Text so far
              </Text>
              <ContextStrip
                trace={trace}
                upto={isPicked ? view.step + 1 : view.step}
                withSlot={!isPicked}
              />
              <Legend parts={["special", "role", "user", "answer"]} />
            </VStack>
          </Card>
          <Card padding={3}>
            <VStack gap={3}>
              <HStack gap={3} vAlign="center" wrap="wrap">
                <StackItem size="fill">
                  <Text type="label" color="secondary">
                    Chances for token {view.step + 1}
                  </Text>
                </StackItem>
                {temperatureControl}
              </HStack>
              <ProbabilityBars
                data={data}
                trace={trace}
                step={view.step}
                temperature={temperature}
                isPicked={isPicked}
              />
              <Text type="supporting" color="secondary">
                {TEMPERATURE_NOTE[temperature]} Changing it starts the answer
                again – each temperature is its own real run of the model.
              </Text>
            </VStack>
          </Card>
        </VStack>
      );
    }

    case STAGE.stop:
    default: {
      const eosStep = trace.steps.find((x) => isEos(x.chosen, trace.eosId));
      return (
        <VStack gap={4}>
          {trace.finished ? (
            <Text>
              This time the model picked the special <b>end-of-turn</b> token{" "}
              <Token label={eosStep?.chosen.text ?? "<|im_end|>"} size="md" color="purple" />
              {eosStep && (
                <> ({formatPercent(eosStep.chosenProb[temperature])} chance)</>
              )}
              . The app stops asking for more and does not show that marker. The
              answer is done.
            </Text>
          ) : (
            <Text>
              The app stopped at its length limit of {trace.steps.length} tokens
              before the model chose to end.
            </Text>
          )}
          <Card padding={3}>
            <VStack gap={2}>
              <Text>
                <b>{trace.steps.length}</b> passes through the model:{" "}
                {generatedCount} tokens of answer
                {trace.finished && " plus the end-of-turn token"}.
              </Text>
              <Text>
                <b>{notTop}</b> of {trace.steps.length} picks were not the
                single most likely token.
              </Text>
              <Text>
                The question plus the answer is now{" "}
                <b>{trace.promptTokens.length + trace.steps.length}</b> tokens.
                If you ask a follow-up, all of it is sent again – the model has
                no memory between turns.
              </Text>
            </VStack>
          </Card>
          <Card padding={3}>
            <VStack gap={3}>
              <Text type="label" color="secondary">
                The same question at every temperature – real runs of the model
              </Text>
              {data.temperatures.map((t) => {
                const key = String(t);
                const run = data.questions[questionIndex].runs[key];
                const isCurrent = key === temperature;
                return (
                  <HStack key={key} gap={3} vAlign="start" data-run={key}>
                    <StackItem style={styles.runLabel}>
                      <Button
                        label={`Temperature ${key}`}
                        size="sm"
                        variant={isCurrent ? "primary" : "secondary"}
                        onClick={() => setTemperature(key)}
                      >
                        {key}
                      </Button>
                    </StackItem>
                    <StackItem size="fill" style={styles.barValue}>
                      <Text
                        color={isCurrent ? "primary" : "secondary"}
                        style={styles.keepLines}
                      >
                        {finalAnswer(run.answer).trim()}
                        {run.answer.includes(END_THINK) && (
                          <Text type="supporting" color="secondary">
                            {" "}(after a draft closed with {END_THINK})
                          </Text>
                        )}
                        {!run.finished && " … (stopped at the length limit)"}
                      </Text>
                    </StackItem>
                  </HStack>
                );
              })}
              <Text type="supporting" color="secondary">
                Pick a temperature to watch that answer being written.
              </Text>
            </VStack>
          </Card>
          <Text type="supporting" color="secondary">
            Big chat models work exactly the same way. They have hundreds of
            billions of parameters instead of {data.params ?? "a few"}
            {data.params ? "" : " million"}, so their guesses are much better –
            but they still write one token at a time.
          </Text>
        </VStack>
      );
    }
  }
}

/** Card tint per chat role (full contour, not an edge stripe). */
const ROLE_CARD: Record<string, "default" | "blue" | "green"> = {
  system: "default",
  user: "blue",
  assistant: "green",
};

const ROLE_NOTE: Record<string, string> = {
  system: "instruction added by the app",
  user: "your question",
  assistant: "the answer starts here",
};

/**
 * The chat template, one card per turn: template markers small, the message
 * text big. As plain text (stage 1) or split into token chips (stage 2).
 */
function TemplateView({
  trace,
  asTokens = false,
  showIds = false,
}: {
  trace: Trace;
  asTokens?: boolean;
  showIds?: boolean;
}) {
  const turns = splitTurns(trace.promptTokens);
  const lead = leadingTokens(trace.promptTokens);
  const markers = (tokens: TokenInfo[], role: string) =>
    tokens.map((t, i) =>
      SPECIAL.has(t.text) ? (
        <Token
          key={i}
          label={showIds ? `${t.text} · ${t.id}` : t.text}
          size="sm"
          color="purple"
          description={PART_LABEL.special}
        />
      ) : asTokens || t.text.trim() ? (
        <Token
          key={i}
          label={showIds ? `${visible(t.text)} · ${t.id}` : visible(t.text)}
          size="sm"
          color={t.text.includes("\n") && !t.text.trim() ? "purple" : "default"}
          description={t.text.trim() ? `Role name: ${role}` : "New line"}
        />
      ) : null,
    );
  const contentPart = (role: string): Part =>
    role === "system" ? "system" : role === "user" ? "user" : "answer";

  return (
    <VStack gap={3}>
      {lead.length > 0 && (
        <HStack gap={1} vAlign="center" wrap="wrap">
          {markers(lead, "")}
          <Text type="supporting" color="secondary">
            start of the whole text
          </Text>
        </HStack>
      )}
      {turns.map((turn, i) => (
        <Card key={i} variant={ROLE_CARD[turn.role] ?? "default"} padding={3}>
          <VStack gap={2}>
            <HStack gap={1} vAlign="center" wrap="wrap">
              {asTokens ? (
                markers(turn.header, turn.role)
              ) : (
                <>
                  {markers(turn.header.slice(0, 1), turn.role)}
                  <Token label={turn.role} size="sm" description="Role name" />
                  {markers(
                    turn.header.slice(1).filter((t) => SPECIAL.has(t.text)),
                    turn.role,
                  )}
                </>
              )}
              <Text type="supporting" color="secondary">
                {ROLE_NOTE[turn.role] ?? ""}
              </Text>
            </HStack>
            {turn.content.length > 0 &&
              (asTokens ? (
                <HStack gap={1} wrap="wrap" style={styles.tokenWrap}>
                  {turn.content.map((t, j) => (
                    <TokenChip
                      key={j}
                      text={t.text}
                      part={contentPart(turn.role)}
                      id={t.id}
                      showId={showIds}
                      size="lg"
                    />
                  ))}
                </HStack>
              ) : (
                <Text type="large" weight="medium">
                  {turn.content.map((t) => t.text).join("")}
                </Text>
              ))}
            {turn.role === "assistant" && (
              <Text type="supporting" color="secondary">
                Nothing here yet – the model writes the answer from this point,
                one token at a time.
              </Text>
            )}
            {turn.footer.length > 0 && (
              <HStack gap={1} vAlign="center" wrap="wrap">
                {markers(turn.footer, turn.role)}
              </HStack>
            )}
          </VStack>
        </Card>
      ))}
    </VStack>
  );
}

// ─── Live model setup ───

const MB = (bytes: number) => `${Math.round(bytes / 1e6).toLocaleString("en")} MB`;

/**
 * Right-hand panel before a live answer exists: how the live mode works, the
 * download button, then the question box. The chat on the left mirrors it.
 */
function LiveSetup({
  live,
  question,
  setQuestion,
  hasAnswers,
  onBack,
}: {
  live: ReturnType<typeof useLiveModel>;
  question: string;
  setQuestion: (q: string) => void;
  hasAnswers: boolean;
  onBack: () => void;
}) {
  // Check for WebGPU before offering a 1.3 GB download.
  const [gpu, setGpu] = useState<"checking" | "yes" | "no">("checking");
  useEffect(() => {
    const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };
    if (!nav.gpu) {
      setGpu("no");
      return;
    }
    nav.gpu
      .requestAdapter()
      .then((a) => setGpu(a ? "yes" : "no"))
      .catch(() => setGpu("no"));
  }, []);
  const { status, download, generation, device } = live;
  const downloaded = download.total > 0 && download.loaded >= download.total;
  const tIndex = generation ? LIVE_TEMPS.indexOf(generation.temperature) : 0;
  const overall = generation
    ? ((tIndex + generation.step / LIVE_MAX_NEW) / LIVE_TEMPS.length) * 100
    : 0;
  const canAsk = status === "ready" && question.trim().length > 0;

  return (
          <VStack gap={4} data-live-status={status}>
            <Text>
              LFM3-1.7B is a chat model from Liquid AI with <b>1.7 billion</b>{" "}
              parameters – about 13 times bigger than the recorded
              SmolLM2 model. It runs entirely on this computer: the browser
              downloads it once (about 1.3 GB, kept in the browser's cache) and
              your question never leaves this page. It needs a browser with
              WebGPU (Chrome or Edge) to use the graphics card.
            </Text>

            <Card variant="blue" padding={3} data-testid="live-how">
              <VStack gap={2}>
                <Heading level={4}>How the live mode works: first real answers, then the replay</Heading>
                <Text>
                  <b>1. The model writes the real answers first.</b> When you
                  press the button, LFM3 answers your question {LIVE_TEMPS.length}{" "}
                  times, once per temperature ({LIVE_TEMPS.join(", ")}). This
                  is ordinary generation, one token at a time, exactly as in a
                  chat app.
                </Text>
                <Text>
                  <b>2. Every step is written down.</b> Before each token is
                  chosen, the app saves the model's real chances for the top{" "}
                  {LIVE_TOPK} tokens (out of all 128,000) and then the token
                  that was drawn with those chances. The model continues from
                  that token, so the saved steps add up to its real answer.
                </Text>
                <Text>
                  <b>3. The chat replays that run.</b> The explanation then
                  plays the saved steps back as slowly as you like – the
                  template, the tokens, the chances and every pick. Nothing is
                  recomputed or made up: the chat shows the answer the model
                  really wrote, and each bar is the chance it really gave.
                </Text>
                <Text type="supporting" color="secondary">
                  Why record first instead of showing it live? The model is fast
                  (about 10–30 tokens a second), far too fast to follow. With
                  the run saved, you can step back and forth, and switch
                  temperatures to compare real answers side by side.
                </Text>
              </VStack>
            </Card>

            {status === "idle" && gpu === "no" && (
              <Banner
                status="warning"
                title="Warning: this browser has no WebGPU"
                description="The live model needs the graphics card through WebGPU. Open this page in Chrome or Edge – or use the recorded SmolLM2 examples here."
              />
            )}

            {status === "idle" && (
              <HStack gap={3} vAlign="center" wrap="wrap">
                <Button
                  label="Download and start the model"
                  variant="primary"
                  isDisabled={gpu !== "yes"}
                  onClick={live.load}
                />
                <Text type="supporting" color="secondary">
                  {gpu === "yes"
                    ? "WebGPU found – the model will run on the graphics card."
                    : gpu === "checking"
                      ? "Checking for WebGPU…"
                      : "WebGPU is missing."}
                </Text>
              </HStack>
            )}

            {status === "loading" && (
              <VStack gap={2}>
                {!downloaded ? (
                  <ProgressBar
                    label={
                      download.total
                        ? `Downloading the model: ${MB(download.loaded)} of ${MB(download.total)}`
                        : "Starting the download…"
                    }
                    value={download.total ? (download.loaded / download.total) * 100 : 0}
                    max={100}
                    variant="accent"
                  />
                ) : (
                  <Spinner label="Loading the model into memory…" />
                )}
                {device && (
                  <Text type="supporting" color="secondary">
                    Running on the graphics card (WebGPU).
                  </Text>
                )}
              </VStack>
            )}

            {status === "error" && (
              <Banner
                status="error"
                title="The model could not start"
                description={live.error}
                endContent={<Button label="Try again" size="sm" onClick={live.load} />}
              />
            )}

            {(status === "ready" || status === "generating") && (
              <VStack gap={3}>
                {live.error && (
                  <Banner status="error" title="Generation failed" description={live.error} />
                )}
                <Text type="supporting" color="secondary">
                  Model ready on the graphics card (WebGPU).
                </Text>
                <TextArea
                  label="Your question"
                  value={question}
                  onChange={(v) => setQuestion(v)}
                  isDisabled={status === "generating"}
                  rows={2}
                />
                <HStack gap={2} wrap="wrap" vAlign="center">
                  <Text type="supporting" color="secondary">
                    Examples:
                  </Text>
                  {LIVE_EXAMPLES.map((q) => (
                    <Button
                      key={q}
                      label={q}
                      size="sm"
                      variant="secondary"
                      isDisabled={status === "generating"}
                      onClick={() => setQuestion(q)}
                    />
                  ))}
                </HStack>
                <Text type="supporting" color="secondary">
                  Tip: ask for a set length (“in two sentences”, “a haiku”) –
                  open questions often run past the {LIVE_MAX_NEW}-token limit.
                </Text>
                <HStack gap={2} wrap="wrap">
                  <Button
                    label={`Write the answer at ${LIVE_TEMPS.length} temperatures`}
                    variant="primary"
                    isDisabled={!canAsk}
                    onClick={() => live.ask(question.trim())}
                  />
                  {hasAnswers && status === "ready" && (
                    <Button label="Back to the explanation" variant="ghost" onClick={onBack} />
                  )}
                </HStack>
              </VStack>
            )}

            {status === "generating" && (
              <Card padding={3}>
                <VStack gap={3}>
                  <ProgressBar
                    label={
                      generation
                        ? `Temperature ${generation.temperature}: token ${generation.step}`
                        : "Reading the question…"
                    }
                    value={overall}
                    max={100}
                    variant="accent"
                  />
                  <Text type="supporting" color="secondary">
                    One answer per temperature ({LIVE_TEMPS.join(", ")}), up to{" "}
                    {LIVE_MAX_NEW} tokens each – you can watch them being
                    written in the chat on the left. For every token the app
                    records the model's top {LIVE_TOPK} chances and the token it
                    drew; the explanation then replays them step by step.
                  </Text>
                  <HStack>
                    <Button label="Cancel" size="sm" variant="ghost" onClick={live.cancel} />
                  </HStack>
                </VStack>
              </Card>
            )}
          </VStack>
  );
}

// ─── Page ───

export default function Explainer() {
  const [view, setView] = useState<View>(START);
  const live = useLiveModel();
  const [source, setSource] = useState<"recorded" | "live">("recorded");
  const [composing, setComposing] = useState(false);
  const [liveQuestionText, setLiveQuestionText] = useState(LIVE_EXAMPLES[0]);
  const liveCount = live.dataset?.questions.length ?? 0;
  const data: TraceFile =
    source === "live" && live.dataset && liveCount > 0 ? live.dataset : DATA;
  const showSetup = source === "live" && (composing || liveCount === 0);
  const dataRef = useRef(data);
  dataRef.current = data;
  const traceOf = (v: View) => getTrace(dataRef.current, v.trace, v.temp);
  const showSetupRef = useRef(showSetup);
  showSetupRef.current = showSetup;

  // A new live answer arrived: open it at the start of the explanation.
  const seenRef = useRef(0);
  useEffect(() => {
    if (liveCount > seenRef.current) {
      seenRef.current = liveCount;
      setComposing(false);
      setView((v) => ({ ...START, trace: liveCount - 1, temp: v.temp }));
    }
  }, [liveCount]);

  const chooseSource = (value: string) => {
    const next = value as "recorded" | "live";
    setIsPlaying(false);
    setSource(next);
    setComposing(false);
    setView((v) => ({
      ...START,
      temp: v.temp,
      trace: next === "live" ? Math.max(0, liveCount - 1) : 0,
    }));
  };
  const temperature = view.temp;
  const setTemperature = (t: string) => {
    setIsPlaying(false);
    setView((v) => ({
      ...v,
      temp: t,
      // A different temperature is a different run: restart the answer.
      stage: v.stage >= STAGE.score ? STAGE.score : v.stage,
      step: 0,
    }));
  };
  const [isPlaying, setIsPlaying] = useState(false);
  const [showIds, setShowIds] = useState(false);
  const isNarrow = useMediaQuery("(max-width: 900px)");
  const trace = traceOf(view);
  const atEnd = view.stage === STAGE.stop;
  const count = shownCount(view, trace);
  // Until "</think>" appears the app cannot know the text is a draft, so it
  // shows it as the answer; once the marker arrives the draft folds away.
  const { thinking, answer } = answerParts(trace, count);
  const isGenerating = view.stage >= STAGE.score && !atEnd;

  const next = useCallback(
    () =>
      setView((v) =>
        nextView(v, getTrace(dataRef.current, v.trace, v.temp)),
      ),
    [],
  );
  const back = useCallback(() => setView((v) => prevView(v)), []);

  useEffect(() => {
    if (!isPlaying) return;
    if (atEnd) {
      setIsPlaying(false);
      return;
    }
    const id = window.setTimeout(
      () => setView((v) => nextTokenView(v, traceOf(v))),
      PLAY_INTERVAL_MS,
    );
    return () => window.clearTimeout(id);
  }, [isPlaying, view, atEnd]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'input, textarea, [contenteditable="true"], [role="combobox"], [role="listbox"]',
        )
      )
        return;
      if (showSetupRef.current) return;
      if (e.key === "ArrowRight") {
        setIsPlaying(false);
        next();
      } else if (e.key === "ArrowLeft") {
        setIsPlaying(false);
        back();
      } else if (e.key === " " && !target.closest("button")) {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back]);

  const chooseTrace = (value: string) => {
    setIsPlaying(false);
    if (value === "new") {
      setComposing(true);
      return;
    }
    setComposing(false);
    setView((v) => ({ ...START, trace: Number(value), temp: v.temp }));
  };

  const progressText =
    view.stage < STAGE.score
      ? `Stage ${view.stage + 1} of ${STAGES.length}`
      : atEnd
        ? `Done – ${trace.steps.length} tokens`
        : `Token ${view.step + 1} of ${trace.steps.length}`;

  const questionPicker = (
    <Selector
      label="Question"
      isLabelHidden
      size="sm"
      variant="secondary"
      width={isNarrow ? "100%" : 330}
      value={showSetup ? "new" : String(view.trace)}
      onChange={chooseTrace}
      options={[
        ...(showSetup && liveCount === 0 ? [] : data.questions).map((t, i) => ({
          value: String(i),
          label: t.question,
        })),
        ...(source === "live"
          ? [{ value: "new", label: "Ask your own question…" }]
          : []),
      ]}
    />
  );

  const modelPicker = (
    <Selector
      label="Model"
      isLabelHidden
      size="sm"
      variant="secondary"
      width={isNarrow ? "100%" : 290}
      value={source}
      onChange={chooseSource}
      options={[
        { value: "recorded", label: "SmolLM2 135M – recorded" },
        { value: "live", label: "LFM3 1.7B – live in your browser" },
      ]}
    />
  );

  const chatPanel = (
    <Card height="100%" padding={0}>
      <VStack height="100%">
        <Section variant="muted" padding={3}>
          <VStack gap={0}>
            <Heading level={4}>What you see</Heading>
            <Text type="supporting" color="secondary">
              The chat window
            </Text>
          </VStack>
        </Section>
        <Divider />
        <StackItem size="fill" style={styles.chatScroll}>
          <VStack padding={3}>
            {showSetup ? (
              <ChatMessageList density="balanced">
                {liveQuestionText.trim() && (
                  <ChatMessage sender="user">
                    <ChatMessageBubble>{liveQuestionText.trim()}</ChatMessageBubble>
                  </ChatMessage>
                )}
                {live.status === "generating" ? (
                  <ChatMessage
                    sender="assistant"
                    avatar={<Avatar name="Assistant" size="md" />}
                  >
                    <ChatMessageBubble>
                      <Text style={styles.keepLines} data-testid="live-preview">
                        {live.generation?.answer || "…"}
                        <span style={styles.caret}>▍</span>
                      </Text>
                    </ChatMessageBubble>
                  </ChatMessage>
                ) : (
                  <ChatSystemMessage>
                    {live.status === "ready"
                      ? "Model ready – send the question from the panel on the right"
                      : live.status === "loading"
                        ? "Loading the model…"
                        : "The model is not loaded yet – start it on the right"}
                  </ChatSystemMessage>
                )}
                {live.status === "generating" && live.generation && (
                  <ChatSystemMessage>
                    Writing the answer at temperature {live.generation.temperature}
                  </ChatSystemMessage>
                )}
              </ChatMessageList>
            ) : (
            <ChatMessageList density="balanced">
              <ChatMessage sender="user">
                <ChatMessageBubble>{trace.question}</ChatMessageBubble>
              </ChatMessage>
              {view.stage < STAGE.score ? (
                <ChatSystemMessage>
                  Sent – waiting for the answer…
                </ChatSystemMessage>
              ) : (
                <ChatMessage
                  sender="assistant"
                  avatar={<Avatar name="Assistant" size="md" />}
                >
                  <ChatMessageBubble>
                    <VStack gap={2}>
                      {thinking !== null && (
                        <VStack gap={0} data-testid="chat-thinking">
                          <Text type="supporting" weight="semibold" color="secondary">
                            Thinking – a draft, which chat apps hide or fold away
                          </Text>
                          <Text type="supporting" color="secondary" style={styles.keepLines}>
                            {thinking}
                          </Text>
                        </VStack>
                      )}
                      <Text data-testid="chat-answer" style={styles.keepLines}>
                        {answer || (isGenerating ? "…" : "")}
                        {isGenerating && answer && (
                          <span style={styles.caret}>▍</span>
                        )}
                      </Text>
                    </VStack>
                  </ChatMessageBubble>
                </ChatMessage>
              )}
              {atEnd && (
                <ChatSystemMessage>
                  {trace.finished
                    ? "Answer complete"
                    : "Cut off – the app's length limit was reached"}
                </ChatSystemMessage>
              )}
            </ChatMessageList>
            )}
          </VStack>
        </StackItem>
        <Divider />
        <VStack padding={3}>
          <Text type="supporting" color="secondary">
            {showSetup
              ? "LFM3-1.7B (1.7 billion parameters) runs in this browser on the graphics card."
              : data.source === "live"
              ? `Written live in this browser by ${modelName(data)} (${data.params} parameters), then replayed here token by token from its real run.`
              : `Recorded from the real model ${modelName(data)} (${data.params} parameters) running on this computer.`}{" "}
            {!showSetup && " Every number in the explanation is its real output."}
          </Text>
        </VStack>
      </VStack>
    </Card>
  );

  const stagePanel = (
    <Card height="100%" padding={0}>
      <VStack height="100%">
        <VStack gap={3} paddingBlockEnd={3}>
          <Section variant="muted" padding={3}>
            <HStack gap={2} vAlign="center">
              <StackItem size="fill">
                <Heading level={4}>What happens behind it</Heading>
              </StackItem>
              <Text type="supporting" color="secondary" data-testid="progress">
                {showSetup ? "Run LFM3-1.7B in your browser" : progressText}
              </Text>
            </HStack>
          </Section>
          {!showSetup && (
          <VStack paddingInline={3}>
            <Stepper
              label="Stages of text generation"
              activeStep={view.stage}
              density="compact"
              onStepClick={(index) => {
                setIsPlaying(false);
                setView((v) => ({
                  ...v,
                  stage: index,
                  step:
                    index < STAGE.score
                      ? 0
                      : index === STAGE.stop
                        ? traceOf(v).steps.length - 1
                        : v.step,
                }));
              }}
            >
              {STAGES.map((s, i) => (
                <Step
                  key={s.label}
                  step={i}
                  label={s.label}
                  description={isNarrow ? undefined : s.description}
                />
              ))}
            </Stepper>
          </VStack>
          )}
        </VStack>
        <Divider />
        <StackItem size="fill" style={styles.stageScroll}>
          <VStack padding={4}>
            {showSetup ? (
              <LiveSetup
                live={live}
                question={liveQuestionText}
                setQuestion={setLiveQuestionText}
                hasAnswers={liveCount > 0}
                onBack={() => setComposing(false)}
              />
            ) : (
            <StageBody
              data={data}
              view={view}
              trace={trace}
              questionIndex={view.trace}
              temperature={temperature}
              setTemperature={setTemperature}
              showIds={showIds}
              setShowIds={setShowIds}
            />
            )}
          </VStack>
        </StackItem>
        {!showSetup && <Divider />}
        {!showSetup && (
        <HStack gap={2} padding={3} vAlign="center" wrap="wrap">
          <Button
            label="Back"
            icon={<Icon icon={ChevronLeftIcon} size="sm" />}
            isDisabled={view.stage === STAGE.template}
            onClick={() => {
              setIsPlaying(false);
              back();
            }}
          />
          <Button
            label="Next step"
            variant="primary"
            icon={<Icon icon={ChevronRightIcon} size="sm" />}
            isDisabled={atEnd}
            onClick={() => {
              setIsPlaying(false);
              next();
            }}
          />
          <Button
            label="Next token"
            icon={<Icon icon={ForwardIcon} size="sm" />}
            isDisabled={atEnd}
            onClick={() => {
              setIsPlaying(false);
              setView((v) => nextTokenView(v, traceOf(v)));
            }}
          />
          <Button
            label={isPlaying ? "Pause" : "Play"}
            icon={<Icon icon={isPlaying ? PauseIcon : PlayIcon} size="sm" />}
            isDisabled={atEnd}
            onClick={() => setIsPlaying((p) => !p)}
          />
          <Button
            label="Start over"
            variant="ghost"
            icon={<Icon icon={ArrowPathIcon} size="sm" />}
            onClick={() => {
              setIsPlaying(false);
              setView({ ...START, trace: view.trace, temp: view.temp });
            }}
          />
          <StackItem size="fill" />
          {!isNarrow && (
            <HStack gap={1} vAlign="center">
              <Kbd keys="left" />
              <Kbd keys="right" />
              <Text type="supporting" color="secondary">
                step,
              </Text>
              <Kbd keys="space" />
              <Text type="supporting" color="secondary">
                play
              </Text>
            </HStack>
          )}
        </HStack>
        )}
      </VStack>
    </Card>
  );

  return (
    <Theme theme={themes[defaultThemeSlug]} mode="light">
      <VStack
        style={styles.root}
        data-trace={view.trace}
        data-stage={view.stage}
        data-step={view.step}
        data-temperature={temperature}
        data-answer-length={answer.length}
        data-playing={isPlaying ? "true" : "false"}
        data-source={source}
        data-live-status={live.status}
      >
        <TopNav
          label="Explainer controls"
          heading={<TopNavHeading heading="How a chat writes its answer" />}
          endContent={
            <HStack gap={2} vAlign="center" wrap="wrap">
              {!isNarrow && modelPicker}
              {!isNarrow && questionPicker}
            </HStack>
          }
        />
        <Divider />
        <StackItem size="fill" style={styles.body}>
          <Stack
            gap={4}
            padding={4}
            height="100%"
            direction={isNarrow ? "vertical" : "horizontal"}
            style={isNarrow ? { overflowY: "auto" } : undefined}
          >
            {isNarrow && modelPicker}
            {isNarrow && questionPicker}
            <StackItem
              size={isNarrow ? undefined : "fill"}
              style={{
                ...styles.chatPanel,
                flexBasis: isNarrow ? "auto" : "34%",
                flexGrow: isNarrow ? 0 : 34,
                height: isNarrow ? 360 : "100%",
              }}
            >
              {chatPanel}
            </StackItem>
            <StackItem
              size={isNarrow ? undefined : "fill"}
              style={{
                ...styles.stagePanel,
                flexBasis: isNarrow ? "auto" : "66%",
                flexGrow: isNarrow ? 0 : 66,
                height: isNarrow ? "auto" : "100%",
              }}
            >
              {stagePanel}
            </StackItem>
          </Stack>
        </StackItem>
      </VStack>
    </Theme>
  );
}
