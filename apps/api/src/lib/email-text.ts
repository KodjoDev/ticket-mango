import { convert } from 'html-to-text';

/** Séparateur placé en tête des e-mails envoyés : tout ce qui suit dans une réponse est la citation. */
export const REPLY_MARKER = '##- Répondez au-dessus de cette ligne -##';

const QUOTE_HEADERS = [
  // Gmail, Apple Mail, Thunderbird (FR/EN) ; l'en-tête peut tenir sur deux lignes.
  /^\s*(le|on)\b.{0,200}?(a écrit|wrote)\s*:\s*$/im,
  /^\s*-{2,}\s*(original message|message d'origine|message transféré|forwarded message)\s*-{2,}/im,
  // Outlook : bloc « De : … Envoyé : … »
  /^\s*(de|from)\s*:.*\n\s*(envoyé|sent|date)\s*:/im,
  /^_{10,}\s*$/m,
];

/** Ne garde que la nouvelle partie d'une réponse par e-mail (sans la citation ni la signature mobile). */
export function stripQuotedReply(text: string): string {
  let cut = text.length;
  const marker = text.indexOf(REPLY_MARKER);
  if (marker >= 0) cut = marker;
  for (const re of QUOTE_HEADERS) {
    const m = re.exec(text.slice(0, cut));
    if (m) cut = Math.min(cut, m.index);
  }
  const kept = text
    .slice(0, cut)
    .split('\n')
    .filter((line) => !line.startsWith('>'))
    .join('\n')
    .replace(/\n\s*(envoyé de mon (iphone|android|smartphone)|sent from my \w+)\s*$/i, '')
    .trim();
  // Une réponse vide (tout était cité) : on conserve le texte complet plutôt que de le perdre.
  return kept || text.trim();
}

export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
    ],
  }).trim();
}

/** Sujet sans les préfixes de réponse et de transfert (Re:, RE :, Fwd:, TR:, Réf.…). */
export function normalizeSubject(subject: string): string {
  let s = subject.trim();
  for (let i = 0; i < 10; i++) {
    const next = s.replace(/^\s*(re|réf|ref|fw|fwd|tr|aw|wg)\s*(\[\d+\])?\s*:\s*/i, '');
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s*\[TICKET #\d+\]\s*/i, ' ').trim() || '(sans objet)';
}

/** Numéro de ticket présent dans le sujet sous la forme [TICKET #12345]. */
export function ticketTag(subject: string): number | null {
  const m = /\[TICKET #(\d{1,9})\]/i.exec(subject);
  return m ? Number(m[1]) : null;
}

export const subjectWithTag = (ticketId: number, subject: string) => `[TICKET #${ticketId}] ${subject}`;
