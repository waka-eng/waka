## Variant: Canonical sticky display contract

### Design stance
Show the exact relationship between Gemini output, canonical API fields, and what the sticky card renders.

### Key choices
- Sticky card shows only: type chip, post-it headline, short evidence rationale.
- Detail view shows ambient signal, matched environment, anti-environment, rejected alternative.
- Raw structured `why` blobs are intentionally not displayed on the sticky card.

### Trade-offs
- Strong at: making model/API/UI parity obvious and testable.
- Weak at: showing every data field on the dashboard; details move behind click/open.

### Best for
A small product change where Top-of-Mind notes need to feel trustworthy, provisional, and consistent with LLM synthesis output.
