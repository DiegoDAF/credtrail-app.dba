import { readFileSync } from "node:fs";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import { join } from "node:path";

/** Owned acceptance relay: requires TLS/auth and never forwards mail externally. */
export async function startSmtpRelay(directory) {
  const messages = [];
  const sockets = new Set();
  const server = new SMTPServer({
    key: readFileSync(join(directory, "key.pem")),
    cert: readFileSync(join(directory, "cert.pem")),
    logger: false,
    closeTimeout: 100,
    onAuth(auth, _session, callback) {
      if (auth.username !== "disposable" || auth.password !== " secret ")
        callback(new Error("Disposable authentication rejected"));
      else callback(null, { user: "disposable" });
    },
    onRcptTo(address, _session, callback) {
      callback(
        address.address === "rejected@example.edu"
          ? Object.assign(new Error("Disposable recipient rejected"), { responseCode: 550 })
          : null,
      );
    },
    onData(stream, session, callback) {
      void simpleParser(stream)
        .then((mail) => {
          messages.push({
            recipients: session.envelope.rcptTo.map((recipient) => recipient.address),
            secure: session.secure,
            subject: mail.subject,
            text: mail.text,
            replyTo: mail.replyTo?.value.map((address) => address.address),
            bcc: mail.headers.has("bcc"),
            kind: mail.headers.get("x-credtrail-email-kind"),
          });
          callback(null, "Accepted by disposable relay");
        })
        .catch(() => callback(new Error("Disposable MIME parse failed")));
    },
  });
  server.on("error", () => undefined);
  server.server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", resolve);
  });
  return {
    port: server.server.address().port,
    messages,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
