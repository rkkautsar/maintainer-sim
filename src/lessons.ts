export const lessons: Record<string, string> = {
  a: "Trace state changes: call like twice for the same user and verify both idempotency and preservation of the original likedBy array. A small function can satisfy the requirement without extra machinery.",
  b: "Separate current requirements from imagined flexibility. Ask which concrete extension needs a pipeline today, and what additional code a future maintainer must understand to change one behavior.",
  c: "Trace authorization from inputs to the write. An actor parameter is not an ownership check. Try an actor different from ownerId and verify that the operation fails before returning an edited post.",
  d: "Check inputs that ordinary happy-path tests miss. NaN compares false to every numeric bound; fractional values are accepted by slice through coercion. Try page([1,2,3], NaN, 2) and fractional limits, then require explicit integer validation.",
  e: "Recognize useful, appropriately sized contributions. A trim operation solves the stated whitespace problem; it does not need a framework. Accepting it or deferring it for the milestone are both reasonable.",
  f: "Read beyond the diff. Search the repository for sort, updatedAt, and ordering helpers. src/order.ts already owns the timestamp and ID tie-break policy, and src/feed.ts uses it. Correct-looking duplicated code creates two places for the next bug fix.",
};
