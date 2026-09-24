import { describe, expect, it, vi, afterEach } from "vitest";

import { pickAdCandidate } from "./ad-rotation";

describe("ad-rotation.ts — pickAdCandidate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null for an empty list — never fabricates a winner", () => {
    expect(pickAdCandidate([])).toBeNull();
  });

  it("returns the only candidate when there's exactly one", () => {
    const only = { id: "a", impressions: 500 };
    expect(pickAdCandidate([only])).toBe(only);
  });

  it("favors the candidate with fewer impressions when the random roll lands there", () => {
    const fewer = { id: "fewer", impressions: 0 };
    const more = { id: "more", impressions: 100 };
    // weights: fewer = 100-0+1=101, more = 100-100+1=1, total=102 — a roll near 0 lands on `fewer`.
    vi.spyOn(Math, "random").mockReturnValue(0.01);
    expect(pickAdCandidate([fewer, more])?.id).toBe("fewer");
  });

  it("can still pick the most-shown candidate — never permanently locked out", () => {
    const fewer = { id: "fewer", impressions: 0 };
    const more = { id: "more", impressions: 100 };
    // roll near the top of the weight range lands on `more`.
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    expect(pickAdCandidate([fewer, more])?.id).toBe("more");
  });

  it("gives every candidate an equal chance when impressions are tied", () => {
    const a = { id: "a", impressions: 10 };
    const b = { id: "b", impressions: 10 };
    // weights equal (1 each of relative range), total=2 — roll < 0.5*total picks a, else b.
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    expect(pickAdCandidate([a, b])?.id).toBe("a");
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    expect(pickAdCandidate([a, b])?.id).toBe("b");
  });
});
