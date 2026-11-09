# How a chat writes its answer

A visual explainer of text generation in chat apps, built with [Astryx](https://github.com/meta/astryx) (Meta's open-source React design system, v0.7.11).

Left: what you see – a chat window where the answer appears token by token.
Right: what happens behind it, in five stages:

1. **One text** – the chat is joined into one text with template markers (`<|im_start|>`, `<|im_end|>`).
2. **Tokens** – the text is split into tokens; each is a number in the model's vocabulary
   (49,152 tokens for SmolLM2, 128,000 for LFM3).
3. **Score** – the model gives every token a chance of coming next (top 5 shown + "all others").
4. **Pick & append** – one token is drawn with those chances, added to the text and shown in
   the chat; then the loop repeats. The temperature switch (0 / 0.3 / 0.7 / 1 / 1.5) picks a
   separate real run of the model: 0 always takes the top token, higher values spread the
   chances (more random).
5. **Stop** – the model picks the end-of-turn token; the same question's answers at every
   temperature are shown side by side.

Example questions (answers of ~20–80 tokens that change visibly with temperature):
"Describe a sunny morning in two sentences.", "Write a haiku about autumn.",
"Describe the perfect pizza in two sentences."

All numbers are real: `src/explainer/traces.json` was recorded from
`HuggingFaceTB/SmolLM2-135M-Instruct` on CPU with `scripts/record_traces.py`
(one run per question and temperature; probabilities over the full vocabulary at that
run's temperature, top 10 kept per step).

## Live model: LFM3-1.7B in the browser

The **Model** picker in the top bar switches from the recorded SmolLM2 traces to
[LiquidAI LFM3-1.7B](https://huggingface.co/LiquidAI/LFM3-1.7B) running live in the browser
(`onnx-community/LFM3-1.7B-ONNX`, transformers.js 4.3). The browser downloads the model once
(about 1.3 GB, 4-bit `q4`, kept in its cache), then you type a question and the model writes
one answer per temperature, up to 200 tokens each, in a web worker. Even with thinking off,
LFM3 often writes a draft, closes it with `</think>` and then writes the final answer; the chat
shows the text as the answer until that marker appears, then folds it into a "Thinking" block,
as chat apps do. Needs WebGPU (Chrome or
Edge); the page checks for it before offering the download. Same setup as workszop/qwen:
`q4` = 4-bit weights with 32-bit maths, because `q4f16` overflows on WebGPU and the answers
turn into garbage. There is no CPU fallback: the 4-bit export uses `GatherBlockQuantized`,
which the browser's WebAssembly runtime lacks (Node's native runtime has it).

Every step records the same data as the recorder script – the top 10 candidates with their
chances at that temperature, the drawn token and the text it adds – so all five stages work on
your own question. How the draw works (`src/explainer/live/engine.ts`): a logits processor
takes the model's real scores, computes softmax(scores / T) (one-hot at T = 0), draws a token
with a seeded random generator, records the step and masks every other token so the greedy
step takes exactly that token. Thinking is switched off, so the template holds an empty
`<think></think>` block.

Files: `src/explainer/live/{config,engine,worker,useLiveModel}.ts`. Node smoke test on the
CPU (downloads the model to the transformers.js cache):

```bash
node scripts/live-smoke.mjs "Write a haiku about autumn."
```

## Run

```bash
npm install
npm run dev        # explainer at /, earlier component showcase at /#showcase
```

Re-record the traces (needs `uv`; downloads CPU PyTorch + transformers):

```bash
uv run --no-project --python 3.12 --index https://download.pytorch.org/whl/cpu \
  --index-strategy unsafe-best-match --with torch --with transformers \
  -- python scripts/record_traces.py src/explainer/traces.json
```

## Edulab theme

`src/themes/edulab/edulabTheme.ts` is the edustyl "Editorial Color" design system as an
Astryx theme (extends Neutral): white paper, stone muted fills, yellow primary with dark ink,
blue / green / grape / red solid chips, Outfit + IBM Plex Sans + Roboto Mono, generous radii,
warm shadows. It is the only theme (the other Astryx themes and the theme / colour-mode switchers were
removed) and **light only**. Fonts load via `<link>` tags in `index.html`.

```bash
npm run astryx -- theme build src/themes/edulab/edulabTheme.ts   # after editing the theme
```
