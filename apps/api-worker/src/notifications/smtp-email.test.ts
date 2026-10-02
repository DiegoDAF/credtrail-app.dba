import type { Transporter } from "nodemailer";
import { describe, expect, it, vi } from "vitest";

import { createSmtpEmailBinding } from "./smtp-email";

const bindingInput = {
  host: "mail.example.edu",
  port: 465,
  secure: true,
  user: "badges@example.edu",
  password: "secret",
};

const message = {
  from: { email: "badges@example.edu", name: "Badges" },
  to: ["learner@example.edu"],
  subject: "Sign in",
  text: "Use this link.",
};

const createTransporter = () => {
  const sendMail = vi.fn().mockResolvedValue({ messageId: "<msg-1@example.edu>" });
  return { sendMail, transporter: { sendMail } as unknown as Transporter };
};

const sentMail = (sendMail: ReturnType<typeof vi.fn>) => {
  expect(sendMail).toHaveBeenCalledTimes(1);
  return sendMail.mock.calls[0]?.[0] as Record<string, unknown>;
};

describe("createSmtpEmailBinding", () => {
  it("sends builder messages through the transporter", async () => {
    const { sendMail, transporter } = createTransporter();

    const result = await createSmtpEmailBinding(bindingInput, transporter).send(message);

    expect(result).toEqual({ messageId: "<msg-1@example.edu>" });
    expect(sentMail(sendMail)).toMatchObject({
      from: '"Badges" <badges@example.edu>',
      to: ["learner@example.edu"],
      subject: "Sign in",
      text: "Use this link.",
    });
    expect(sentMail(sendMail).bcc).toBeUndefined();
    expect(sentMail(sendMail).replyTo).toBeUndefined();
  });

  it("uses the configured replyTo unless the message sets its own", async () => {
    const configured = createTransporter();
    await createSmtpEmailBinding(
      { ...bindingInput, replyTo: "help@example.edu" },
      configured.transporter,
    ).send(message);
    expect(sentMail(configured.sendMail).replyTo).toBe("help@example.edu");

    const perMessage = createTransporter();
    await createSmtpEmailBinding(
      { ...bindingInput, replyTo: "help@example.edu" },
      perMessage.transporter,
    ).send({
      ...message,
      replyTo: { email: "registrar@example.edu", name: "Registrar" },
    });
    expect(sentMail(perMessage.sendMail).replyTo).toBe('"Registrar" <registrar@example.edu>');
  });

  it("adds the configured bcc to every message", async () => {
    const { sendMail, transporter } = createTransporter();

    await createSmtpEmailBinding({ ...bindingInput, bcc: "archive@example.edu" }, transporter).send(
      message,
    );

    expect(sentMail(sendMail).bcc).toEqual(["archive@example.edu"]);
  });

  it("merges the configured bcc with the message bcc without duplicates", async () => {
    const merged = createTransporter();
    await createSmtpEmailBinding(
      { ...bindingInput, bcc: "archive@example.edu" },
      merged.transporter,
    ).send({
      ...message,
      bcc: "auditor@example.edu",
    });
    expect(sentMail(merged.sendMail).bcc).toEqual(["auditor@example.edu", "archive@example.edu"]);

    const duplicate = createTransporter();
    await createSmtpEmailBinding(
      { ...bindingInput, bcc: "archive@example.edu" },
      duplicate.transporter,
    ).send({
      ...message,
      bcc: { email: "Archive@example.edu", name: "Archive" },
    });
    expect(sentMail(duplicate.sendMail).bcc).toEqual(['"Archive" <Archive@example.edu>']);
  });

  it("skips the configured bcc when it is already a direct recipient", async () => {
    const { sendMail, transporter } = createTransporter();

    await createSmtpEmailBinding({ ...bindingInput, bcc: "archive@example.edu" }, transporter).send(
      {
        ...message,
        to: "archive@example.edu",
      },
    );

    expect(sentMail(sendMail).bcc).toBeUndefined();
  });

  it("rejects messages without recipients", async () => {
    const { transporter } = createTransporter();

    await expect(
      createSmtpEmailBinding(bindingInput, transporter).send({ ...message, to: [] }),
    ).rejects.toThrow("at least one recipient");
  });
});
