---
description: The owner's weekly brief, covering what changed, what needs attention and what to do
---

Prepare the owner's weekly brief.

1. Run `node --import tsx scripts/business-snapshot.ts --period 7d` and `node --import tsx scripts/business-snapshot.ts --period 30d`.
2. Compare the last 7 days with the 30-day picture: revenue, new requests, quotes sent and approved, first-response times against the SLA, completions and ratings.
3. List what needs attention now: requests still waiting for a first answer, unassigned cases, overdue tasks, quotes waiting for an answer, and cases stuck waiting on a third party.
4. Note anything unusual in the team's workload.

Structure: **This week in one line**, **Numbers** (5–7 bullets with the change), **Needs attention** (most urgent first), **Three things to do this week**. $ARGUMENTS
