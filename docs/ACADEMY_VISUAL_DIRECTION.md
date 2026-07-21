# Academy Visual Direction (user-provided inspiration, 2026-07-20)

Reference mockups supplied by the product owner during Slice 1. Source of truth for
the *aesthetic direction* of Slices 2–3 (FinancialTerm sheets, Academy home, lesson
experience). Not a spec — where these mockups conflict with the approved Academy
spec, the spec governs and the conflict is resolved at that slice's brainstorm.

## What the mockups show

**Academy home ("Academy — Master the language of finance")**
- Progress card: % complete ring, concepts completed (e.g. 10/31), modules 3/5,
  a "Mastery: Building" chip, and a current-streak counter (see Deviations).
- "Continue Learning" card: next concept + one-line hook + progress bar + Continue.
- "Recently Completed" list (concept + completion date + green check).
- "Your Fluency Level" card: named levels (see Fluency ladder below).
- Bottom nav gains a 5th tab: Home · Rankings · Data · Report · **Academy**.

**All Concepts screen**
- Filter chips: All / Completed / In Progress / Locked (see Deviations re "Locked").
- Modules as sections ("Module 1 – How Your Household Operates"), each concept a row:
  icon, title, one-line short definition, right-side state (check / % ring / padlock).
- Current concept highlighted with green border + progress ring.

**Lesson experience (per concept, e.g. Free Cash Flow)**
- Three tabs: **Lesson · Your Data · Related**.
- Lesson tab: numbered sections ("1. What is Free Cash Flow?"), inline mini-statement
  (Revenue − Operating Expenses = Free Cash Flow with dollar figures, color-coded),
  plain-language framing, Previous/Next pager.
- Your Data tab: personalized value ("$2,520, ↑18% vs Q1 2026"), historical trend
  chart, "Where Your FCF Went" allocation donut (Retained Cash / Investments /
  Debt Reduction with $ + %), "Key Insight" narration block.
- Related tab: Why It Matters (icon bullet list), Common Misunderstanding card,
  Related Concepts list (tappable, with short definitions).

**Fluency ladder (marketing/landing strip)**
- Household Owner (1) → Financial Operator (2) → Capital Allocator (3) →
  Household CFO (4) → Financial Strategist (5), hexagonal badges, "Next Milestone"
  progress ("Complete 5 more concepts to reach Level 3").

## Aesthetic notes

- Dark UI, near-black surfaces, high-contrast white type, single green accent for
  progress/success/currency-positive; red reserved for expense figures.
- Cards with soft rounded corners, generous padding, thin hairline separators.
- Iconography: small duotone glyphs per concept; hexagon badges for levels.
- Progress rendered as rings and thin bars, always paired with explicit numbers
  (accessibility rule: never color alone — mockups already pair check/lock/% text).

## Deliberate deviations to resolve (mockup vs approved spec)

1. **Streak counter** — mockup shows "Current streak (days)". Spec/MVP boundary:
   no aggressive streak mechanics; progress communicates fluency, not daily
   pressure. Resolve at Slice 3 brainstorm (likely: omit or soften for MVP).
2. **"Locked" concept state** — mockup shows padlocked concepts. Spec: basic
   comprehension is never locked; every term always offers a short definition.
   "Locked" may only ever mean "lesson not yet taken → analytical depth not yet
   unlocked", and the label likely needs different language.
3. **Concept/module counts** (10/31, 3/5 modules, level ladder) — mockup assumes
   the expanded curriculum; MVP ships 15 concepts / 3 modules. Architecture
   already supports expansion (modules are data).
4. **Fluency levels** — attractive, but a named-level ladder is gamification the
   MVP boundary defers; candidate for a later slice once the loop is proven.
