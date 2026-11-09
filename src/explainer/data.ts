/**
 * Real generation traces recorded from HuggingFaceTB/SmolLM2-135M-Instruct
 * (scripts/record_traces.py). Every probability shown in the explainer comes
 * from this file; nothing is invented in the UI.
 */

import raw from './traces.json';

// ─── Types ───

export interface TokenInfo {
  id: number;
  text: string;
}

export interface Step {
  candidates: TokenInfo[];
  /** temperature (as string key) → probability of each candidate, over the full vocabulary */
  probs: Record<string, number[]>;
  chosen: TokenInfo;
  /** what this token adds to the decoded answer (complete characters only) */
  delta: string;
  chosenProb: Record<string, number>;
  /** 1-based rank of the chosen token among the top 10, or null if it was outside */
  rank: number | null;
}

/** One generation run of the model at one temperature. */
export interface Run {
  steps: Step[];
  answer: string;
  seed: number;
  sampleTemperature: number;
  finished: boolean;
}

export interface Question {
  question: string;
  prompt: string;
  promptTokens: TokenInfo[];
  /** temperature key (as JavaScript's String(t): "0", "0.3", "1") → run */
  runs: Record<string, Run>;
}

/** A question together with the run at the chosen temperature. */
export interface Trace extends Run {
  question: string;
  prompt: string;
  promptTokens: TokenInfo[];
  eosId: number;
}

export interface TraceFile {
  model: string;
  vocabSize: number;
  temperatures: number[];
  topK: number;
  eosId: number;
  questions: Question[];
  /** parameter count in words, e.g. "135 million" */
  params?: string;
  /** recorded ahead of time, or generated live in this browser */
  source?: "recorded" | "live";
}

export const DATA: TraceFile = {
  ...(raw as TraceFile),
  params: "135 million",
  source: "recorded",
};

export function getTrace(
  data: TraceFile,
  questionIndex: number,
  temperature: string,
): Trace {
  const q = data.questions[questionIndex];
  return {
    question: q.question,
    prompt: q.prompt,
    promptTokens: q.promptTokens,
    eosId: data.eosId,
    ...q.runs[temperature],
  };
}

/** Short model name for the text, e.g. "SmolLM2-135M-Instruct". */
export function modelName(data: TraceFile): string {
  return data.model.split("/").pop() ?? data.model;
}

export type Part = 'special' | 'role' | 'system' | 'user' | 'answer';

// ─── Helpers ───

export const SPECIAL = new Set([
  '<|im_start|>',
  '<|im_end|>',
  '<|startoftext|>', // LFM3: start of the whole text
  '<think>', // LFM3: thinking block, closed empty when thinking is off
  '</think>',
]);

/** Template markers before the first turn (LFM3's <|startoftext|>). */
export function leadingTokens(tokens: TokenInfo[]): TokenInfo[] {
  const i = tokens.findIndex(t => t.text === '<|im_start|>');
  return i > 0 ? tokens.slice(0, i) : [];
}

/** Token text for display: new lines show as ↵, spaces are left unmarked. */
export function visible(text: string): string {
  return text.replace(/\n/g, '↵').trim() || '(space)';
}

export interface Turn {
  role: string;
  /** <|im_start|>, role name tokens and the new line after them */
  header: TokenInfo[];
  /** the message itself */
  content: TokenInfo[];
  /** <|im_end|> and the new line between turns */
  footer: TokenInfo[];
}

/** Split the prompt into chat turns (system, user, and the open assistant turn). */
export function splitTurns(tokens: TokenInfo[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  let zone: 'header' | 'content' | 'footer' = 'footer';
  for (const t of tokens) {
    if (t.text === '<|im_start|>') {
      cur = {role: '', header: [t], content: [], footer: []};
      turns.push(cur);
      zone = 'header';
      continue;
    }
    if (!cur) continue;
    if (t.text === '<|im_end|>') zone = 'footer';
    if (zone === 'header') {
      cur.header.push(t);
      if (t.text.includes('\n')) zone = 'content';
      else cur.role += t.text;
    } else if (zone === 'content' && cur.content.length === 0 && SPECIAL.has(t.text) && t.text !== '<|im_end|>') {
      cur.header.push(t); // e.g. the empty <think></think> that opens the answer
    } else {
      cur[zone].push(t);
    }
  }
  return turns;
}

/** Label each prompt token with the part of the chat it belongs to. */
export function classifyPrompt(tokens: TokenInfo[]): Part[] {
  const parts: Part[] = [];
  let mode: 'outside' | 'role' | 'content' = 'outside';
  let role = '';
  for (const t of tokens) {
    if (SPECIAL.has(t.text)) {
      parts.push('special');
      mode = t.text === '<|im_start|>' ? 'role' : 'outside';
      if (mode === 'role') role = '';
      continue;
    }
    if (mode === 'role') {
      parts.push('role');
      if (t.text.includes('\n')) mode = 'content';
      else role += t.text;
      continue;
    }
    if (mode === 'content') {
      parts.push(role === 'system' ? 'system' : role === 'user' ? 'user' : 'answer');
      continue;
    }
    parts.push('special'); // the "\n" between turns belongs to the template
  }
  return parts;
}

export function formatPercent(p: number): string {
  if (p >= 0.995) return `${(p * 100).toFixed(1)}%`;
  if (p >= 0.1) return `${Math.round(p * 100)}%`;
  if (p >= 0.001) return `${(p * 100).toFixed(1)}%`;
  return '<0.1%';
}

export function isEos(t: TokenInfo, eosId: number): boolean {
  return t.id === eosId;
}

export const END_THINK = '</think>';

/**
 * Text the chat window shows after `count` generated tokens. LFM3 sometimes
 * writes a draft and closes it with "</think>" even with thinking off; like a
 * chat app, the text before that marker is "thinking", the rest the answer.
 */
export function answerParts(
  trace: Trace,
  count: number,
): { thinking: string | null; answer: string } {
  const steps = trace.steps.slice(0, count).filter(s => !isEos(s.chosen, trace.eosId));
  const cut = steps.findIndex(s => s.chosen.text === END_THINK);
  const join = (xs: Step[]) => xs.map(s => s.delta).join('');
  if (cut === -1) return { thinking: null, answer: join(steps) };
  return { thinking: join(steps.slice(0, cut)), answer: join(steps.slice(cut + 1)) };
}

/** The final answer of a whole run, without a draft closed by "</think>". */
export function finalAnswer(answer: string): string {
  const i = answer.indexOf(END_THINK);
  return i === -1 ? answer : answer.slice(i + END_THINK.length);
}
