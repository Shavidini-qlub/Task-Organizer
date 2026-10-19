import { test } from "node:test";
import assert from "node:assert/strict";
import { nextOccurrence, nextAfter } from "../src/schedule.js";

test("next occurrence for each repeat", () => {
  assert.equal(nextOccurrence("2026-10-19", "daily"), "2026-10-20");
  assert.equal(nextOccurrence("2026-10-19", "weekly"), "2026-10-26");
  assert.equal(nextOccurrence("2026-10-23", "weekdays"), "2026-10-26"); // Fri → Mon
  assert.equal(nextOccurrence("2026-10-20", "weekdays"), "2026-10-21");
  assert.equal(nextOccurrence("2026-10-19", "monthly"), "2026-11-19");
  assert.equal(nextOccurrence("2027-01-31", "monthly"), "2027-02-28"); // clamped
  assert.equal(nextOccurrence("2026-12-15", "monthly"), "2027-01-15"); // year rollover
});

test("finishing late skips the occurrences already missed", () => {
  // Weekly task from Mon Oct 5, finished Wed Oct 21 → next is Mon Oct 26.
  assert.equal(nextAfter("2026-10-05", "weekly", "2026-10-21"), "2026-10-26");
  // Finished on time → simply next week.
  assert.equal(nextAfter("2026-10-19", "weekly", "2026-10-19"), "2026-10-26");
});
