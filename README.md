# Ticket Mango

Solution de ticketing et de gestion des incidents : réception multi-canal, qualification ITIL, suivi des bugs, release notes et communication de crise.

## Structure

```
apps/api          API REST (Fastify, Prisma, PostgreSQL)
apps/web          Interface agent (React, Vite, TanStack Query)
packages/shared   Domaine partagé : taxonomie, matrice de priorité, workflow, rôles
```

## Démarrage

Prérequis : Node.js 24+ et Docker (ou un PostgreSQL 17 accessible).

```bash
npm install
docker compose up -d
cp apps/api/.env.example apps/api/.env   # puis renseigner JWT_SECRET
npm run db:deploy -w @ticketing/api      # applique les migrations
npm run db:seed -w @ticketing/api        # crée le premier administrateur
npm run dev                              # API sur http://localhost:3000
npm run dev:web                          # interface sur http://localhost:5173
```

En développement, Vite relaie `/api` vers l'API. En production, servez `apps/web/dist` et faites relayer `/api` vers l'API par le reverse proxy (même origine), avec `COOKIE_SECURE=true` derrière HTTPS.

## Tests

```bash
npm test
```

Les tests unitaires tournent sans base. Les tests d'intégration de l'API sont ignorés si `DATABASE_URL` n'est pas défini ; pour les lancer en local :

```bash
export DATABASE_URL=postgresql://ticketing:ticketing@localhost:5432/ticketing_test
npm run db:deploy -w @ticketing/api
npm test
```

Attention : les tests d'intégration **vident les tables** de la base ciblée.

## API

Toutes les routes, sauf `/health`, `/auth/login` et `/auth/logout`, exigent une session : le cookie `httpOnly` posé à la connexion (navigateur) ou l'en-tête `Authorization: Bearer <jeton>` (clients d'API).

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/auth/login` | Connexion (`email`, `password`) → jeton JWT |
| `POST` | `/auth/logout` | Déconnexion (efface le cookie) |
| `GET` | `/auth/me` | Utilisateur courant |
| `GET` | `/agents` | Agents assignables |
| `GET` / `POST` / `PATCH` | `/users`, `/users/:id` | Gestion des comptes (administrateur) |
| `GET` | `/tickets` | Liste paginée ; filtres `status`, `priority` (valeurs séparées par des virgules), `type`, `component`, `assigneeId` (ou `none`), `groupId` (ou `mine`), `slaState`, `awaitingAgent`, `tagId`, `q` (texte ou numéro), `sort` (`created`, `sla`), `page`, `pageSize` |
| `POST` | `/tickets` | Création |
| `GET` / `PATCH` | `/tickets/:id` | Détail, qualification, assignation, forçage de priorité (`priority: null` pour revenir à la matrice) |
| `POST` | `/tickets/:id/status` | Changement de statut selon le workflow |
| `GET` / `POST` | `/tickets/:id/comments` | Commentaires publics et notes internes (`isInternal`) |
| `GET` | `/tickets/:id/audit` | Journal d'audit du ticket |
| `GET` | `/config` | Listes, tags, matrice et mise en page pour l'interface |
| `GET` | `/views` | Vues de la barre latérale avec leur nombre de tickets |
| `GET` / `POST` | `/tickets/:id/meetings` | Rendez-vous du ticket ; création en mode `direct` ou `proposal` |
| `POST` | `/tickets/:id/meetings/:meetingId/cancel` | Annulation |
| `GET` / `POST` | `/public/bookings/:token` | Page publique de réservation (sans session) |
| `GET` | `/developers` | Développeurs invitables |
| `POST` | `/tickets/:id/route` | Réapplique les règles de routage |
| `PUT` | `/tickets/:id/parent` | Rattache à un ticket référent (`parentId`, ou `null` pour détacher) |
| `GET` / `POST` | `/notifications`, `/notifications/:id/read`, `/notifications/read-all` | Notifications de l'utilisateur |
| `…` | `/admin/groups`, `/admin/routing-rules`, `/admin/sla-policy` | Administration des groupes, du routage et des SLA |
| `GET` / `POST` | `/macros`, `/macros/:id/apply` | Macros actives ; application à un ticket |
| `POST` | `/spellcheck` | Correction orthographique et grammaticale |
| `POST` / `PATCH` / `PUT` / `DELETE` | `/admin/...` | Administration (options, matrice, mise en page, tags, vues) |

### Administration

Réservée au rôle Administrateur (`settings:manage`, `user:manage`), sous `/admin` dans l'interface :

- **Utilisateurs** : création, rôle, désactivation, réinitialisation du mot de passe.
- **Qualification** : types, modules et environnements. Une valeur utilisée s'archive au lieu d'être supprimée ; les types système (Bug, Question, Incident majeur) se renomment mais ne s'archivent pas.
- **Matrice de priorité** : appliquée aux créations et requalifications suivantes.
- **Tags** : catalogue (nom, couleur) appliqué par les agents.
- **Mise en page** : ordre et visibilité des champs du ticket et des colonnes de la liste.
- **Vues** : filtres enregistrés affichés dans la barre latérale avec leur nombre de tickets.

Chaque action d'administration est inscrite au journal d'audit.

### Rendez-vous, macros et correcteur

- **Rendez-vous** (agents) : depuis un ticket, fixer un créneau (le lien Meet est créé aussitôt) ou proposer 2 à 5 créneaux. Le demandeur choisit alors sur une page publique `/book/<jeton>`, sans connexion. Les développeurs (rôle Développeur) peuvent être invités. L'invitation est préparée dans la réponse grâce aux macros système « Invitation Meet » et « Proposition de créneaux ». Elle est publiée automatiquement quand le demandeur réserve.
- **Visioconférence** : `MEETING_PROVIDER=demo` génère des liens fictifs (`meet.demo.invalid`) sans rien envoyer. Le fournisseur Google Calendar / Meet sera branché une fois le mode de connexion Google choisi (compte de service ou OAuth par agent).
- **Macros** (administration) : un texte avec des variables (`{{demandeur.prenom}}`, `{{meet.lien}}`…), une réponse publique ou une note interne, et des actions (statut, tags, assignation). Les actions sont vérifiées avant tout envoi.
- **Correcteur** : orthographe et grammaire par un serveur LanguageTool auto-hébergé (service `languagetool` du `docker-compose`, variable `LANGUAGETOOL_URL`). Les textes ne quittent pas votre infrastructure. Le correcteur du navigateur (français) reste actif dans tous les cas.

### Routage et SLA

- **Groupes** (administration) : Support N1, Support N2, DevOps, Produit / QA par défaut. Chaque groupe a ses membres, un responsable et un mode de distribution : tour de rôle, par charge (moins de tickets ouverts), ou manuel (un dispatcher assigne).
- **Règles de routage** : évaluées dans l'ordre à la création d'un ticket. La première qui correspond (type, module, environnement, priorité) désigne le groupe. Le bouton « Relancer le routage » les réapplique après une requalification.
- **SLA** : délais de première réponse et de résolution par priorité. P0 et P1 sont décomptés en 24/7, les autres en heures ouvrées (lundi-vendredi 8h-18h, Europe/Paris, jours fériés français exclus). Tout se modifie dans l'administration. Le statut « En attente du client » et la résolution suspendent le délai de résolution ; quand le demandeur répond, le ticket revient en qualification.
- **Alertes** : une tâche de surveillance (toutes les minutes, sous verrou PostgreSQL pour ne tourner que sur une instance) met à jour l'état SLA et notifie une seule fois, à risque puis dépassé, l'agent assigné et le responsable du groupe (ou les membres du groupe sans agent assigné).
- **Ticket référent** : un ticket peut être rattaché à un ticket référent (un niveau, sans boucle). Le référent liste ses tickets liés.
- **Réponse client en attente** : un ticket ouvert dont le demandeur s'est exprimé après la dernière réponse publique du support est surligné dans la liste et dispose d'un filtre et d'une vue.

### Règles métier

- **Priorité** : calculée par la matrice impact × urgence ([priority.ts](packages/shared/src/priority.ts)) et recalculée à chaque requalification, sauf si un agent N2 l'a forcée.
- **Workflow** : transitions autorisées dans [workflow.ts](packages/shared/src/workflow.ts). Un ticket clôturé n'est plus modifiable ; un ticket résolu peut être rouvert.
- **Rôles** : permissions dans [rbac.ts](packages/shared/src/rbac.ts). Un utilisateur externe ne voit que ses tickets et jamais les notes internes.
- **Première réponse** : `firstResponseAt` est horodaté au premier commentaire public d'un agent (base du calcul FRT).
- **Audit** : chaque création, modification, changement de statut et commentaire est journalisé avec son auteur.
