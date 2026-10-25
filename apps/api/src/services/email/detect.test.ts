import { autoReplyReason, spamReason } from './detect';

const h = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe('autoReplyReason', () => {
  it('reconnaît les réponses d’absence et les rebonds', () => {
    expect(autoReplyReason(h({ 'auto-submitted': 'auto-replied' }), 'a@b.fr', 'Hello')).toContain('Auto-Submitted');
    expect(autoReplyReason(h({ precedence: 'bulk' }), 'a@b.fr', 'News')).toContain('Precedence');
    expect(autoReplyReason(h({}), 'MAILER-DAEMON@mx.fr', 'Undelivered')).toContain('Expéditeur automatique');
    expect(autoReplyReason(h({}), 'claire@client.fr', 'Réponse automatique : absente')).toBe('Sujet de réponse automatique');
    expect(autoReplyReason(h({}), 'no-reply@app.io', 'Votre facture')).toContain('Expéditeur automatique');
  });

  it('laisse passer un message ordinaire', () => {
    expect(autoReplyReason(h({ 'auto-submitted': 'no' }), 'claire@client.fr', 'Re: [TICKET #4] Export')).toBeNull();
    expect(autoReplyReason(h({}), 'noreen@client.fr', 'Absence de données dans l’export')).toBeNull();
  });
});

describe('spamReason', () => {
  it('suit les filtres en amont et la liste de blocage', () => {
    expect(spamReason(h({ 'x-spam-flag': 'YES' }), 'a@b.fr', [])).toBe('X-Spam-Flag: YES');
    expect(spamReason(h({}), 'promo@mail.spam.io', ['@spam.io'])).toContain('@spam.io');
    expect(spamReason(h({}), 'x@b.fr', ['X@B.fr'])).toContain('x@b.fr');
    expect(spamReason(h({ 'x-spam-status': 'No, score=0.1' }), 'a@b.fr', ['@c.fr'])).toBeNull();
  });
});
