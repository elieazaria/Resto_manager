# Architecture

```
Téléphone / tablette / PC  ──HTTPS──►  Conteneur unique
   React PWA (service worker)          ├─ Fastify : /api/*  (REST JSON)
   file hors-ligne (localStorage)      ├─ Fastify : /ws     (WebSocket)
                                       └─ fichiers statiques du front (apps/web/dist)
                                                │ SQL (pg, TLS)
                                                ▼
                                       Supabase PostgreSQL  ──pg_dump──► stockage S3 externe
```

Supabase n'est utilisé que comme **PostgreSQL managé**. L'authentification est la nôtre (JWT + argon2) et le temps réel passe par notre WebSocket : cela permet un PIN caissier, des rôles métier précis et aucune dépendance au SDK Supabase côté navigateur.

## Modèle de données (migrations dans `apps/api/migrations`)

| Table | Rôle | Équivalent Excel |
|---|---|---|
| `app_users` | comptes, rôle, `password_hash`, `pin_hash`, verrouillage, `token_version` | — |
| `categories`, `menu_items` | carte ; `kind` = `cooked` (recette) ou `resale` (produit revendu lié à un article de stock) | Menu |
| `stock_items` | ingrédients et produits ; unité de stock, unité d'achat, **facteur de conversion**, seuil | Stock |
| `recipes` | plat → ingrédient → quantité par portion | Recettes |
| `purchases`, `suppliers` | achats (en unité d'achat) | Achats_Ingredients / Achats_Produits |
| `stock_movements` | **journal** : achat, vente, annulation, inventaire. Niveau = somme des mouvements | colonnes « Entrée/Sortie/Reste » |
| `expenses`, `cash_openings` | dépenses et charges, solde initial du jour | Depense_Charge / Tableau_Bord |
| `restaurant_tables`, `orders`, `order_lines` | commandes par table ; nom et prix figés sur la ligne | Commande_Table / Enr_Vente / Vente |
| `settings`, `audit_log` | en-tête du ticket, journal d'audit | — |

Choix structurants :

- **Identifiants** plutôt que des noms comme clés (le `SUMIF` sur un nom d'Excel casse à la moindre faute de frappe).
- **Une commande ouverte par table** (index unique partiel) ; l'identifiant de commande est choisi par le client, ce qui rend `PUT /orders/:id` et `POST /orders/:id/pay` **idempotents** : rejouer une requête hors-ligne ne crée ni doublon ni double décrément de stock.
- **Jour comptable** (`business_date`) fixé au paiement selon `APP_TZ` (Indian/Antananarivo) : les rapports ne dépendent pas du fuseau du serveur.
- Montants en Ariary entiers.

## API

Préfixe `/api`. Permissions définies une fois dans `packages/shared` (`can(role, permission)`) et appliquées par un `preHandler` sur **chaque** route.

| Zone | Routes | Accès |
|---|---|---|
| Auth | `POST /auth/login`, `POST /auth/pin-login`, `GET /auth/me`, `POST /auth/change-password` | public (limité) / connecté |
| Caisse | `GET /pos/menu`, `GET /pos/tables`, `GET/PUT /orders…`, `POST /orders/:id/pay`, `/cancel`, `GET /settings` | caissier + gérant |
| Annulation de vente | `POST /orders/:id/void` | gérant |
| Gestion | `/dashboard`, `/categories`, `/menu-items` (+ `/recipe`), `/stock`, `/stock-items`, `/stock/adjust`, `/stock/movements`, `/purchases`, `/suppliers`, `/expenses`, `/tables`, `/users`, `PUT /settings` | gérant |

Le caissier ne reçoit que les commandes **ouvertes ou du jour**.

## WebSocket

`GET /ws` : le client envoie `{type:"auth", token}` dans les 5 s (jamais de jeton dans l'URL), puis reçoit `order.changed` (tous) et `stock.changed` (gérant). Les évènements ne portent aucune donnée sensible : le front rafraîchit via l'API, qui applique les droits. Ping/pong toutes les 30 s ; reconnexion automatique côté front.

## Front

- Routage par permission (`Guard`) ; pages de gestion chargées à la demande (le caissier ne télécharge pas Recharts).
- `CrudPage` : composant générique TanStack Table (tri, recherche, pagination) + formulaire React Hook Form validé par les **mêmes schémas Zod que l'API**.
- `lib/outbox.ts` : file d'attente hors-ligne ; `lib/escpos.ts` : génération des tickets ESC/POS ; `lib/realtime.ts` : WebSocket + invalidation des requêtes.
- Thème : vert ravenala / jaune safran, polices Bricolage Grotesque et Figtree **embarquées** (fonctionnent hors-ligne).
