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

  constructor(apiKey: string, from: string) {
    this.resend = new Resend(apiKey);
    this.from = from;
  }

  async send({ to, subject, text, html }: SendEmailParams): Promise<void> {
    // Resend reports API failures via the error field instead of rejecting.
    const { error } = await this.resend.emails.send({
      from: this.from,
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

  constructor(from: string) {
    this.transport = nodemailer.createTransport({
      host: "localhost",
      port: 1025,
      secure: false,
    });
    this.from = from;
  }

  async send({ to, subject, text, html }: SendEmailParams): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject, text, html });
  }
}

function createMailer(): Mailer {
  if (env.NODE_ENV === "production") {
    if (!env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is required in production");
    }
    return new ResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM);
  }

  return new NodemailerMailer(env.EMAIL_FROM);
}

export const mailer = createMailer();
