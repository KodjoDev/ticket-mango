# Ticket Mango

Solution de ticketing et de gestion des incidents : réception multi-canal, qualification ITIL, suivi des bugs, release notes et communication de crise.

## Structure

```
apps/api          API REST (Fastify, Prisma, PostgreSQL)
packages/shared   Domaine partagé : taxonomie, matrice de priorité, workflow, rôles
```

## Démarrage

Prérequis : Node.js 20+ et Docker (ou un PostgreSQL 17 accessible).

```bash
npm install
docker compose up -d
cp apps/api/.env.example apps/api/.env   # puis renseigner JWT_SECRET
npm run db:deploy -w @ticketing/api      # applique les migrations
npm run db:seed -w @ticketing/api        # crée le premier administrateur
npm run dev                              # API sur http://localhost:3000
```

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

## API (lot 1)

Toutes les routes, sauf `/health` et `/auth/login`, exigent l'en-tête `Authorization: Bearer <jeton>`.

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/auth/login` | Connexion (`email`, `password`) → jeton JWT |
| `GET` | `/auth/me` | Utilisateur courant |
| `GET` / `POST` / `PATCH` | `/users`, `/users/:id` | Gestion des comptes (administrateur) |
| `GET` | `/tickets` | Liste paginée ; filtres `status`, `priority` (valeurs séparées par des virgules), `type`, `component`, `assigneeId`, `q`, `page`, `pageSize` |
| `POST` | `/tickets` | Création |
| `GET` / `PATCH` | `/tickets/:id` | Détail, qualification, assignation, forçage de priorité (`priority: null` pour revenir à la matrice) |
| `POST` | `/tickets/:id/status` | Changement de statut selon le workflow |
| `GET` / `POST` | `/tickets/:id/comments` | Commentaires publics et notes internes (`isInternal`) |
| `GET` | `/tickets/:id/audit` | Journal d'audit du ticket |

### Règles métier

- **Priorité** : calculée par la matrice impact × urgence ([priority.ts](packages/shared/src/priority.ts)) et recalculée à chaque requalification, sauf si un agent N2 l'a forcée.
- **Workflow** : transitions autorisées dans [workflow.ts](packages/shared/src/workflow.ts). Un ticket clôturé n'est plus modifiable ; un ticket résolu peut être rouvert.
- **Rôles** : permissions dans [rbac.ts](packages/shared/src/rbac.ts). Un utilisateur externe ne voit que ses tickets et jamais les notes internes.
- **Première réponse** : `firstResponseAt` est horodaté au premier commentaire public d'un agent (base du calcul FRT).
- **Audit** : chaque création, modification, changement de statut et commentaire est journalisé avec son auteur.
