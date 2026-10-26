import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

/**
 * Stockage des fichiers (pièces jointes, e-mails bruts conservés). Les clés sont générées
 * par l'application, jamais dérivées d'un nom de fichier fourni par l'utilisateur.
 * Une implémentation S3 (AWS, OVH, Scaleway, MinIO) pourra remplacer le disque local.
 */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    if (!/^[a-z0-9/-]+(\.[a-z0-9]+)?$/.test(key)) throw new Error(`Clé de stockage invalide : ${key}`);
    const full = resolve(join(this.root, key));
    // Défense en profondeur : jamais en dehors du dossier racine.
    if (!full.startsWith(this.root + sep)) throw new Error('Clé de stockage hors du dossier');
    return full;
  }

  async put(key: string, data: Buffer) {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data, { flag: 'wx' });
  }

  async get(key: string): Promise<Readable> {
    const file = this.path(key);
    await stat(file);
    return createReadStream(file);
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

/** Stockage en mémoire, pour les tests. */
export class MemoryFileStorage implements FileStorage {
  readonly files = new Map<string, Buffer>();

  async put(key: string, data: Buffer) {
    this.files.set(key, data);
  }

  async get(key: string): Promise<Readable> {
    const data = this.files.get(key);
    if (!data) throw Object.assign(new Error('Fichier introuvable'), { code: 'ENOENT' });
    const { Readable } = await import('node:stream');
    return Readable.from(data);
  }

  async delete(key: string) {
    this.files.delete(key);
  }
}
