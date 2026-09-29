import { expect, test } from "@playwright/test";

import { demoRoutes, adminEmail, tenantId } from "./helpers/demo-routes";

test("an administrator can define, publish, and evaluate a governed learner pathway", async ({
  page,
  baseURL,
}) => {
  const pathwayTitle = `E2E Evidence Pathway ${String(Date.now())}`;

  await page.goto(`${demoRoutes.admin}/operations/pathways`);
  await expect(page.getByRole("heading", { name: "Learner pathways" })).toBeVisible();
  await page.getByRole("link", { name: "New pathway" }).click();

  await page.getByLabel("Pathway name").fill(pathwayTitle);
  await page
    .getByLabel("What learners are working toward")
    .fill("Complete verified evidence without turning institutional progress into a game.");
  await page.getByLabel("Program owner").selectOption({ index: 1 });
  await page
    .getByRole("combobox", { name: "Requirement 1", exact: true })
    .selectOption({ index: 1 });
  await page
    .getByRole("textbox", { name: "How to complete requirement 1 (optional)", exact: true })
    .fill("Complete Library Orientation, then ask your instructor to confirm completion.");
  await page.getByRole("button", { name: "Create pathway draft" }).click();

  await expect(page.getByRole("heading", { name: pathwayTitle })).toBeVisible();
  await expect(page.getByText("Version 1 · 1 ordered requirements")).toBeVisible();
  await page.getByRole("button", { name: "Publish version" }).click();
  await expect(page.getByText("Pathway version published")).toBeVisible();

  await page.getByLabel("Learner email").fill(adminEmail);
  await page.getByRole("button", { name: "Enroll learner" }).click();
  await expect(page.getByText("Learner enrolled and evaluated")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Learner progress" })).toBeVisible();
  await expect(page.getByText(/In progress|Complete|Needs review/).first()).toBeVisible();
  await expect(page.getByText("Evaluation history (1)")).toBeVisible();
  const login = new URL("/v1/dev/auth/login-as", baseURL);
  login.searchParams.set("tenantId", tenantId);
  login.searchParams.set("email", adminEmail);
  login.searchParams.set("next", `/tenants/${tenantId}/learner/dashboard`);
  await page.goto(login.toString());
  const pathway = page
    .locator(".learner-dashboard__pathway")
    .filter({ has: page.getByRole("heading", { name: pathwayTitle }) });
  await expect(pathway).toBeVisible();
  await expect(pathway).toContainText(
    "Complete Library Orientation, then ask your instructor to confirm completion.",
  );
  await expect(
    pathway.getByRole("link", { name: "View pathway details and evidence" }),
  ).toBeVisible();
  await page.screenshot({
    path: "output/pathway-dashboard-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "output/pathway-dashboard-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});
