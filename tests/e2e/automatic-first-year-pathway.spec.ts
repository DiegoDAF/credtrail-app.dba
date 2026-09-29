import { expect, test, type Page } from "@playwright/test";
import { createPostgresDatabase } from "@credtrail/db/postgres";
import { upsertUserByEmail, upsertTenantMembershipRole } from "@credtrail/db";
import { loadLocalDevEnv, requireEnv } from "../../scripts/local-dev-env.mjs";
import { demoRoutes, adminEmail, tenantId } from "./helpers/demo-routes";

const createBadge = async (page: Page, title: string): Promise<void> => {
  await page.goto(`${demoRoutes.admin}/rules/templates`);
  await page.getByRole("button", { name: "New badge template" }).click();
  await page.getByLabel("Badge name").fill(title);
  await page.getByLabel("Description").fill(`Awarded for completing ${title}.`);
  await page.getByRole("button", { name: "Create and add artwork" }).click();
  await page.getByLabel("Image file").setInputFiles({
    name: "training.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "Upload and use image" }).click();
  await expect(page.getByText("Image uploaded and set as this template’s artwork.")).toBeVisible();
};

test("three trainings automatically earn a First-Year badge that the learner can open", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  loadLocalDevEnv();
  const token = requireEnv("JOB_PROCESSOR_TOKEN");
  const db = createPostgresDatabase({
    databaseUrl: requireEnv("DATABASE_URL"),
    connectionMode: "single-use",
  });
  const suffix = crypto.randomUUID().slice(0, 8);
  const trainingTitles = ["Harassment prevention", "AI training", "Library research"].map(
    (title) => `${title} ${suffix}`,
  );
  const finalTitle = `First-Year badge ${suffix}`;
  const pathwayTitle = `First-Year readiness ${suffix}`;
  const learnerEmail = `first-year-${suffix}@example.edu`;
  const learnerUser = await upsertUserByEmail(db, learnerEmail);
  await upsertTenantMembershipRole(db, { tenantId, userId: learnerUser.id, role: "viewer" });
  for (const title of [...trainingTitles, finalTitle]) await createBadge(page, title);
  const templates = (
    await db
      .prepare("SELECT id, title FROM badge_templates WHERE tenant_id = ?")
      .bind(tenantId)
      .all<{ id: string; title: string }>()
  ).results;
  const badgeId = (title: string): string => {
    const badge = templates.find((template) => template.title === title);
    if (badge === undefined) throw new Error(`Badge ${title} was not created`);
    return badge.id;
  };
  await page.goto(`${demoRoutes.admin}/operations/pathways`);
  await page.getByRole("link", { name: "New pathway" }).click();
  await page.getByLabel("Pathway name").fill(pathwayTitle);
  await page
    .getByLabel("What learners are working toward")
    .fill(
      "Complete all three trainings. Your seminar instructor checks your First-Year badge in CredTrail.",
    );
  await page.getByLabel("Program owner").selectOption({ index: 1 });
  await page.getByText("Add more requirements", { exact: true }).click();
  for (const [index, title] of trainingTitles.entries()) {
    await page
      .getByRole("combobox", { name: `Requirement ${index + 1}`, exact: true })
      .selectOption(`badge:${badgeId(title)}`);
    await page
      .getByLabel(`How to complete requirement ${index + 1} (optional)`)
      .fill(`Complete the ${title} workshop.`);
  }
  await expect(page.getByLabel("When every requirement is satisfied")).toHaveValue(
    "issue_credential",
  );
  await page.locator('select[name="finalBadgeTemplateId"]').selectOption(badgeId(finalTitle));
  await page.getByRole("button", { name: "Create pathway draft" }).click();
  await page.getByRole("button", { name: "Publish version" }).click();
  await page.getByLabel("Learner email").fill(learnerEmail);
  await page.getByRole("button", { name: "Enroll learner" }).click();
  await expect(page.getByText("Learner enrolled and evaluated")).toBeVisible();
  const pathwayUrl = page.url();
  const processJobs = async (): Promise<void> => {
    for (let round = 0; round < 4; round++) {
      const response = await page.request.post("/v1/jobs/process", {
        headers: { authorization: `Bearer ${token}`, origin: new URL(page.url()).origin },
        data: { limit: 100 },
      });
      expect(response.ok(), await response.text()).toBe(true);
    }
  };
  for (const [index, title] of trainingTitles.entries()) {
    await page.goto(
      `${demoRoutes.admin}/operations/issue?badgeTemplateId=${encodeURIComponent(badgeId(title))}`,
    );
    await page.getByLabel("Recipient email").fill(learnerEmail);
    await page.getByRole("button", { name: "Issue badge", exact: true }).click();
    await expect(page).toHaveURL(/\/issue\/[^/]+\/receipt$/);
    await processJobs();
    const awards = await db
      .prepare(
        "SELECT id FROM assertions WHERE tenant_id = ? AND badge_template_id = ? AND recipient_identity = ?",
      )
      .bind(tenantId, badgeId(finalTitle), learnerEmail)
      .all<{ id: string }>();
    expect(awards.results).toHaveLength(index === 2 ? 1 : 0);
  }
  await processJobs();
  await page.goto(pathwayUrl);
  await expect(page.getByRole("link", { name: "View final credential" })).toBeVisible();
  const login = new URL("/v1/dev/auth/login-as", baseURL);
  login.searchParams.set("tenantId", tenantId);
  login.searchParams.set("email", learnerEmail);
  login.searchParams.set("next", `/tenants/${tenantId}/learner/dashboard`);
  await page.goto(login.toString());
  const pathway = page
    .locator(".learner-dashboard__pathway")
    .filter({ has: page.getByRole("heading", { name: pathwayTitle }) });
  await expect(pathway.getByRole("link", { name: "View your final badge" })).toBeVisible();
  await expect(pathway.getByText("Complete", { exact: true })).toHaveCount(3);
  await page.screenshot({ path: "output/first-year-awarded-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "output/first-year-awarded-mobile.png", fullPage: true });
  await pathway.getByRole("link", { name: "View your final badge" }).click();
  await expect(page.getByRole("heading", { name: finalTitle, exact: true })).toBeVisible();
  // Restore the shared seeded admin session for any subsequent browser workflows.
  login.searchParams.set("email", adminEmail);
  login.searchParams.set("next", demoRoutes.admin);
  await page.goto(login.toString());
});
