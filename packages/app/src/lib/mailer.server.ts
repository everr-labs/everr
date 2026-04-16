import nodemailer from "nodemailer";
import { Resend } from "resend";
import { env } from "@/env";

interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
}

interface Mailer {
  send(params: SendEmailParams): void;
}

class ResendMailer implements Mailer {
  private resend: Resend;
  private from: string;

  constructor(apiKey: string, from: string) {
    this.resend = new Resend(apiKey);
    this.from = from;
  }

  send({ to, subject, text }: SendEmailParams): void {
    void this.resend.emails
      .send({ from: this.from, to, subject, text })
      .catch((err) => console.error("[mailer] resend error:", err));
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

  send({ to, subject, text }: SendEmailParams): void {
    void this.transport
      .sendMail({ from: this.from, to, subject, text })
      .catch((err) => console.error("[mailer] nodemailer error:", err));
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
