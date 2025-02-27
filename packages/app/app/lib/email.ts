import type { ReactElement } from 'react';
import { render } from '@react-email/render';
import { Resend } from 'resend';

let resend: Resend | undefined;

interface SendParams {
	to: string | string[];
	subject: string;
	react: ReactElement;
}

interface SendEmailResult {
	id?: string;
}

export async function sendEmail(params: SendParams): Promise<SendEmailResult> {
	if (process.env.EMAIL_FROM === undefined) {
		throw new Error('EMAIL_FROM is not set');
	}

	if (process.env.NODE_ENV === 'production') {
		if (!resend) {
			resend = new Resend(process.env.RESEND_API_KEY);
		}

		const res = await resend.emails.send({
			...params,
			from: process.env.EMAIL_FROM,
		});
		if (res.error) {
			throw new Error(`Error sending message: ${res.error.message}`, {});
		}
		return { id: res.data?.id };
	}

	const mailer = await initMailer();
	const res = await mailer.sendMail({
		...params,
		html: await render(params.react),
	});

	return { id: res.messageId };
}

async function initMailer() {
	const nodemailer = await import('nodemailer');

	const transporter = nodemailer.createTransport({
		host: 'localhost',
		port: 1025,
		secure: false,
	});

	return transporter;
}
