import nodemailer from "nodemailer";
import { Resend } from "resend";
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

class ResendMailer implements Mailer {
  private resend: Resend;
  private from: string;
  private replyTo?: string;

  constructor(apiKey: string, from: string, replyTo?: string) {
    this.resend = new Resend(apiKey);
    this.from = from;
    this.replyTo = replyTo;
  }

  async send({ to, subject, text, html }: SendEmailParams): Promise<void> {
    // Resend reports API failures via the error field instead of rejecting.
    const { error } = await this.resend.emails.send({
      from: this.from,
      replyTo: this.replyTo,
      to,
      subject,
      text,
      html,
    });
    if (error) {
      throw new Error(`resend send failed: ${error.name}: ${error.message}`);
    }
  }
}

class NodemailerMailer implements Mailer {
  private transport: nodemailer.Transporter;
  private from: string;
  private replyTo?: string;

  constructor(from: string, replyTo?: string) {
    this.transport = nodemailer.createTransport({
      host: "localhost",
      port: 1025,
      secure: false,
    });
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
  const from = env.EMAIL_FROM_NAME
    ? `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM}>`
    : env.EMAIL_FROM;

  if (env.NODE_ENV === "production") {
    if (!env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is required in production");
    }
    return new ResendMailer(env.RESEND_API_KEY, from, env.EMAIL_REPLY_TO);
  }

  return new NodemailerMailer(from, env.EMAIL_REPLY_TO);
}

export const mailer = createMailer();
