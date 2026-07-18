import { test, expect } from "@playwright/test";

test.describe("Skyline world UI", () => {
  test("world exploration and city flow", async ({ page }) => {
    await page.goto("/");

    // Skyline branding is visible.
    await expect(page.getByTestId("world-app")).toBeVisible();
    await expect(page.getByText("Skyline").first()).toBeVisible();

    // Wait for the scene to become ready.
    await expect(page.getByTestId("world-ready")).toBeAttached({
      timeout: 60_000,
    });

    // City explorer lists Toronto.
    const explorer = page.getByTestId("city-explorer");
    await expect(explorer).toBeVisible();
    const torontoRow = page.getByTestId("city-row-toronto");
    await expect(torontoRow).toBeVisible();

    // Selecting Toronto opens the preview card.
    await torontoRow.click();
    await expect(page.getByTestId("city-preview-card")).toBeVisible();

    // Explore city switches to city mode UI.
    await page.getByTestId("explore-city-button").click();
    await expect(page.getByTestId("back-to-world-button")).toBeVisible({
      timeout: 30_000,
    });

    // Open the layer panel and toggle a layer.
    await page.getByRole("button", { name: "Layers" }).first().click();
    const layerPanel = page.getByTestId("layer-panel");
    await expect(layerPanel).toBeVisible();
    await layerPanel
      .getByRole("switch", { name: "Atmosphere and Fog" })
      .click();

    // Return to world view.
    await page.getByTestId("back-to-world-button").click();
    await expect(page.getByTestId("city-explorer")).toBeVisible({
      timeout: 30_000,
    });
  });
});
