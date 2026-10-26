import { normalizeExternalStatus, type DevProviderName } from '@ticketing/shared';
import { badGateway, badRequest } from '../../lib/errors';

/** Issue telle que vue par le ticketing, quel que soit l'outil. */
export interface ExternalIssue {
  /** Jira : PROJ-12. GitHub : owner/repo#34. */
  key: string;
  url: string;
  title: string;
  /** Statut Jira, ou étiquette de statut / état GitHub (open, closed). */
  status: string;
  fixVersion: string | null;
}

export interface IssueClient {
  createIssue(input: { title: string; body: string }): Promise<ExternalIssue>;
  /** Accepte une clé, un numéro ou l'URL de l'issue. */
  getIssue(reference: string): Promise<ExternalIssue>;
}

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Paramètres d'une intégration nécessaires aux appels sortants (jeton déjà déchiffré). */
export interface ClientConfig {
  provider: DevProviderName;
  baseUrl: string | null;
  account: string | null;
  token: string;
  project: string;
  issueType: string;
  statusMap: Record<string, string>;
}

const TIMEOUT_MS = 10_000;

async function call(fetcher: HttpFetch, tool: string, url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw badGateway(`${tool} est injoignable`);
  }
  if (res.status === 401 || res.status === 403) throw badGateway(`${tool} a refusé les identifiants (jeton invalide ou droits insuffisants)`);
  if (res.status === 404) throw badRequest(`Issue ou projet introuvable dans ${tool}`);
  if (!res.ok) throw badGateway(`${tool} a répondu avec l'erreur ${res.status}`);
  return res.status === 204 ? null : res.json();
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/** Texte brut → document Atlassian (ADF) : un paragraphe par bloc séparé par une ligne vide. */
function toAdf(text: string) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
  };
}

interface JiraIssue {
  key: string;
  fields: { summary: string; status?: { name: string }; fixVersions?: { name: string }[] };
}

/** Convertit une issue Jira (API ou webhook) en issue externe. */
export function jiraIssue(baseUrl: string, issue: JiraIssue): ExternalIssue {
  return {
    key: issue.key,
    url: `${trimSlash(baseUrl)}/browse/${issue.key}`,
    title: issue.fields.summary,
    status: issue.fields.status?.name ?? '',
    fixVersion: issue.fields.fixVersions?.map((v) => v.name).join(', ') || null,
  };
}

export class JiraClient implements IssueClient {
  constructor(
    private readonly c: ClientConfig,
    private readonly fetcher: HttpFetch,
  ) {}

  private get base() {
    return trimSlash(this.c.baseUrl ?? '');
  }

  private get headers() {
    const basic = Buffer.from(`${this.c.account ?? ''}:${this.c.token}`).toString('base64');
    return { authorization: `Basic ${basic}`, accept: 'application/json', 'content-type': 'application/json' };
  }

  async createIssue({ title, body }: { title: string; body: string }) {
    const created = (await call(this.fetcher, 'Jira', `${this.base}/rest/api/3/issue`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        fields: {
          project: { key: this.c.project },
          summary: title.slice(0, 250),
          issuetype: { name: this.c.issueType },
          description: toAdf(body),
        },
      }),
    })) as { key: string };
    return this.getIssue(created.key);
  }

  async getIssue(reference: string) {
    const key = reference.match(/[A-Z][A-Z0-9_]+-\d+/i)?.[0]?.toUpperCase();
    if (!key) throw badRequest('Clé Jira invalide (ex. APP-12)');
    if (!key.startsWith(`${this.c.project.toUpperCase()}-`)) {
      throw badRequest(`L'issue doit appartenir au projet ${this.c.project}`);
    }
    const issue = (await call(this.fetcher, 'Jira', `${this.base}/rest/api/3/issue/${key}?fields=summary,status,fixVersions`, {
      headers: this.headers,
    })) as JiraIssue;
    return jiraIssue(this.base, issue);
  }
}

interface GithubIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  labels?: ({ name: string } | string)[];
  milestone?: { title: string } | null;
}

/** Statut d'une issue GitHub : première étiquette connue de la table de correspondance, sinon l'état. */
export function githubIssue(repo: string, issue: GithubIssue, statusMap: Record<string, string>): ExternalIssue {
  const labels = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
  const label = labels.find((l) => normalizeExternalStatus(l) in statusMap);
  return {
    key: `${repo}#${issue.number}`,
    url: issue.html_url,
    title: issue.title,
    status: label ?? issue.state,
    fixVersion: issue.milestone?.title ?? null,
  };
}

export class GithubClient implements IssueClient {
  constructor(
    private readonly c: ClientConfig,
    private readonly fetcher: HttpFetch,
  ) {}

  private get base() {
    return trimSlash(this.c.baseUrl || 'https://api.github.com');
  }

  private get headers() {
    return {
      authorization: `Bearer ${this.c.token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    };
  }

  async createIssue({ title, body }: { title: string; body: string }) {
    const issue = (await call(this.fetcher, 'GitHub', `${this.base}/repos/${this.c.project}/issues`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ title: title.slice(0, 250), body: body.slice(0, 60_000) }),
    })) as GithubIssue;
    return githubIssue(this.c.project, issue, this.c.statusMap);
  }

  async getIssue(reference: string) {
    const match = reference.match(/(?:github\.com\/([\w.-]+\/[\w.-]+)\/issues\/|([\w.-]+\/[\w.-]+)#|#)?(\d+)\/?$/);
    if (!match) throw badRequest('Référence GitHub invalide (ex. 34, #34 ou URL de l\'issue)');
    const repo = match[1] ?? match[2] ?? this.c.project;
    if (repo.toLowerCase() !== this.c.project.toLowerCase()) throw badRequest(`L'issue doit appartenir au dépôt ${this.c.project}`);
    const issue = (await call(this.fetcher, 'GitHub', `${this.base}/repos/${this.c.project}/issues/${match[3]}`, {
      headers: this.headers,
    })) as GithubIssue;
    return githubIssue(this.c.project, issue, this.c.statusMap);
  }
}

export function buildClient(config: ClientConfig, fetcher: HttpFetch): IssueClient {
  return config.provider === 'JIRA' ? new JiraClient(config, fetcher) : new GithubClient(config, fetcher);
}
