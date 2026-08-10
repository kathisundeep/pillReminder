# PillReminder — Documentation

Documentation set for the PillReminder Android app (Expo / React Native + Supabase),
written against branch `feat/guardian-alarm-actions` (phases P0–P4 merged).

| Doc | Read it for | Audience |
|---|---|---|
| **[01 — Functional Overview](./01-functional-overview.md)** | What every module does and the rules it obeys, in prose. No code needed. | product, QA, new joiners, stakeholders |
| **[02 — Architecture & Flows](./02-architecture.md)** | System structure, data model, RLS, sequence/flow diagrams, decision tables, failure modes, technical debt. | engineers |
| **[03 — Sprint Plan](./03-sprint-plan.md)** | The whole project as sprints — Sprints 0–4 delivered, 5–14 forward — with stories, acceptance criteria, release train, risks. | delivery lead, engineers |
| **[04 — Feature Inventory](./04-feature-inventory.md)** | Features built / partial / stubbed / missing, gaps in what exists, and growth proposals with impact-vs-effort. | product, growth |

## Suggested reading order

- **New to the project:** 01 → 02 → 04
- **Planning the next sprint:** 04 (Part B) → 03
- **Fixing a bug:** 02 (§15–17) then the relevant module section
- **Pitching or prioritising:** 04 (Parts D & E) → 03 (roadmap)

## Reading the diagrams

Diagrams are [Mermaid](https://mermaid.js.org/) fenced blocks. They render natively on
GitHub, on GitLab, in VS Code with a Mermaid preview extension, and in most Markdown
viewers. In a plain editor they appear as readable source.

## The short version

An Android medication-adherence app. A patient records medicines and times; the phone
rings a full-screen, DND-bypassing alarm at each time; every response is written to an
append-only cloud ledger. A **guardian** pairs via a one-time 6-digit code and can view
the patient's medicines and vitals, is pushed an alert when a dose is missed, and may
*propose* medicines the patient must approve. Vitals (BP, sugar, cholesterol, weight)
roll into a shareable report. Plans gate how many guardians a patient may have; payment
charging is a deliberate stub.

**The two things to know before changing anything:**

1. **The dose ledger is append-only** and today's state is *derived*, never stored.
   Snooze-aware missed-dose deadlines depend on the full event sequence.
2. **Alarms are rebuilt wholesale** (cancel-all-then-re-arm) on every mutation. Never
   patch a single OS alarm — phantom alarms cost user trust.

**The most important open gap:** missed-dose detection runs on the *patient's* device, so
no alert is sent if that phone is off — see
[02 §9](./02-architecture.md#9-module-m7--missed-dose-detection) and
[Sprint 6](./03-sprint-plan.md#sprint-6--server-side-missed-dose-alerting).

## Keeping these current

Treat the docs as part of the Definition of Done: if a change alters architecture, a
rule, or the feature set, update the affected document in the same PR.

- new/changed module behaviour → **01**
- new table, policy, RPC, or flow → **02**
- scope or sequencing change → **03**
- feature shipped or gap closed → **04**
