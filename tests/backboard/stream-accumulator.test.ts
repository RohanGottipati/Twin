import { describe, expect, it } from "vitest";

import { firstNonEmptyText, StreamAccumulator } from "@/lib/backboard/client";

describe("firstNonEmptyText", () => {
  it("skips empty strings so final_content is not hidden by content: \"\"", () => {
    expect(firstNonEmptyText("", "## Recommendation\nWychwood")).toBe(
      "## Recommendation\nWychwood",
    );
    expect(firstNonEmptyText(null, "   ", "ok")).toBe("ok");
  });
});

describe("StreamAccumulator", () => {
  it("keeps final_content when run_ended.content is an empty string", () => {
    const acc = new StreamAccumulator("thread-1");
    acc.handle({
      type: "run_ended",
      status: "completed",
      content: "",
      final_content: "## Recommendation\n\nPlace the station in Wychwood.",
    });
    expect(acc.finalize().content).toBe(
      "## Recommendation\n\nPlace the station in Wychwood.",
    );
  });

  it("uses accumulated_content snapshots from content_streaming", () => {
    const acc = new StreamAccumulator("thread-1");
    acc.handle({
      type: "content_streaming",
      content: "",
      accumulated_content: "## Rec",
    });
    acc.handle({
      type: "content_streaming",
      content: "",
      accumulated_content: "## Recommendation\nWychwood",
    });
    acc.handle({ type: "run_ended", status: "completed" });
    expect(acc.finalize().content).toBe("## Recommendation\nWychwood");
  });

  it("still appends plain content deltas when accumulated_content is absent", () => {
    const acc = new StreamAccumulator("thread-1");
    acc.handle({ type: "content_streaming", content: "Hello " });
    acc.handle({ type: "content_streaming", content: "Toronto" });
    acc.handle({ type: "run_ended", status: "completed" });
    expect(acc.finalize().content).toBe("Hello Toronto");
  });
});
