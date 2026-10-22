import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { env } from "#app/env/index.ts";

interface SendEmailParams {
  to: string;
  subject: string;
  // text is the fallback part; html, when present, is the rich variant of the
  // same content.
  text: string;
  html?: string;
}

// send() rejects on failure; callers decide whether to await, retry, or log.
interface Mailer {
  send(params: SendEmailParams): Promise<void>;
}

class NodemailerMailer implements Mailer {
  private transport: nodemailer.Transporter;
  private from: string;
  private replyTo?: string;

  constructor(
    from: string,
    replyTo: string | undefined,
    transport: SMTPTransport.Options | string,
  ) {
    this.transport = nodemailer.createTransport(transport);
    this.from = from;
    this.replyTo = replyTo;
  }

  async send({ to, subject, text, html }: SendEmailParams): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      replyTo: this.replyTo,
      to,
      subject,
      text,
      html,
    });
  }
}

function createMailer(): Mailer | null {
  if (env.NODE_ENV === "development") {
    return new NodemailerMailer(env.EMAIL_FROM ?? "Everr <noreply@localhost>", env.EMAIL_REPLY_TO, {
      host: "localhost",
      port: 1025,
      secure: false,
    });
  }

  if (!env.EMAIL_DSN) return null;
  if (!env.EMAIL_FROM) {
    throw new Error("EMAIL_FROM is required when EMAIL_DSN is configured");
  }
  return new NodemailerMailer(env.EMAIL_FROM, env.EMAIL_REPLY_TO, env.EMAIL_DSN);
}

export const mailer = createMailer();
