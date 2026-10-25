import { LanguageToolClient } from './spellcheck';

const ltResponse = {
  matches: [
    {
      offset: 8,
      length: 5,
      message: 'Faute de frappe possible.',
      replacements: [{ value: 'avons' }, { value: 'savons' }],
      rule: { id: 'FR_SPELLING_RULE', category: { id: 'TYPOS' } },
    },
  ],
};

describe('LanguageToolClient', () => {
  it('interroge /v2/check en français et simplifie la réponse', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(ltResponse), { status: 200 }));
    const client = new LanguageToolClient('http://lt:8010/', fetchImpl as unknown as typeof fetch);
    const issues = await client.check('Nous avon reçu');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://lt:8010/v2/check');
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({ text: 'Nous avon reçu', language: 'fr' });
    expect(issues).toEqual([
      {
        offset: 8,
        length: 5,
        message: 'Faute de frappe possible.',
        category: 'TYPOS',
        ruleId: 'FR_SPELLING_RULE',
        replacements: ['avons', 'savons'],
      },
    ]);
  });

  it('signale un correcteur injoignable ou en erreur par un 502', async () => {
    const down = new LanguageToolClient('http://lt', (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    await expect(down.check('x')).rejects.toMatchObject({ statusCode: 502 });

    const failing = new LanguageToolClient('http://lt', (async () => new Response('', { status: 500 })) as unknown as typeof fetch);
    await expect(failing.check('x')).rejects.toMatchObject({ statusCode: 502 });
  });
});
