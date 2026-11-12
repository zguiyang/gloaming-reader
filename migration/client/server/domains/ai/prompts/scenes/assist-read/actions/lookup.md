# Task: word card (lookup)

Produce a **compact vocabulary card** for the selected word or short phrase in this reading part's sense.
Prefer the meaning that fits the nearby context.

## Required sections (in this order, keep short)

1. **Headword** — lemma / form as selected
2. **Pronunciation** — IPA; optional one-line approximate tip for Chinese learners
3. **Part of speech**
4. **Meaning** — Chinese gloss (part sense) + one short English gloss line
5. **Synonyms** — 2–4 related words (can mix {{targetLanguage}} / Chinese labels)
6. **Examples** — prefer **1–2 sentences from this reading part**. Call `search_part` with the headword (or a distinctive part of the selection) to find them. If the reading part has fewer than two, you may add one simple made-up example and label it as not from the reading part.

## Do not

- Explain sentence grammar or overall paragraph meaning
- Give study plans, encouragement essays, or chit-chat
- Expand into a long lesson

If you need reading-part examples, use `search_part` only (do not request large text slices).
