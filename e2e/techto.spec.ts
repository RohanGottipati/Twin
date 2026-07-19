import { expect, test } from "@playwright/test";

/**
 * Shell smoke for TwinTO. Full planning runs hit live Backboard and are not
 * covered here (cost / latency); use npm run backboard:smoke for that.
 */

test.describe("TwinTO", () => {
  test("loads the app shell, the map, and the flagship scenario", async ({ page }) => {
    await page.goto("/twinto");

    await expect(page.getByTestId("twinto-app")).toBeVisible();
    await expect(page.getByTestId("toronto-map")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId("scenario-panel")).toBeVisible();
    await expect(page.getByTestId("synthetic-fixture-badge")).toBeVisible();
  });

  test("has no battery, GridTwin, Cesium, or 54-agent roster text on the page", async ({ page }) => {
    await page.goto("/twinto");
    await expect(page.getByTestId("twinto-app")).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/gridtwin/i);
    expect(bodyText).not.toMatch(/cesium/i);
    expect(bodyText).not.toMatch(/battery/i);
    expect(bodyText).not.toMatch(/dispatch plan/i);
    expect(bodyText).not.toMatch(/54 assistant/i);
  });

  test("shows City Copilot chat and consolidated roster messaging", async ({ page }) => {
    await page.goto("/twinto");
    await expect(page.getByTestId("city-copilot-chat")).toBeVisible();
    await expect(page.getByTestId("city-copilot-input")).toBeVisible();
    await page.getByTestId("city-copilot-input").fill("Show Liberty Village on the map");
    await page.getByTestId("city-copilot-send").click();
    await expect(page.getByText(/Showing Liberty Village/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("city-chat-export-pdf")).toBeVisible();
    await expect(page.getByTestId(/^city-answer-export-pdf-/)).toBeVisible();
    await expect(page.getByText(/SIMPLE_MAP_NAVIGATION/i)).toHaveCount(0);
  });

  test("plays the baseline scrubber", async ({ page }) => {
    await page.goto("/twinto");
    await expect(page.getByTestId("twinto-app")).toBeVisible();

    const playback = page.getByTestId("playback-controls");
    await expect(playback).toBeVisible();

    const playButton = playback.getByRole("button", { name: /play/i });
    await playButton.click();
    await page.waitForTimeout(600);
    const clock = await playback.locator("span.font-mono").innerText();
    expect(clock.length).toBeGreaterThan(0);
  });
});
