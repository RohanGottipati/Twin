import { expect, test } from "@playwright/test";

test.describe("ToronTwin dashboard", () => {
  test("loads the map and core panels", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "ToronTwin" })
    ).toBeVisible();
    // Map layers appear once geodata is loaded. Scenario controls, the map
    // legend, and the artificial idle caret are intentionally absent.
    await expect(page.getByText("Layers", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Scenario", { exact: true })).toHaveCount(0);
    await expect(page.locator(".chat-blink-caret")).toHaveCount(0);
    await expect(page.getByText("Neighbourhood sentiment")).toBeVisible();
    // The map canvas is present.
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    // Localized 3D is entered only after an agent establishes a spatial focus.
    await expect(page.getByTestId("localized-3d-exit")).toHaveCount(0);
  });

  test("toggles a layer", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("switch", { name: /Residents/ });
    await expect(toggle).toHaveAttribute("aria-checked", "true", {
      timeout: 30_000,
    });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("enters and exits localized 3D after an agent map focus", async ({
    page,
  }) => {
    const mapErrors: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (
        message.type() === "error" &&
        /localized-buildings|distance expression/i.test(text)
      ) {
        mapErrors.push(text);
      }
    });
    await page.route("**/api/planner/run", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          question: "Focus Wychwood",
          summary: "Focused Wychwood on the map.",
          ranking: [],
          chosenId: null,
          backboardMode: "test",
          populationMode: "test",
          participatingAgents: [],
          events: [],
          mapActions: [
            {
              type: "fit_bounds",
              bounds: [-79.438, 43.67, -79.403, 43.696],
              padding: 80,
              durationMs: 0,
            },
            {
              type: "highlight_neighbourhoods",
              neighbourhoodIds: ["024"],
            },
          ],
        }),
      });
    });

    await page.goto("/");
    await page.getByTestId("city-copilot-input").fill("Focus Wychwood");
    await page.getByTestId("city-copilot-send").click();

    const exit = page.getByTestId("localized-3d-exit");
    await expect(exit).toBeVisible({ timeout: 30_000 });
    expect(mapErrors).toEqual([]);
    await exit.click();
    await expect(exit).toHaveCount(0);
  });
});
