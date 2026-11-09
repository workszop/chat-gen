/** Settings of the live model, kept apart from engine.ts so the page does not bundle transformers.js. */
export const LIVE_MODEL_ID = "onnx-community/LFM3-1.7B-ONNX";
export const LIVE_TEMPS = [0, 0.3, 0.7, 1, 1.5];
export const LIVE_TOPK = 10;
// LFM3 often writes a draft, "</think>", then the final answer: ~130 tokens for two sentences.
export const LIVE_MAX_NEW = 200;
export const LIVE_SEED = 5;
