import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { LocalFileStorage } from './storage';

describe('LocalFileStorage', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'storage-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('écrit, relit et supprime un fichier', async () => {
    const storage = new LocalFileStorage(dir);
    await storage.put('attachments/ab/1234.bin', Buffer.from('contenu'));
    expect(await text(await storage.get('attachments/ab/1234.bin'))).toBe('contenu');
    await storage.delete('attachments/ab/1234.bin');
    await expect(storage.get('attachments/ab/1234.bin')).rejects.toThrow();
  });

  it('refuse les clés qui sortiraient du dossier ou viennent d’un nom libre', async () => {
    const storage = new LocalFileStorage(dir);
    await expect(storage.put('../evil', Buffer.from('x'))).rejects.toThrow();
    await expect(storage.put('a/../../evil', Buffer.from('x'))).rejects.toThrow();
    await expect(storage.put('Facture Mars.pdf', Buffer.from('x'))).rejects.toThrow();
  });

  it('n’écrase jamais un fichier existant', async () => {
    const storage = new LocalFileStorage(dir);
    await storage.put('k/1.bin', Buffer.from('a'));
    await expect(storage.put('k/1.bin', Buffer.from('b'))).rejects.toThrow();
  });
});
