"""Record real next-token traces from SmolLM2-135M-Instruct for the explainer.

For every question the model generates one answer per temperature. Each run
stores, at every step, the top-10 candidates with their probability at that
run's temperature and the token that was actually drawn. Temperature 0 means
"always take the most likely token" (greedy), so its chances are one-hot.

Usage: python scripts/record_traces.py src/explainer/traces.json
"""
import glob
import json
import os
import sys

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

M = glob.glob(os.path.expanduser(
    '~/.cache/huggingface/hub/models--HuggingFaceTB--SmolLM2-135M-Instruct/snapshots/*/'))[0]
tok = AutoTokenizer.from_pretrained(M)
model = AutoModelForCausalLM.from_pretrained(M, dtype=torch.float32).eval()

TEMPS = [0, 0.3, 0.7, 1.0, 1.5]
TOPK = 10
MAX_NEW = 100

# Length-bounded prompts: answers of ~20-80 tokens that finish at temperatures 0-1
# and visibly change with temperature (chosen from a wider trial on 2026-11-09).
QUESTIONS = [
    ("Describe a sunny morning in two sentences.", 5),
    ("Write a haiku about autumn.", 5),
    ("Describe the perfect pizza in two sentences.", 5),
]


def key(t):
    """Same spelling as JavaScript's String(t): 0, 0.3, 1, 1.5."""
    return f"{t:g}"


def tok_info(i):
    return {"id": int(i), "text": tok.decode([int(i)])}


def chances(logits, t):
    if t == 0:
        p = torch.zeros_like(logits)
        p[int(torch.argmax(logits))] = 1.0
        return p
    return torch.softmax(logits / t, -1)


def run(ids, t, seed):
    g = torch.Generator().manual_seed(seed)
    steps, past, cur = [], None, ids
    shown = ""  # decoded answer text so far
    with torch.no_grad():
        for _ in range(MAX_NEW):
            out = model(input_ids=cur, past_key_values=past, use_cache=True)
            past = out.past_key_values
            logits = out.logits[0, -1].float()
            # Candidates ranked by the model's own scores (same order at every temperature).
            cand_ids = torch.topk(logits, TOPK).indices.tolist()
            p = chances(logits, t)
            chosen = int(torch.argmax(logits)) if t == 0 else int(torch.multinomial(p, 1, generator=g))
            steps.append({
                "candidates": [tok_info(i) for i in cand_ids],
                "probs": {key(t): [round(float(p[i]), 5) for i in cand_ids]},
                "chosen": tok_info(chosen),
                "chosenProb": {key(t): round(float(p[chosen]), 5)},
                "rank": cand_ids.index(chosen) + 1 if chosen in cand_ids else None,
            })
            # What this token adds to the decoded answer. A character split over
            # several byte-level tokens appears only once it is complete, so the
            # deltas join to exactly the decoded answer (no "\ufffd" fragments).
            full = tok.decode([st["chosen"]["id"] for st in steps], skip_special_tokens=True)
            clean = full.rstrip("\ufffd")
            assert clean.startswith(shown), (shown, clean)
            steps[-1]["delta"] = clean[len(shown):]
            shown = clean
            if chosen == tok.eos_token_id:
                break
            cur = torch.tensor([[chosen]])
    return {
        "steps": steps,
        "answer": tok.decode([s["chosen"]["id"] for s in steps], skip_special_tokens=True),
        "finished": steps[-1]["chosen"]["id"] == tok.eos_token_id,
        "seed": seed,
        "sampleTemperature": t,
    }


def record(question, seed):
    prompt = tok.apply_chat_template(
        [{"role": "user", "content": question}], tokenize=False, add_generation_prompt=True)
    ids = tok(prompt, return_tensors='pt').input_ids
    return {
        "question": question,
        "prompt": prompt,
        "promptTokens": [tok_info(i) for i in ids[0]],
        "runs": {key(t): run(ids, t, seed) for t in TEMPS},
    }


data = {
    "model": "HuggingFaceTB/SmolLM2-135M-Instruct",
    "vocabSize": len(tok),
    "temperatures": TEMPS,
    "topK": TOPK,
    "eosId": tok.eos_token_id,
    "questions": [record(q, s) for q, s in QUESTIONS],
}
for q in data["questions"]:
    print(q["question"])
    for t, r in q["runs"].items():
        print(f"  T={t:>3} {len(r['steps']):>2} steps finished={r['finished']}: {r['answer'][:110]!r}")
with open(sys.argv[1], 'w') as f:
    json.dump(data, f, ensure_ascii=False)
