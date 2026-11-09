/**
 * Live generation with LiquidAI LFM3-1.7B (ONNX, transformers.js) that records
 * the same per-step data as scripts/record_traces.py: the top candidates with
 * their chances at the run's temperature, the drawn token and what it adds to
 * the visible answer.
 *
 * How the draw works: a logits processor sees the model's raw scores for every
 * token, turns them into chances (softmax at temperature T, or one-hot at T=0),
 * draws one token with a seeded random generator, records the step and then
 * masks every other token, so transformers.js's greedy step takes exactly the
 * token we drew. The model, its cache and its scores are all real.
 *
 * Shared by the web worker and the Node smoke test (scripts/live-smoke.mjs).
 */

import {
  AutoModelForCausalLM,
  AutoTokenizer,
  LogitsProcessor,
  LogitsProcessorList,
  Tensor,
} from "@huggingface/transformers";

// ─── Constants ───

import {
  LIVE_MAX_NEW,
  LIVE_MODEL_ID,
  LIVE_SEED,
  LIVE_TEMPS,
  LIVE_TOPK,
} from "./config.ts";

export { LIVE_MAX_NEW, LIVE_MODEL_ID, LIVE_SEED, LIVE_TEMPS, LIVE_TOPK };

// ─── Types (same shape as data.ts; kept local so Node can run this file) ───

export interface LiveToken {
  id: number;
  text: string;
}

export interface LiveStep {
  candidates: LiveToken[];
  probs: Record<string, number[]>;
  chosen: LiveToken;
  chosenProb: Record<string, number>;
  rank: number | null;
  delta: string;
}

export interface LiveRun {
  steps: LiveStep[];
  answer: string;
  finished: boolean;
  seed: number;
  sampleTemperature: number;
}

export interface LiveQuestion {
  question: string;
  prompt: string;
  promptTokens: LiveToken[];
  runs: Record<string, LiveRun>;
}

export interface LiveMeta {
  model: string;
  vocabSize: number;
  temperatures: number[];
  topK: number;
  eosId: number;
}

export type Device = "webgpu" | "wasm" | "cpu";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tok = any;
type Model = any;

// ─── Helpers ───

/** Small seeded random generator (mulberry32), so a run can be repeated. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round5 = (p: number) => Math.round(p * 1e5) / 1e5;

/** Same spelling as JavaScript's String(t) and the recorder's key(). */
const key = (t: number) => String(t);

/** Chances for every token: softmax(scores / T), or all-on-the-top at T=0. */
function chances(scores: Float32Array, t: number): Float64Array {
  const n = scores.length;
  const p = new Float64Array(n);
  let best = 0;
  for (let i = 1; i < n; i++) if (scores[i] > scores[best]) best = i;
  if (t === 0) {
    p[best] = 1;
    return p;
  }
  const max = scores[best];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const e = Math.exp((scores[i] - max) / t);
    p[i] = e;
    sum += e;
  }
  for (let i = 0; i < n; i++) p[i] /= sum;
  return p;
}

/** Indices of the k highest scores, best first. */
function topK(scores: Float32Array, k: number): number[] {
  const best: number[] = [];
  for (let i = 0; i < scores.length; i++) {
    if (best.length < k || scores[i] > scores[best[best.length - 1]]) {
      let j = best.length < k ? best.length : k - 1;
      best[j] = i;
      while (j > 0 && scores[best[j]] > scores[best[j - 1]]) {
        [best[j], best[j - 1]] = [best[j - 1], best[j]];
        j--;
      }
    }
  }
  return best;
}

function draw(p: Float64Array, rand: () => number): number {
  let r = rand();
  for (let i = 0; i < p.length; i++) {
    r -= p[i];
    if (r <= 0) return i;
  }
  // rounding left a sliver: take the last token with any chance
  for (let i = p.length - 1; i >= 0; i--) if (p[i] > 0) return i;
  return 0;
}

// ─── Loading ───

/**
 * q4 = 4-bit weights with 32-bit maths. q4f16 overflows on WebGPU (tested on
 * Intel Xe, same finding as workszop/qwen): the answers turn into garbage.
 */
export type Dtype = "q4f16" | "q4";

export async function loadLive(
  device: Device,
  onProgress?: (info: any) => void,
  dtype: Dtype = "q4",
): Promise<{ tok: Tok; model: Model }> {
  const tok = await AutoTokenizer.from_pretrained(LIVE_MODEL_ID, {
    progress_callback: onProgress,
  });
  const model = await AutoModelForCausalLM.from_pretrained(LIVE_MODEL_ID, {
    dtype,
    device,
    progress_callback: onProgress,
  });
  return { tok, model };
}

export function liveMeta(_tok: Tok, model: Model): LiveMeta {
  const eos = model.generation_config?.eos_token_id ?? model.config.eos_token_id;
  return {
    model: "LiquidAI/LFM3-1.7B",
    vocabSize: model.config.vocab_size,
    temperatures: LIVE_TEMPS,
    topK: LIVE_TOPK,
    eosId: Array.isArray(eos) ? eos[0] : eos,
  };
}

// ─── Generation ───

export interface Progress {
  temperature: number;
  step: number;
  /** text written so far in this run */
  answer: string;
}

/** One answer at one temperature, recorded step by step. */
export async function liveRun(
  tok: Tok,
  model: Model,
  inputIds: number[],
  t: number,
  opts: {
    seed?: number;
    maxNew?: number;
    eosId: number;
    onStep?: (p: Progress) => void;
    shouldStop?: () => boolean;
  },
): Promise<LiveRun> {
  const seed = opts.seed ?? LIVE_SEED;
  const rand = seededRandom(seed);
  const steps: LiveStep[] = [];
  const decode = (ids: number[], skip: boolean) =>
    tok.decode(ids, { skip_special_tokens: skip }) as string;
  let shown = "";
  const chosenIds: number[] = [];

  class Recorder extends LogitsProcessor {
    _call(_ids: bigint[][], logits: any) {
      const data = logits[0].data as Float32Array;
      const scores = Float32Array.from(data);
      const cand = topK(scores, LIVE_TOPK);
      const p = chances(scores, t);
      const chosen = t === 0 ? cand[0] : draw(p, rand);
      chosenIds.push(chosen);
      const full = decode(chosenIds, true);
      const clean = full.replace(/�+$/, "");
      const delta = clean.startsWith(shown) ? clean.slice(shown.length) : "";
      if (clean.startsWith(shown)) shown = clean;
      const rank = cand.indexOf(chosen);
      steps.push({
        candidates: cand.map((id) => ({ id, text: decode([id], false) })),
        probs: { [key(t)]: cand.map((id) => round5(p[id])) },
        chosen: { id: chosen, text: decode([chosen], false) },
        chosenProb: { [key(t)]: round5(p[chosen]) },
        rank: rank === -1 ? null : rank + 1,
        delta,
      });
      opts.onStep?.({ temperature: t, step: steps.length, answer: shown });
      // Hand the drawn token to the greedy step: every other token is masked.
      // On "stop", force the end-of-turn token so generation ends cleanly.
      const force = opts.shouldStop?.() ? opts.eosId : chosen;
      data.fill(-Infinity);
      data[force] = 0;
      return logits;
    }
  }

  const processors = new LogitsProcessorList();
  processors.push(new Recorder());
  const ids = new Tensor("int64", BigInt64Array.from(inputIds.map(BigInt)), [1, inputIds.length]);
  const mask = new Tensor("int64", new BigInt64Array(inputIds.length).fill(1n), [1, inputIds.length]);
  await model.generate({
    input_ids: ids,
    attention_mask: mask,
    max_new_tokens: opts.maxNew ?? LIVE_MAX_NEW,
    do_sample: false,
    repetition_penalty: 1,
    logits_processor: processors,
  });

  return {
    steps,
    answer: decode(chosenIds, true),
    finished: chosenIds.at(-1) === opts.eosId,
    seed,
    sampleTemperature: t,
  };
}

/** Build the prompt and record one run per temperature. */
export async function liveQuestion(
  tok: Tok,
  model: Model,
  question: string,
  opts: {
    eosId: number;
    temps?: number[];
    maxNew?: number;
    onStep?: (p: Progress) => void;
    shouldStop?: () => boolean;
  },
): Promise<LiveQuestion> {
  // Thinking off: the template then closes an empty <think></think> block.
  const prompt = tok.apply_chat_template([{ role: "user", content: question }], {
    tokenize: false,
    add_generation_prompt: true,
    enable_thinking: false,
  }) as string;
  const inputIds = Array.from(
    tok.encode(prompt, { add_special_tokens: false }) as number[],
  );
  const promptTokens = inputIds.map((id) => ({
    id,
    text: tok.decode([id], { skip_special_tokens: false }) as string,
  }));
  const runs: Record<string, LiveRun> = {};
  for (const t of opts.temps ?? LIVE_TEMPS) {
    if (opts.shouldStop?.()) throw new Error("cancelled");
    runs[key(t)] = await liveRun(tok, model, inputIds, t, opts);
  }
  return { question, prompt, promptTokens, runs };
}
