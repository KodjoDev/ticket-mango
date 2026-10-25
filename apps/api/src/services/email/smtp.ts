import nodemailer from 'nodemailer';
import type { MailMessage, MailTransport } from './outbound';

/** Envoi SMTP (SMTP_URL, ex. smtp://utilisateur:motdepasse@smtp.exemple.fr:587). */
export class SmtpTransport implements MailTransport {
  readonly delivers = true;
  private readonly transporter;

  constructor(url: string) {
    this.transporter = nodemailer.createTransport(url);
  }

  async send(m: MailMessage) {
    await this.transporter.sendMail({
      from: m.from,
      to: m.to,
      subject: m.subject,
      text: m.text,
      messageId: m.messageId,
      inReplyTo: m.inReplyTo,
      references: m.references,
      headers: m.headers,
      attachments: m.attachments,
    });
  }
}

/** Sans SMTP configuré : les e-mails sont journalisés au lieu d'être envoyés. */
export class LogTransport implements MailTransport {
  readonly delivers = false;

  constructor(private readonly log: (msg: string) => void) {}

  async send(m: MailMessage) {
    this.log(`E-mail non envoyé (SMTP_URL absent) : « ${m.subject} » → ${m.to}`);
  }
}

/** Capture en mémoire, pour les tests. */
export class MemoryTransport implements MailTransport {
  readonly delivers = true;
  readonly sent: MailMessage[] = [];
  failNext = 0;

  async send(m: MailMessage) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('Serveur SMTP indisponible');
    }
    this.sent.push(m);
  }
}
