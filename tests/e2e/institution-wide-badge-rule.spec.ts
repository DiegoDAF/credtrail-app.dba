import { expect, test } from "@playwright/test";
import { createLiveRulePlacementAvailabilityFixture } from "./helpers/live-rule-placement-availability-fixture";

test("an administrator can save an instructor-confirmed rule without selecting a course", async ({
  page,
  baseURL,
}) => {
  const fixture = await createLiveRulePlacementAvailabilityFixture();
  try {
    const login = new URL("/v1/dev/auth/login-as", baseURL);
    login.searchParams.set("tenantId", fixture.tenantId);
    login.searchParams.set("email", fixture.adminEmail);
    login.searchParams.set("next", `${fixture.rulesPath}/templates`);
    await page.goto(login.toString());
    await page.getByRole("button", { name: "New badge template" }).click();
    await page.getByLabel("Badge name").fill("Library Orientation");
    await page.getByLabel("Description").fill("Complete the library orientation requirement.");
    await page.getByRole("button", { name: "Create and add artwork" }).click();
    await page.getByLabel("Image file").setInputFiles({
      name: "orientation.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await page.getByRole("button", { name: "Upload and use image" }).click();
    await expect(
      page.getByText("Image uploaded and set as this template’s artwork."),
    ).toBeVisible();
    await page.goto(`${fixture.rulesPath}/new`);
    const badge = page.getByRole("combobox", { name: "Badge template" });
    await badge.click();
    await page
      .getByRole("listbox", { name: "Badge templates" })
      .getByRole("option")
      .first()
      .click();
    const reuse = page.getByLabel(
      "I confirm this rule is another valid way to earn the same badge.",
    );
    if (await reuse.isVisible()) await reuse.check();
    await page.locator("#rule-builder-template-preset").selectOption("instructor_confirmation");
    await page.locator("#rule-builder-step-next").click();
    await page
      .getByLabel("What must the instructor confirm?")
      .fill("The learner completed Library Orientation and the final exercise.");
    await expect(page.locator("[data-lms-course-select]")).toHaveCount(0);
    await page.locator("#rule-builder-step-next").click();
    await expect(page.locator("#rule-builder-confirmation-review")).toBeVisible();
    await expect(page.locator("#rule-builder-evidence-test")).toBeHidden();
    await expect(page.locator('[name="issuanceTiming"]')).toHaveValue("manual");
    await expect(page.locator("#rule-builder-save-formal-draft")).toBeEnabled();
    const renewal = page.getByLabel("Require learners to renew this badge");
    await renewal.check();
    await expect(page.getByLabel("Valid for (months)")).toHaveValue("12");
    await page.getByLabel("Valid for (months)").fill("6");
    await page.getByLabel("Valid for (months)").blur();
    await expect(page.locator("#builder-renewal-summary")).toContainText("6 months");
    await renewal.uncheck();
    await expect(page.getByLabel("Valid for (months)")).toBeHidden();
    await renewal.check();
    await page.getByLabel("Valid for (months)").fill("12");
    await page.getByLabel("Valid for (months)").blur();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: "output/institution-wide-rule-desktop.png",
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const workbench = await page.locator(".ct-admin__builder-workbench-panel").boundingBox();
    if (workbench === null) throw new Error("Rule builder must be visible on mobile");
    expect(workbench.x + workbench.width).toBeLessThanOrEqual(390);

    await expect(page.locator("#rule-builder-confirmation-review")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: "output/institution-wide-rule-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/tenants/${fixture.tenantId}/badge-rules`,
    );
    await page.locator("#rule-builder-save-formal-draft").click();
    const response = await saved;
    expect(response.ok(), await response.text()).toBe(true);
    await expect(page).toHaveURL(/\/versions\//);
    await expect(
      page.getByText(
        "Renewal due 12 months after each badge is earned. New completion is required.",
      ),
    ).toBeVisible();
    await expect(
      page
        .getByText("The learner completed Library Orientation and the final exercise.", {
          exact: false,
        })
        .first(),
    ).toBeVisible();
  } finally {
    await page.close();
    await fixture.dispose();
  }
});
