/**
 * Filtrage des e-mails entrants : réponses automatiques (absence, accusés, rebonds) et spam.
 * Les en-têtes sont passés en minuscules, valeurs brutes.
 */
export type Headers = Map<string, string>;

const AUTO_SUBJECTS = [
  /^\s*(réponse automatique|r[ée]ponse auto|automatic reply|auto[- ]?reply|autoreply|out of (the )?office|abwesenheit|undeliverable|non remis|delivery status notification|mail delivery failed|returned mail)\b/i,
  // « Absence » seul est trop courant dans un sujet légitime (« Absence de données… »).
  /^\s*(absence du bureau|absent(e)? du bureau|absent(e)? jusqu)/i,
];

const AUTO_SENDERS = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce[s]?)([+@.-]|$)/i;

/** Raison pour laquelle le message est une réponse automatique, ou null. */
export function autoReplyReason(headers: Headers, from: string, subject: string): string | null {
  const autoSubmitted = headers.get('auto-submitted');
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') return `Auto-Submitted: ${autoSubmitted}`;
  for (const h of ['x-autoreply', 'x-autorespond', 'x-auto-response']) if (headers.has(h)) return `En-tête ${h}`;
  const precedence = headers.get('precedence')?.toLowerCase();
  if (precedence && ['bulk', 'junk', 'list', 'auto_reply'].includes(precedence)) return `Precedence: ${precedence}`;
  const suppress = headers.get('x-auto-response-suppress')?.toLowerCase() ?? '';
  if (/\b(all|oof|autoreply)\b/.test(suppress) && AUTO_SUBJECTS.some((re) => re.test(subject))) return 'Réponse d’absence';
  if (AUTO_SENDERS.test(from.split('@')[0] ?? '') || AUTO_SENDERS.test(from)) return `Expéditeur automatique (${from})`;
  if (AUTO_SUBJECTS.some((re) => re.test(subject))) return 'Sujet de réponse automatique';
  if (headers.get('content-type')?.toLowerCase().includes('multipart/report')) return 'Rapport de remise';
  return null;
}

/** Spam signalé par les filtres en amont, ou expéditeur bloqué par l'administrateur. */
export function spamReason(headers: Headers, from: string, blocklist: string[]): string | null {
  if (/^\s*yes\b/i.test(headers.get('x-spam-flag') ?? '')) return 'X-Spam-Flag: YES';
  if (/^\s*yes\b/i.test(headers.get('x-spam-status') ?? '')) return 'X-Spam-Status: Yes';
  const address = from.toLowerCase();
  const domain = address.split('@')[1] ?? '';
  const blocked = blocklist
    .map((b) => b.trim().toLowerCase())
    .find((b) => b === address || (b.startsWith('@') && (domain === b.slice(1) || domain.endsWith(`.${b.slice(1)}`))));
  return blocked ? `Expéditeur bloqué (${blocked})` : null;
}
