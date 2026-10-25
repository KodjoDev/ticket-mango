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
| `GET` | `/tickets` | Liste paginée ; filtres `status`, `priority` (valeurs séparées par des virgules), `type`, `component`, `assigneeId` (ou `none`), `tagId`, `q`, `page`, `pageSize` |
| `POST` | `/tickets` | Création |
| `GET` / `PATCH` | `/tickets/:id` | Détail, qualification, assignation, forçage de priorité (`priority: null` pour revenir à la matrice) |
| `POST` | `/tickets/:id/status` | Changement de statut selon le workflow |
| `GET` / `POST` | `/tickets/:id/comments` | Commentaires publics et notes internes (`isInternal`) |
| `GET` | `/tickets/:id/audit` | Journal d'audit du ticket |
| `GET` | `/config` | Listes, tags, matrice et mise en page pour l'interface |
| `GET` | `/views` | Vues de la barre latérale avec leur nombre de tickets |
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

### Règles métier

- **Priorité** : calculée par la matrice impact × urgence ([priority.ts](packages/shared/src/priority.ts)) et recalculée à chaque requalification, sauf si un agent N2 l'a forcée.
- **Workflow** : transitions autorisées dans [workflow.ts](packages/shared/src/workflow.ts). Un ticket clôturé n'est plus modifiable ; un ticket résolu peut être rouvert.
- **Rôles** : permissions dans [rbac.ts](packages/shared/src/rbac.ts). Un utilisateur externe ne voit que ses tickets et jamais les notes internes.
- **Première réponse** : `firstResponseAt` est horodaté au premier commentaire public d'un agent (base du calcul FRT).
- **Audit** : chaque création, modification, changement de statut et commentaire est journalisé avec son auteur.
