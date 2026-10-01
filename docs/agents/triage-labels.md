# Triage Labels

The skills speak in terms of five canonical triage roles. This repo already used an informal `AFK`/`HITL` split (driven by the `ralph/` loop scripts) before these skills existed, so the two "ready" roles map onto those instead of creating duplicate labels.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | --------------------- | ---------------------------------------- |
| `needs-triage`              | `needs-triage` *(new)* | Maintainer needs to evaluate this issue  |
| `needs-info`                | `needs-info` *(new)*   | Waiting on reporter for more information |
| `ready-for-agent`           | `AFK`                  | Fully specified, ready for an AFK agent  |
| `ready-for-human`           | `HITL`                 | Requires human implementation            |
| `wontfix`                   | `wontfix`              | Will not be actioned                     |

`needs-triage` and `needs-info` don't exist yet in the repo's label set and need to be created (`gh label create`) before the `triage` skill can apply them.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from the right-hand column.
