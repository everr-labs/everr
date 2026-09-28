import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { env } from "@/env";

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
    transport: SMTPTransport.Options,
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

function createMailer(): Mailer {
  if (env.NODE_ENV === "production") {
    if (
      !env.EMAIL_SMTP_HOST ||
      !env.EMAIL_SMTP_PORT ||
      !env.EMAIL_SMTP_USER ||
      !env.EMAIL_SMTP_PASSWORD
    ) {
      throw new Error("Email SMTP configuration is required in production");
    }
    return new NodemailerMailer(env.EMAIL_FROM, env.EMAIL_REPLY_TO, {
      host: env.EMAIL_SMTP_HOST,
      port: env.EMAIL_SMTP_PORT,
      secure: true,
      auth: {
        user: env.EMAIL_SMTP_USER,
        pass: env.EMAIL_SMTP_PASSWORD,
      },
    });
  }

  return new NodemailerMailer(env.EMAIL_FROM, env.EMAIL_REPLY_TO, {
    host: "localhost",
    port: 1025,
    secure: false,
  });
}

export const mailer = createMailer();
