import { checkCustomValue, type CustomFieldDef } from './custom-fields';

const field = (over: Partial<CustomFieldDef>): CustomFieldDef => ({ key: 'f', label: 'Champ', kind: 'TEXT', required: false, options: [], ...over });

describe('checkCustomValue', () => {
  it('normalise le texte et refuse les excès', () => {
    expect(checkCustomValue(field({}), '  abc ')).toEqual({ ok: true, value: 'abc' });
    expect(checkCustomValue(field({}), 'x'.repeat(501)).ok).toBe(false);
    expect(checkCustomValue(field({}), 12).ok).toBe(false);
  });

  it('traite le vide selon le caractère obligatoire', () => {
    expect(checkCustomValue(field({}), '  ')).toEqual({ ok: true, value: null });
    expect(checkCustomValue(field({ required: true }), null)).toEqual({ ok: false, error: '« Champ » : valeur obligatoire' });
  });

  it('valide nombre, date et liste', () => {
    expect(checkCustomValue(field({ kind: 'NUMBER' }), 3.5)).toEqual({ ok: true, value: 3.5 });
    expect(checkCustomValue(field({ kind: 'NUMBER' }), '3').ok).toBe(false);
    expect(checkCustomValue(field({ kind: 'DATE' }), '2026-10-26').ok).toBe(true);
    expect(checkCustomValue(field({ kind: 'DATE' }), '2026-13-45').ok).toBe(false);
    expect(checkCustomValue(field({ kind: 'SELECT', options: ['a', 'b'] }), 'b').ok).toBe(true);
    expect(checkCustomValue(field({ kind: 'SELECT', options: ['a'] }), 'z').ok).toBe(false);
  });

  it('une case à cocher vide vaut false et n’est jamais obligatoire', () => {
    expect(checkCustomValue(field({ kind: 'CHECKBOX', required: true }), undefined)).toEqual({ ok: true, value: false });
    expect(checkCustomValue(field({ kind: 'CHECKBOX' }), 'oui').ok).toBe(false);
  });
});
