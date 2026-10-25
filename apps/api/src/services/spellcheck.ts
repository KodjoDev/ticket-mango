import { HttpError } from '../lib/errors';

export interface SpellcheckIssue {
  offset: number;
  length: number;
  message: string;
  /** Catégorie LanguageTool : TYPOS (orthographe), GRAMMAR, PUNCTUATION, TYPOGRAPHY, STYLE… */
  category: string;
  ruleId: string;
  replacements: string[];
}

interface LanguageToolMatch {
  offset: number;
  length: number;
  message: string;
  replacements: { value: string }[];
  rule: { id: string; category: { id: string } };
}

/**
 * Client du serveur LanguageTool auto-hébergé (API HTTP v2). Les textes ne quittent
 * pas l'infrastructure : aucun service tiers n'est contacté.
 */
export class LanguageToolClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async check(text: string, language = 'fr'): Promise<SpellcheckIssue[]> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/v2/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ text, language }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new HttpError(502, 'Le correcteur est injoignable');
    }
    if (!res.ok) throw new HttpError(502, `Le correcteur a répondu ${res.status}`);
    const data = (await res.json()) as { matches: LanguageToolMatch[] };
    return data.matches.map((m) => ({
      offset: m.offset,
      length: m.length,
      message: m.message,
      category: m.rule.category.id,
      ruleId: m.rule.id,
      replacements: m.replacements.slice(0, 5).map((r) => r.value),
    }));
  }
}
