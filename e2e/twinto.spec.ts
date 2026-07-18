import { expect, test } from "@playwright/test";

/**
 * End-to-end smoke test for TwinTO's product shell, run against
 * `next build && next start` with BACKBOARD_MOCK_MODE forced on (see
 * playwright.config.ts), so this never spends live API credits and never
 * depends on network access to a real Backboard deployment.
 *
 * A full mock planning run walks through ~25 specialist agents plus the
 * Final Policy Judge; timeouts here are generous (well beyond the
 * playwright.config.ts default) to give that room without flaking.
 */

const RUN_TIMEOUT = 90_000;

test.describe("TwinTO", () => {
  test("loads the app shell, the map, and the flagship scenario", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("twinto-app")).toBeVisible();
    await expect(page.getByTestId("toronto-map")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".maplibregl-canvas, .maplibregl-map")).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId("scenario-panel")).toBeVisible();
    await expect(page.getByTestId("synthetic-fixture-badge")).toBeVisible();
  });

  test("has no battery, GridTwin, or Cesium text anywhere on the page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("twinto-app")).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/gridtwin/i);
    expect(bodyText).not.toMatch(/cesium/i);
    expect(bodyText).not.toMatch(/battery/i);
    expect(bodyText).not.toMatch(/dispatch plan/i);
  });

  test("plays the baseline scrubber", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("twinto-app")).toBeVisible();

    const playback = page.getByTestId("playback-controls");
    await expect(playback).toBeVisible();

    const playButton = playback.getByRole("button", { name: /play/i });
    await playButton.click();
    // Give the scrubber a moment to advance, then confirm it is not stuck at 0.
    await page.waitForTimeout(600);
    const clock = await playback.locator("span.font-mono").innerText();
    expect(clock.length).toBeGreaterThan(0);
  });

  test("runs the full mock Backboard planning pipeline end to end", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("twinto-app")).toBeVisible();

    // Confirms we are exercising the mock adapter, not a live Backboard call.
    await expect(page.getByTestId("mock-backboard-badge").first()).toBeVisible({ timeout: 15_000 });

    const startButton = page.getByTestId("start-run-button");
    await expect(startButton).toBeVisible();
    await startButton.click();

    // Agent timeline appears and starts narrating the run.
    const timeline = page.getByTestId("agent-timeline");
    await expect(timeline).toBeVisible();
    await expect(timeline.getByText(/started|framing|establishing/i).first()).toBeVisible({ timeout: RUN_TIMEOUT });

    // Policy candidates appear (always rendered in the left panel).
    const candidates = page.getByTestId("policy-candidates");
    await expect(candidates).toBeVisible();
    await expect(candidates.locator("li").first()).toBeVisible({ timeout: RUN_TIMEOUT });

    // Wait for the run to finish: the Start button reverts from "Cancel run".
    await expect(page.getByTestId("start-run-button")).toHaveText(/start planning run/i, { timeout: RUN_TIMEOUT });

    // Switch to the Policy Lab tab to see citizen reactions and the stress test.
    await page.getByRole("button", { name: "Policy Lab" }).click();
    await expect(page.getByTestId("cohort-reactions")).toBeVisible();
    await expect(page.getByTestId("stress-test-panel")).toBeVisible();
    await expect(page.getByTestId("cohort-reactions").getByText(/%/).first()).toBeVisible({ timeout: 15_000 });

    // Switch to the Recommendation tab to see the final recommendation and ask a question.
    await page.getByRole("button", { name: "Recommendation" }).click();
    const recommendation = page.getByTestId("final-recommendation");
    await expect(recommendation).toBeVisible();
    await expect(recommendation.getByText(/approve|hold for operator|reject/i).first()).toBeVisible({ timeout: 15_000 });

    const operatorPanel = page.getByTestId("operator-question-panel");
    await expect(operatorPanel).toBeVisible();
    await operatorPanel.getByTestId("operator-example-prompt").first().click();
    await expect(operatorPanel.getByTestId("operator-answer").first()).toBeVisible({ timeout: 20_000 });
    await expect(operatorPanel.getByTestId("operator-answer").first()).toContainText(/./, { timeout: 20_000 });

    // Switch to History and confirm this run was persisted to localStorage.
    await page.getByRole("button", { name: "History" }).click();
    const previousRuns = page.getByTestId("previous-runs-panel");
    await expect(previousRuns).toBeVisible();
    await expect(previousRuns.getByText(/saved\)/)).toBeVisible();
    await expect(previousRuns.getByText("0 saved)")).toHaveCount(0);
  });
});
