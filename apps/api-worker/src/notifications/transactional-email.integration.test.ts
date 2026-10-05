import { afterEach, expect, it } from "vitest";
import {
  cleanupTestResources,
  createBadgeRuleIntegrationFixture,
  createTestPostgresDatabase,
  describeDbIntegration,
} from "../../../../packages/db/src/postgres-test-support";
import { createSmtpTestServer, type SmtpTestServer } from "../test-support/smtp-test-server";
import { createNodeEmail } from "../runtime/node-email";
import { sendMagicLinkEmailNotification } from "./send-magic-link-email";
import { sendPasswordResetEmailNotification } from "./send-password-reset-email";
import { sendMemberInviteEmailNotification } from "./send-member-invite-email";
import { sendIssuanceEmailNotification } from "./send-issuance-email";
import {
  sendBadgeRuleApprovalSubmittedEmail,
  sendBadgeRuleApprovalDecisionEmail,
} from "./send-badge-rule-approval-email";
import { sendBadgeRuleLifecycleReminderNotifications } from "./send-badge-rule-lifecycle-email";

const tenantIds: string[] = [];
const userIds: string[] = [];
let relay: SmtpTestServer | undefined;
afterEach(async () => {
  await relay?.close();
  relay = undefined;
  if (tenantIds.length)
    await cleanupTestResources(createTestPostgresDatabase(), { tenantIds, userIds });
  tenantIds.length = 0;
  userIds.length = 0;
});

describeDbIntegration("shared transactional email delivery", () => {
  it("delivers every notification builder as HTML plus text through TLS SMTP", async () => {
    const fixture = await createBadgeRuleIntegrationFixture();
    tenantIds.push(fixture.tenantId);
    userIds.push(fixture.userId);
    relay = await createSmtpTestServer();
    const emailBinding = createNodeEmail(relay.env).binding;
    const common = {
      emailBinding,
      tenantId: fixture.tenantId,
      tenantDisplayName: "Example University",
      recipientEmail: "learner@example.edu",
    };
    const url = "https://badges.example.edu/access?token=disposable-private-token";
    await sendMagicLinkEmailNotification({
      ...common,
      magicLinkUrl: url,
      expiresAtIso: "2026-10-05T12:00:00Z",
    });
    await sendPasswordResetEmailNotification({ ...common, resetUrl: url });
    await sendMemberInviteEmailNotification({ ...common, role: "issuer", signInUrl: url });
    const approval = {
      ...common,
      ruleName: "Graduation",
      versionNumber: 1,
      reviewUrl: "https://badges.example.edu/review",
    };
    await sendBadgeRuleApprovalSubmittedEmail({ ...approval, stepLabel: "Registrar review" });
    await sendBadgeRuleApprovalDecisionEmail({
      ...approval,
      decisionLabel: "Approved",
      comment: '<script>alert("unsafe")</script>',
    });
    await sendBadgeRuleLifecycleReminderNotifications(fixture.db, {
      ...approval,
      dueAt: "2026-10-06",
      reminderType: "expiry",
      adminUrl: approval.reviewUrl,
    });
    await sendIssuanceEmailNotification({
      ...common,
      badgeTitle: "Graduation",
      assertionId: "internal-assertion",
      issuedAtIso: "2026-10-05",
      publicBadgeUrl: "https://badges.example.edu/badges/123",
      verificationUrl: "https://badges.example.edu/badges/123/verification",
      credentialDownloadUrl: "https://badges.example.edu/badges/123/download",
    });
    expect(relay.messages).toHaveLength(7);
    for (const message of relay.messages) {
      expect(message.secure).toBe(true);
      expect(message.mail.text).toContain("Example University");
      expect(message.mail.html).toContain("Example University");
      expect(message.mail.html).toContain("<!DOCTYPE html>");
      expect(message.mail.html).not.toContain("<script>");
      expect(message.mail.replyTo?.value[0]?.address).toBe("support@example.edu");
      expect(message.mail.headers.has("bcc")).toBe(false);
    }
    for (const message of relay.messages.filter(
      (message) => message.mail.headers.get("x-credtrail-email-kind") !== "issuance",
    )) {
      expect(message.recipients).not.toContain("records@example.edu");
    }
    expect(relay.messages.at(-1)?.recipients).toContain("records@example.edu");
    expect(relay.messages.at(-1)?.mail.html).not.toContain("disposable-private-token");
    expect(relay.messages.at(-1)?.mail.text).not.toContain("internal-assertion");
    expect(relay.messages[0]?.mail.html).toContain(url);
    expect(relay.messages[0]?.mail.text).toContain(url);
  });
});
