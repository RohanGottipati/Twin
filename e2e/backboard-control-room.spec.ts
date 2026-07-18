import { test, expect } from "@playwright/test";

/**
 * GridTwin control-room flow against Mock Backboard Mode. The webServer in
 * playwright.config builds and starts Next; BACKBOARD_MOCK_MODE defaults on
 * whenever BACKBOARD_API_KEY is unset in the test environment, and the run
 * route scripts a deterministic demo pipeline (malformed retry, unsafe
 * reject, valid recommend) before streaming SSE events.
 */
test.describe("GridTwin Backboard control room", () => {
  test("world still works, then mock Backboard run completes end to end", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("world-app")).toBeVisible();
    await expect(page.getByText("Skyline").first()).toBeVisible();
    await expect(page.getByTestId("world-ready")).toBeAttached({ timeout: 60_000 });

    const explorer = page.getByTestId("city-explorer");
    await expect(explorer).toBeVisible();
    await page.getByTestId("city-row-toronto").click();
    await expect(page.getByTestId("city-preview-card")).toBeVisible();
    await page.getByTestId("explore-city-button").click();
    await expect(page.getByTestId("back-to-world-button")).toBeVisible({ timeout: 30_000 });

    // Open the simulated battery control room (marker click is Cesium-dependent;
    // the GridTwin nav link is the reliable entry for automated coverage).
    await page.getByTestId("open-gridtwin-control-room").click();
    await expect(page.getByTestId("grid-control-room")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Simulated Asset").first()).toBeVisible();

    await page.getByTestId("scenario-overnight-wind-surplus").click();
    await page.getByTestId("start-backboard-run").click();

    const timeline = page.getByTestId("agent-run-timeline");
    await expect(timeline).toBeVisible();
    await expect(timeline.getByText(/Market Analyst/i).first()).toBeVisible({ timeout: 60_000 });
    await expect(timeline.getByText(/tool|validate|simulate|stress|get_/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(timeline.getByText(/unsafe|reject|stress|ranked|completed/i).first()).toBeVisible({
      timeout: 60_000,
    });

    await page.getByRole("button", { name: "Evidence" }).click();
    await expect(page.getByTestId("candidate-comparison")).toBeVisible();
    await expect(page.getByTestId("final-recommendation")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("final-recommendation").getByText(/balanced|recommend|approve/i).first()).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "Operator Q&A" }).click();
    await page.getByTestId("operator-example-prompt").first().click();
    await expect(page.getByTestId("operator-answer").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("operator-answer").first()).toContainText(/balanced|reserve|Mock Backboard/i);

    await page.getByRole("button", { name: "Executive Summary" }).click();
    await expect(page.getByTestId("executive-summary")).toBeVisible();
    await expect(page.getByTestId("exec-net-value")).toBeVisible();
    await expect(page.getByTestId("exec-carbon")).toBeVisible();

    await page.getByRole("button", { name: "Previous Runs" }).click();
    await expect(page.getByTestId("previous-runs-panel")).toBeVisible();
    await expect(page.getByTestId("previous-runs-panel").getByText(/overnight-wind-surplus|completed/i).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("back-to-world-from-control").click();
    await expect(page.getByTestId("world-app")).toBeVisible({ timeout: 30_000 });
  });
});
