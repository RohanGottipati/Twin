import { describe, expect, it } from "vitest";

import { isInsideToronto, TORONTO_SCOPE_SHORT } from "@/lib/techto/toronto-scope";

describe("toronto-scope", () => {
  it("accepts downtown Toronto and rejects Vancouver", () => {
    expect(isInsideToronto(-79.3832, 43.6532)).toBe(true);
    expect(isInsideToronto(-123.1207, 49.2827)).toBe(false);
  });

  it("states Toronto-only scope clearly", () => {
    expect(TORONTO_SCOPE_SHORT.toLowerCase()).toContain("toronto only");
  });
});
