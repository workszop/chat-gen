/**
 * React side of the in-browser LFM3 model: owns the worker, tracks download
 * and generation progress, and collects the answered questions as a dataset
 * with the same shape as the recorded traces. A new answer is appended to
 * dataset.questions; the page watches its length to open it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { TraceFile } from "../data";
import type { Device, LiveMeta, LiveQuestion, Progress } from "./engine";

export type LiveStatus =
  | "idle"
  | "loading"
  | "ready"
  | "generating"
  | "error";

export interface LiveState {
  status: LiveStatus;
  device: Device | null;
  download: { loaded: number; total: number };
  generation: Progress | null;
  error: string | null;
  dataset: TraceFile | null;
}

const INITIAL: LiveState = {
  status: "idle",
  device: null,
  download: { loaded: 0, total: 0 },
  generation: null,
  error: null,
  dataset: null,
};

export function useLiveModel() {
  const [state, setState] = useState<LiveState>(INITIAL);
  const workerRef = useRef<Worker | null>(null);

  const worker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const w = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        case "device":
          setState((s) => ({ ...s, device: msg.device }));
          break;
        case "progress":
          setState((s) => ({
            ...s,
            download: { loaded: msg.loaded, total: msg.total },
          }));
          break;
        case "ready": {
          const meta = msg.meta as LiveMeta;
          setState((s) => ({
            ...s,
            status: "ready",
            dataset: s.dataset ?? {
              ...meta,
              params: "1.7 billion",
              source: "live",
              questions: [],
            },
          }));
          break;
        }
        case "step":
          setState((s) => ({ ...s, generation: msg as Progress }));
          break;
        case "done":
          setState((s) => {
            const questions = [
              ...(s.dataset?.questions ?? []),
              msg.question as LiveQuestion,
            ];
            return {
              ...s,
              status: "ready",
              generation: null,
              dataset: { ...s.dataset!, questions },
            };
          });
          break;
        case "cancelled":
          setState((s) => ({ ...s, status: "ready", generation: null }));
          break;
        case "error":
          setState((s) => ({
            ...s,
            status: s.dataset ? "ready" : "error",
            generation: null,
            error: msg.message,
          }));
          break;
      }
    };
    w.onerror = (e) =>
      setState((s) => ({ ...s, status: "error", error: e.message || "The model worker crashed" }));
    workerRef.current = w;
    return w;
  }, []);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: "loading", error: null }));
    const q = new URLSearchParams(location.search);
    worker().postMessage({
      type: "load",
      device: q.get("live-device") ?? undefined,
      dtype: q.get("live-dtype") ?? undefined,
    });
  }, [worker]);

  const ask = useCallback(
    (question: string) => {
      setState((s) => ({ ...s, status: "generating", error: null, generation: null }));
      worker().postMessage({ type: "generate", question });
    },
    [worker],
  );

  const cancel = useCallback(() => {
    workerRef.current?.postMessage({ type: "cancel" });
  }, []);

  return { ...state, load, ask, cancel };
}
