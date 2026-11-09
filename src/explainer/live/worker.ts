/**
 * Web worker that runs LFM3-1.7B in the browser on WebGPU, so the page stays
 * responsive. There is no CPU fallback: the 4-bit export uses the
 * GatherBlockQuantized operator, which the WebAssembly runtime lacks.
 *
 * In:  {type:"load"} | {type:"generate", question} | {type:"cancel"}
 * Out: {type:"progress", loaded, total} | {type:"ready", meta, device}
 *      | {type:"step", temperature, step, answer} | {type:"done", question}
 *      | {type:"cancelled"} | {type:"error", message}
 */

import {
  liveMeta,
  liveQuestion,
  loadLive,
  type Device,
  type Dtype,
  type LiveMeta,
} from "./engine";

// ─── State ───

/* eslint-disable @typescript-eslint/no-explicit-any */
let tok: any = null;
let model: any = null;
let meta: LiveMeta | null = null;
let device: Device = "wasm";
let cancelRequested = false;
const files: Record<string, { loaded: number; total: number }> = {};

// ─── Helpers ───

const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg);

/** WebGPU with 4-bit weights and 32-bit maths (q4f16 overflows, see engine.ts). */
async function pickDevice(): Promise<{ device: Device; dtype: Dtype }> {
  const gpu = (navigator as any).gpu;
  const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
  if (!adapter) throw new Error("This browser has no WebGPU. Open the page in Chrome or Edge.");
  return { device: "webgpu", dtype: "q4" };
}

function onProgress(info: any) {
  if (info?.status !== "progress" || !info.file) return;
  files[info.file] = { loaded: info.loaded ?? 0, total: info.total ?? 0 };
  let loaded = 0;
  let total = 0;
  for (const f of Object.values(files)) {
    loaded += f.loaded;
    total += f.total;
  }
  post({ type: "progress", loaded, total });
}

// ─── Listeners ───

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      if (model) {
        post({ type: "ready", meta, device });
        return;
      }
      // ?live-device=wasm|webgpu and ?live-dtype=q4|q4f16 override the choice (testing).
      const auto = await pickDevice();
      const choice = {
        device: (msg.device as Device | undefined) ?? auto.device,
        dtype: (msg.dtype as Dtype | undefined) ?? auto.dtype,
      };
      device = choice.device;
      post({ type: "device", device });
      ({ tok, model } = await loadLive(device, onProgress, choice.dtype));
      meta = liveMeta(tok, model);
      post({ type: "ready", meta, device });
    } else if (msg.type === "generate") {
      cancelRequested = false;
      const question = await liveQuestion(tok, model, msg.question, {
        eosId: meta!.eosId,
        onStep: (p) => post({ type: "step", ...p }),
        shouldStop: () => cancelRequested,
      });
      if (cancelRequested) post({ type: "cancelled" });
      else post({ type: "done", question });
    } else if (msg.type === "cancel") {
      cancelRequested = true;
    }
  } catch (err) {
    if (cancelRequested) post({ type: "cancelled" });
    else post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
