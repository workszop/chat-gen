// Node smoke test for the live LFM3 engine (CPU): loads the model, records two
// short runs and checks the recorded steps rebuild the decoded answer.
// Usage: node scripts/live-smoke.mjs ["question"]
import { loadLive, liveMeta, liveQuestion } from "../src/explainer/live/engine.ts";

const question = process.argv[2] ?? "Write a haiku about autumn.";
const t0 = Date.now();
const { tok, model } = await loadLive("cpu");
const meta = liveMeta(tok, model);
console.log("loaded in", ((Date.now() - t0) / 1000).toFixed(1), "s", meta);
const t1 = Date.now();
const q = await liveQuestion(tok, model, question, { eosId: meta.eosId, temps: [0, 1], maxNew: 60 });
console.log("prompt", JSON.stringify(q.prompt));
console.log("prompt tokens", q.promptTokens.map((t) => t.text));
let n = 0;
for (const [t, r] of Object.entries(q.runs)) {
  n += r.steps.length;
  const joined = r.steps.filter((s) => s.chosen.id !== meta.eosId).map((s) => s.delta).join("");
  const sums = r.steps.map((s) => s.probs[t].reduce((a, b) => a + b, 0));
  console.log(`T=${t} steps=${r.steps.length} finished=${r.finished} deltasOK=${joined === r.answer} maxTop10=${Math.max(...sums).toFixed(3)}`);
  console.log("  ", JSON.stringify(r.answer));
  console.log("   step0", r.steps[0].candidates.slice(0, 5).map((c, i) => `${JSON.stringify(c.text)}:${r.steps[0].probs[t][i]}`).join(" "));
}
console.log("tok/s", (n / ((Date.now() - t1) / 1000)).toFixed(1));
