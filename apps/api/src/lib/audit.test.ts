import { diff } from './audit';

describe('diff', () => {
  it('ne retient que les champs modifiés', () => {
    expect(diff({ a: 1, b: 'x', c: null }, { a: 1, b: 'y', c: null })).toEqual({
      b: { from: 'x', to: 'y' },
    });
  });

  it('traite undefined et null comme équivalents', () => {
    expect(diff<{ a?: string | null }>({ a: null }, { a: undefined })).toEqual({});
  });

  it('compare les dates par valeur', () => {
    expect(diff({ d: new Date(0) }, { d: new Date(0) })).toEqual({});
  });
});
