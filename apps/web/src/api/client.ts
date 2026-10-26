import type {
  AlertKindName,
  PageBlockItem,
  Report,
  ReleaseCategory,
  DevProviderName,
  IncidentSeverity,
  IncidentStatus,
  LayoutItem,
  ListColumn,
  MacroActions,
  OptionField,
  PriorityMatrix,
  Role,
  SlaPolicy,
  TicketFormField,
  TicketStatus,
  ViewFilters,
} from '@ticketing/shared';
import type {
  Agent,
  AlertChannel,
  AppConfig,
  RequesterHistoryEntry,
  CustomField,
  CustomFieldInput,
  PurgeResult,
  PublicRelease,
  ReleaseCandidate,
  ReleaseDetail,
  ReleaseSummary,
  IncidentDetail,
  IncidentSummary,
  PublicStatus,
  AuditEntry,
  Booking,
  Comment,
  DevIntegration,
  DevIntegrationChoice,
  FieldOption,
  AdminGroup,
  AttachmentRef,
  EmailSettings,
  InboundLog,
  InboundStatus,
  Mailbox,
  OutboundLog,
  Macro,
  ManagedUser,
  Notification,
  RoutingRule,
  RuleConditions,
  TicketDetail,
  Meeting,
  Page,
  SpellcheckIssue,
  Tag,
  Ticket,
  TicketFilters,
  TicketInput,
  User,
  View,
} from './types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

/** Lien de téléchargement d'une pièce jointe (même origine : le cookie de session suit). */
export const attachmentUrl = (id: string) => `${BASE_URL}/attachments/${id}`;

export interface DevIntegrationInput {
  provider: DevProviderName;
  name: string;
  isActive: boolean;
  baseUrl: string | null;
  account: string | null;
  /** Écriture seule ; vide = inchangé. */
  token: string;
  project: string;
  issueType: string;
  statusMap: Record<string, TicketStatus>;
}

export interface MailboxInput {
  name: string;
  address: string;
  isActive: boolean;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean;
  imapUser: string | null;
  /** Vide : mot de passe inchangé. */
  imapPassword: string;
  imapFolder: string;
  defaultType: string | null;
  defaultGroupId: string | null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Appelé sur toute réponse 401, pour renvoyer vers la connexion. */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Un FormData (pièces jointes) part tel quel : le navigateur pose lui-même l'en-tête multipart.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    // La session voyage dans un cookie httpOnly posé par l'API.
    credentials: 'same-origin',
    headers: body === undefined || isForm ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Un 401 sur la connexion ou sur le contrôle de session initial est attendu (pages publiques comprises).
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') onUnauthorized();
    throw new ApiError(res.status, data?.message ?? `Erreur ${res.status}`, data?.issues);
  }
  return data as T;
}

export function toQueryString(filters: TicketFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  login: (email: string, password: string) => request<{ user: User }>('POST', '/auth/login', { email, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  me: () => request<User>('GET', '/auth/me'),

  agents: () => request<Agent[]>('GET', '/agents'),
  devIntegrations: () => request<DevIntegrationChoice[]>('GET', '/dev/integrations'),
  linkIssue: (ticketId: number, integrationId: string, reference?: string) =>
    request<{ externalKey: string; url: string }>('POST', `/dev/tickets/${ticketId}/links`, { integrationId, ...(reference && { reference }) }),
  unlinkIssue: (ticketId: number, linkId: string) => request<void>('DELETE', `/dev/tickets/${ticketId}/links/${linkId}`),
  requesters: (q: string) => request<User[]>('GET', `/requesters?${new URLSearchParams({ q })}`),
  createRequester: (input: { email: string; name: string }) => request<User>('POST', '/requesters', input),

  tickets: (filters: TicketFilters) => request<Page<Ticket>>('GET', `/tickets${toQueryString(filters)}`),
  ticket: (id: number) => request<TicketDetail>('GET', `/tickets/${id}`),
  setParent: (id: number, parentId: number | null) => request<TicketDetail>('PUT', `/tickets/${id}/parent`, { parentId }),
  route: (id: number) => request<Ticket>('POST', `/tickets/${id}/route`),
  createTicket: (input: TicketInput & { subject: string; description: string }) =>
    request<Ticket>('POST', '/tickets', input),
  updateTicket: (id: number, input: TicketInput) => request<Ticket>('PATCH', `/tickets/${id}`, input),
  transition: (id: number, status: TicketStatus) => request<Ticket>('POST', `/tickets/${id}/status`, { status }),

  comments: (id: number) => request<Comment[]>('GET', `/tickets/${id}/comments`),
  addComment: (id: number, body: string, isInternal: boolean, files: File[] = []) => {
    if (files.length === 0) return request<Comment>('POST', `/tickets/${id}/comments`, { body, isInternal });
    const form = new FormData();
    form.set('body', body);
    form.set('isInternal', String(isInternal));
    for (const f of files) form.append('file', f, f.name);
    return request<Comment>('POST', `/tickets/${id}/comments`, form);
  },
  addAttachments: (id: number, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('file', f, f.name);
    return request<AttachmentRef[]>('POST', `/tickets/${id}/attachments`, form);
  },
  merge: (id: number, targetId: number) => request<Ticket>('POST', `/tickets/${id}/merge`, { targetId }),

  audit: (id: number) => request<AuditEntry[]>('GET', `/tickets/${id}/audit`),

  config: () => request<AppConfig>('GET', '/config'),
  views: () => request<View[]>('GET', '/views'),

  meetings: (ticketId: number) => request<Meeting[]>('GET', `/tickets/${ticketId}/meetings`),
  createMeeting: (
    ticketId: number,
    input: { mode: 'direct' | 'proposal'; title?: string; durationMinutes: number; slots: string[]; developerIds: string[] },
  ) => request<Meeting>('POST', `/tickets/${ticketId}/meetings`, input),
  cancelMeeting: (ticketId: number, meetingId: string) =>
    request<Meeting>('POST', `/tickets/${ticketId}/meetings/${meetingId}/cancel`),
  developers: () => request<{ id: string; name: string }[]>('GET', '/developers'),

  macros: () => request<Macro[]>('GET', '/macros'),
  applyMacro: (macroId: string, ticketId: number, body: string) =>
    request<{ comment: Comment; ticket: Ticket }>('POST', `/macros/${macroId}/apply`, { ticketId, body }),

  notifications: () => request<{ items: Notification[]; unread: number }>('GET', '/notifications'),
  markNotificationRead: (id: string) => request<void>('POST', `/notifications/${id}/read`),
  markAllNotificationsRead: () => request<void>('POST', '/notifications/read-all'),

  incidents: (active = false) => request<IncidentSummary[]>('GET', `/incidents${active ? '?active=true' : ''}`),
  incident: (id: string) => request<IncidentDetail>('GET', `/incidents/${id}`),
  openIncident: (input: { title: string; severity: IncidentSeverity; message: string; ticketId?: number | null }) =>
    request<IncidentDetail>('POST', '/incidents', input),
  updateIncident: (id: string, input: { status: IncidentStatus; message: string }) =>
    request<IncidentDetail>('POST', `/incidents/${id}/updates`, input),
  savePostMortem: (id: string, input: { impact: string | null; rootCause: string | null; actions: string | null }) =>
    request<IncidentDetail>('PUT', `/incidents/${id}/postmortem`, input),
  broadcastIncident: (id: string, input: { recipients: string[]; subject: string; message: string }) =>
    request<{ recipients: number; sent: number; failed: number; delivered: boolean }>('POST', `/incidents/${id}/broadcast`, input),

  releases: () => request<ReleaseSummary[]>('GET', '/releases'),
  release: (id: string) => request<ReleaseDetail>('GET', `/releases/${id}`),
  releaseCandidates: (id: string) => request<ReleaseCandidate[]>('GET', `/releases/${id}/candidates`),
  createRelease: (input: { version: string; title?: string | null }) => request<ReleaseDetail>('POST', '/releases', input),
  deleteRelease: (id: string) => request<void>('DELETE', `/releases/${id}`),
  addReleaseTickets: (id: string, ticketIds: number[]) => request<ReleaseDetail>('POST', `/releases/${id}/tickets`, { ticketIds }),
  updateReleaseItem: (id: string, ticketId: number, input: { category?: ReleaseCategory; summary?: string | null }) =>
    request<ReleaseDetail>('PATCH', `/releases/${id}/tickets/${ticketId}`, input),
  removeReleaseTicket: (id: string, ticketId: number) => request<ReleaseDetail>('DELETE', `/releases/${id}/tickets/${ticketId}`),
  publishRelease: (id: string, notify: boolean) =>
    request<{ release: ReleaseDetail; notification: { requesters: number; sent: number; failed: number; delivered: boolean } | null }>('POST', `/releases/${id}/publish`, { notify }),
  notifyRelease: (id: string) =>
    request<{ requesters: number; sent: number; failed: number; delivered: boolean }>('POST', `/releases/${id}/notify`),

  requesterHistory: (ticketId: number) =>
    request<{ items: RequesterHistoryEntry[]; total: number }>('GET', `/tickets/${ticketId}/requester-history`),
  report: (from: string, to: string) => request<Report>('GET', `/reports?from=${from}&to=${to}`),

  spellcheck: (text: string) => request<{ issues: SpellcheckIssue[] }>('POST', '/spellcheck', { text }),
};

/** Page publique de réservation : aucune session requise. */
export const publicApi = {
  booking: (token: string) => request<Booking>('GET', `/public/bookings/${token}`),
  releaseNotes: () => request<PublicRelease[]>('GET', '/public/releases'),
  status: () => request<PublicStatus>('GET', '/public/status'),
  book: (token: string, slotId: string) => request<Booking>('POST', `/public/bookings/${token}`, { slotId }),
};

/** Routes d'administration (permissions user:manage et settings:manage). */
export const adminApi = {
  users: () => request<ManagedUser[]>('GET', '/users'),
  createUser: (input: { email: string; name: string; password: string; role: Role }) =>
    request<ManagedUser>('POST', '/users', input),
  updateUser: (id: string, input: Partial<{ name: string; role: Role; isActive: boolean; password: string }>) =>
    request<ManagedUser>('PATCH', `/users/${id}`, input),

  createOption: (input: { field: OptionField; key: string; label: string }) =>
    request<FieldOption>('POST', '/admin/options', input),
  updateOption: (id: string, input: Partial<{ label: string; isActive: boolean }>) =>
    request<FieldOption>('PATCH', `/admin/options/${id}`, input),
  reorderOptions: (field: OptionField, ids: string[]) => request<FieldOption[]>('PUT', '/admin/options/order', { field, ids }),
  deleteOption: (id: string) => request<void>('DELETE', `/admin/options/${id}`),

  savePriorityMatrix: (matrix: PriorityMatrix) => request<PriorityMatrix>('PUT', '/admin/priority-matrix', matrix),
  saveTicketForm: (layout: LayoutItem<TicketFormField>[]) => request('PUT', '/admin/layout/ticket-form', layout),
  saveTicketPage: (layout: PageBlockItem[]) => request('PUT', '/admin/layout/ticket-page', layout),
  saveListColumns: (layout: LayoutItem<ListColumn>[]) => request('PUT', '/admin/layout/list-columns', layout),

  createTag: (input: { name: string; color: string }) => request<Tag>('POST', '/admin/tags', input),
  updateTag: (id: string, input: Partial<{ name: string; color: string; isActive: boolean }>) =>
    request<Tag>('PATCH', `/admin/tags/${id}`, input),
  deleteTag: (id: string) => request<void>('DELETE', `/admin/tags/${id}`),

  createView: (input: { name: string; filters: ViewFilters }) => request<View>('POST', '/admin/views', input),
  updateView: (id: string, input: Partial<{ name: string; filters: ViewFilters }>) =>
    request<View>('PATCH', `/admin/views/${id}`, input),
  reorderViews: (ids: string[]) => request<View[]>('PUT', '/admin/views/order', { ids }),
  deleteView: (id: string) => request<void>('DELETE', `/admin/views/${id}`),

  macros: () => request<Macro[]>('GET', '/admin/macros'),
  createMacro: (input: { name: string; body: string; isInternal: boolean; actions: MacroActions }) =>
    request<Macro>('POST', '/admin/macros', input),
  updateMacro: (id: string, input: Partial<{ name: string; body: string; isInternal: boolean; actions: MacroActions; isActive: boolean }>) =>
    request<Macro>('PATCH', `/admin/macros/${id}`, input),
  reorderMacros: (ids: string[]) => request<Macro[]>('PUT', '/admin/macros/order', { ids }),
  deleteMacro: (id: string) => request<void>('DELETE', `/admin/macros/${id}`),

  groups: () => request<AdminGroup[]>('GET', '/admin/groups'),
  createGroup: (input: { name: string; distribution: AdminGroup['distribution']; description?: string | null; managerId?: string | null; memberIds?: string[] }) =>
    request<AdminGroup>('POST', '/admin/groups', input),
  updateGroup: (
    id: string,
    input: Partial<{ name: string; description: string | null; distribution: AdminGroup['distribution']; managerId: string | null; memberIds: string[]; isActive: boolean }>,
  ) => request<AdminGroup>('PATCH', `/admin/groups/${id}`, input),
  deleteGroup: (id: string) => request<void>('DELETE', `/admin/groups/${id}`),

  routingRules: () => request<RoutingRule[]>('GET', '/admin/routing-rules'),
  createRule: (input: { name: string; conditions: RuleConditions; groupId: string }) =>
    request<RoutingRule>('POST', '/admin/routing-rules', input),
  updateRule: (id: string, input: Partial<{ name: string; conditions: RuleConditions; groupId: string; isActive: boolean }>) =>
    request<RoutingRule>('PATCH', `/admin/routing-rules/${id}`, input),
  reorderRules: (ids: string[]) => request<RoutingRule[]>('PUT', '/admin/routing-rules/order', { ids }),
  deleteRule: (id: string) => request<void>('DELETE', `/admin/routing-rules/${id}`),

  devIntegrations: () => request<DevIntegration[]>('GET', '/admin/dev-integrations'),
  createDevIntegration: (input: Partial<DevIntegrationInput>) => request<DevIntegration>('POST', '/admin/dev-integrations', input),
  updateDevIntegration: (id: string, input: Partial<DevIntegrationInput>) =>
    request<DevIntegration>('PATCH', `/admin/dev-integrations/${id}`, input),
  deleteDevIntegration: (id: string) => request<void>('DELETE', `/admin/dev-integrations/${id}`),
  exportUser: (id: string) => request<unknown>('GET', `/admin/privacy/users/${id}/export`),
  anonymizeUser: (id: string, eraseContent: boolean) => request<void>('POST', `/admin/privacy/users/${id}/anonymize`, { eraseContent }),
  purge: (months: number, dryRun: boolean) => request<PurgeResult>('POST', '/admin/privacy/purge', { months, dryRun }),
  customFields: () => request<CustomField[]>('GET', '/admin/custom-fields'),
  createCustomField: (input: CustomFieldInput) => request<CustomField>('POST', '/admin/custom-fields', input),
  updateCustomField: (id: string, input: Partial<Pick<CustomField, 'label' | 'options' | 'required' | 'forRequester' | 'isActive'>>) =>
    request<CustomField>('PATCH', `/admin/custom-fields/${id}`, input),
  reorderCustomFields: (ids: string[]) => request<CustomField[]>('PUT', '/admin/custom-fields/order', { ids }),
  alertChannels: () => request<AlertChannel[]>('GET', '/admin/alert-channels'),
  createAlertChannel: (input: { kind: AlertKindName; name: string; target: string; isActive: boolean }) =>
    request<AlertChannel>('POST', '/admin/alert-channels', input),
  updateAlertChannel: (id: string, input: Partial<{ name: string; target: string; isActive: boolean }>) =>
    request<AlertChannel>('PATCH', `/admin/alert-channels/${id}`, input),
  deleteAlertChannel: (id: string) => request<void>('DELETE', `/admin/alert-channels/${id}`),
  mailboxes: () => request<Mailbox[]>('GET', '/admin/mailboxes'),
  createMailbox: (input: MailboxInput) => request<Mailbox>('POST', '/admin/mailboxes', input),
  updateMailbox: (id: string, input: Partial<MailboxInput>) => request<Mailbox>('PATCH', `/admin/mailboxes/${id}`, input),
  deleteMailbox: (id: string) => request<void>('DELETE', `/admin/mailboxes/${id}`),
  testMailbox: (id: string) => request<{ ok: boolean; error?: string }>('POST', `/admin/mailboxes/${id}/test`),
  pollMailbox: (id: string) => request<{ processed: number }>('POST', `/admin/mailboxes/${id}/poll`),
  regenerateMailboxToken: (id: string) => request<Mailbox>('POST', `/admin/mailboxes/${id}/regenerate-token`),
  inboundLog: (status?: InboundStatus, page = 1) =>
    request<Page<InboundLog>>('GET', `/admin/inbound?page=${page}${status ? `&status=${status}` : ''}`),
  retryInbound: (id: string) => request<{ status: InboundStatus; ticketId?: number }>('POST', `/admin/inbound/${id}/retry`),
  outboundLog: (status?: OutboundLog['status']) => request<OutboundLog[]>('GET', `/admin/outbound${status ? `?status=${status}` : ''}`),
  retryOutbound: (id: string) => request<{ ok: boolean }>('POST', `/admin/outbound/${id}/retry`),
  emailSettings: () => request<EmailSettings>('GET', '/admin/email-settings'),
  saveEmailSettings: (s: EmailSettings) => request<EmailSettings>('PUT', '/admin/email-settings', s),

  saveSlaPolicy: (policy: SlaPolicy) => request<SlaPolicy>('PUT', '/admin/sla-policy', policy),
};
