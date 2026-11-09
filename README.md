# How a chat writes its answer

A visual explainer of text generation in chat apps. Plain HTML, CSS and JavaScript: no
framework, no build step, no npm. Design: edulab (edustyl tokens).

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

## Files

| File | What it is |
|---|---|
| `index.html` | the whole app: markup, CSS (edulab tokens inlined) and JavaScript |
| `traces.js` | recorded SmolLM2 traces (`window.TRACES = …`), written by the recorder |
| `scripts/record_traces.py` | records the traces from the real model |
| `favicon.svg`, `favicon-*.png`, `apple-touch-icon.png`, `icon-512.png` | edulab favicon |

## Run

```bash
python3 -m http.server 5180   # then open http://127.0.0.1:5180/
```

The recorded mode also works straight from `file://`. The live mode needs the page served
over http(s), because the browser keeps the downloaded model in its cache.

## Recorded mode: SmolLM2-135M-Instruct

All numbers are real: `traces.js` was recorded from `HuggingFaceTB/SmolLM2-135M-Instruct` on
CPU (one run per question and temperature; probabilities over the full vocabulary at that
run's temperature, top 10 kept per step). Example questions: "Describe a sunny morning in two
sentences.", "Write a haiku about autumn.", "Describe the perfect pizza in two sentences."

Re-record (needs `uv`; downloads CPU PyTorch + transformers):

```bash
uv run --no-project --python 3.12 --index https://download.pytorch.org/whl/cpu \
  --index-strategy unsafe-best-match --with torch --with transformers \
  -- python scripts/record_traces.py traces.js
```

## Live mode: LFM3-1.7B in the browser

The **Model** picker switches to [LiquidAI LFM3-1.7B](https://huggingface.co/LiquidAI/LFM3-1.7B)
running in the browser (`onnx-community/LFM3-1.7B-ONNX`, transformers.js 4.3.2 from jsDelivr).
The page keeps its two panels: the right one explains how the live mode works and offers the
download (about 1.3 GB, 4-bit `q4`, kept in the browser cache); after that you type a question
and the model writes one answer per temperature, up to 200 tokens each, while the chat on the
left shows the text being written. Then the regular step-by-step view replays the real run.

Every step records the same data as the recorder script – the top 10 candidates with their
chances at that temperature, the drawn token and the text it adds. A logits processor takes
the model's real scores, computes softmax(scores / T) (one-hot at T = 0), draws a token with a
seeded random generator, records the step and masks every other token so the greedy step
takes exactly that token. Thinking is switched off, so the template holds an empty
`<think></think>` block; LFM3 still often writes a draft, closes it with `</think>` and then
writes the final answer – the chat folds that draft into a "Thinking" block, as chat apps do.

Needs WebGPU (Chrome or Edge); the page checks for it before offering the download. Same setup
as workszop/qwen: `q4` = 4-bit weights with 32-bit maths, because `q4f16` overflows on WebGPU
and the answers turn into garbage. There is no CPU fallback: the 4-bit export uses
`GatherBlockQuantized`, which the browser's WebAssembly runtime lacks.

## DOM contract

`#app` carries `data-trace`, `data-stage`, `data-step`, `data-temperature`,
`data-answer-length`, `data-playing`, `data-source` and `data-live-status`. Probability rows
carry `data-chosen="true"` for the picked token, Stop-stage rows `data-run`.
