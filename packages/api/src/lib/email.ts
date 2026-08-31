/**
 * The post office — the one place a letter leaves this system.
 *
 * There was none. `SES_EMAIL_SENDER` sat in the env files wired to nothing,
 * migration 0010 dropped email verification because "no mail transport was
 * ever wired", and the login throttle's 429 deliberately did not mention
 * password reset because the door it named did not exist. This module is the
 * transport those three things were waiting on; reset is its first customer.
 *
 * Posture:
 *   - `SES_EMAIL_SENDER` set → SES v2 SendEmail, plain text only. A letter
 *     about getting back into your memory needs words, not markup.
 *   - not set → the letter is PRINTED (console), not posted, and the result
 *     says so. Local dev reads its mail in the worker log; nothing pretends
 *     a letter went out. Callers decide whether unposted is acceptable —
 *     for reset it is, because the response never reveals whether a letter
 *     went anywhere at all.
 *   - tests inject a scripted sender via `setEmailSenderForTests`, the same
 *     shape the model provider uses.
 *
 * Failures throw. A reset request that cannot post its letter must surface
 * on the row and in the log, not vanish into a 200 the person waits on.
 */
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";

export interface OutgoingEmail {
  to: string;
  subject: string;
  /** Plain text body. There is deliberately no HTML lane. */
  text: string;
}

export interface EmailSendResult {
  /** False when no sender is configured and the letter was printed instead. */
  posted: boolean;
}

export type EmailSender = (email: OutgoingEmail) => Promise<EmailSendResult>;

export function getConfiguredEmailSender(): string | null {
  const sender = process.env.SES_EMAIL_SENDER?.trim();
  return sender && sender.length > 0 ? sender : null;
}

let sesClient: SESv2Client | null = null;

async function sendThroughSes(email: OutgoingEmail, sender: string): Promise<EmailSendResult> {
  sesClient ??= new SESv2Client({});
  await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: sender,
      Destination: { ToAddresses: [email.to] },
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: "UTF-8" },
          Body: { Text: { Data: email.text, Charset: "UTF-8" } },
        },
      },
    }),
  );
  return { posted: true };
}

/** The letter, printed instead of posted — dev reads its mail in the log. */
function printLetter(email: OutgoingEmail): EmailSendResult {
  console.log(
    `[email] no sender configured — letter printed, not posted\nto: ${email.to}\nsubject: ${email.subject}\n${email.text}`,
  );
  return { posted: false };
}

let senderForTests: EmailSender | null = null;

export function setEmailSenderForTests(sender: EmailSender | null): void {
  senderForTests = sender;
}

export async function sendEmail(email: OutgoingEmail): Promise<EmailSendResult> {
  if (senderForTests) return senderForTests(email);
  const sender = getConfiguredEmailSender();
  if (!sender) return printLetter(email);
  return sendThroughSes(email, sender);
}
