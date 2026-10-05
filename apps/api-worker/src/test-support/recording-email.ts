export const createRecordingEmailBinding = (): {
  readonly emailBinding: SendEmail;
  readonly messages: EmailMessageBuilder[];
} => {
  const messages: EmailMessageBuilder[] = [];
  return {
    messages,
    emailBinding: {
      send: async (message) => {
        if (!("subject" in message)) throw new Error("Expected a structured email message");
        messages.push(message);
        return { messageId: "recorded-email" };
      },
    },
  };
};
