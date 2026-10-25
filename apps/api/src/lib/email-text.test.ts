import { htmlToText, normalizeSubject, REPLY_MARKER, stripQuotedReply, ticketTag } from './email-text';

describe('stripQuotedReply', () => {
  it('coupe au séparateur placé dans nos e-mails', () => {
    expect(stripQuotedReply(`Merci, c'est réglé.\n\n${REPLY_MARKER}\nBonjour, voici…`)).toBe("Merci, c'est réglé.");
  });

  it('coupe à l’en-tête de citation Gmail en français, même sur deux lignes', () => {
    const text = 'Toujours en panne.\n\nLe lun. 27 oct. 2026 à 10:00, Support <support@x.fr> a\nécrit :\n> Bonjour';
    expect(stripQuotedReply(text.replace('a\nécrit', 'a écrit'))).toBe('Toujours en panne.');
  });

  it('coupe au bloc Outlook « De : … Envoyé : … » et retire les lignes citées', () => {
    expect(stripQuotedReply('OK pour moi\n\nDe : Support\nEnvoyé : lundi\nObjet : …')).toBe('OK pour moi');
    expect(stripQuotedReply('Réponse\n> ancienne ligne\n> autre')).toBe('Réponse');
  });

  it('retire la signature mobile et garde le texte si tout était cité', () => {
    expect(stripQuotedReply('Parfait\n\nEnvoyé de mon iPhone')).toBe('Parfait');
    expect(stripQuotedReply('> tout est cité')).toBe('> tout est cité');
  });
});

describe('sujets', () => {
  it('retire les préfixes de réponse et le repère de ticket', () => {
    expect(normalizeSubject('RE : TR: Re: [TICKET #42] Facture en double')).toBe('Facture en double');
    expect(normalizeSubject('   ')).toBe('(sans objet)');
  });

  it('extrait le numéro de ticket', () => {
    expect(ticketTag('Re: [TICKET #1042] Export')).toBe(1042);
    expect(ticketTag('Ticket 1042')).toBeNull();
  });
});

describe('htmlToText', () => {
  it('convertit un corps HTML en texte lisible', () => {
    expect(htmlToText('<p>Bonjour,</p><p>Le <b>CSV</b> est vide.</p><img src="x.png">')).toBe('Bonjour,\n\nLe CSV est vide.');
  });
});
