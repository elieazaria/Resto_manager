# Resto Manager

Application web de gestion de restaurant (caisse, stock, achats, dépenses, tableau de bord), utilisable sur **ordinateur, tablette et téléphone** et **installable** (PWA). Construite à partir du classeur Excel `Gestion_Restaurant_Complete.xlsx` : les onglets Menu, Recettes, Stock, Achats, Dépenses, Commande par table, Ventes et Tableau de bord sont devenus des écrans et des tables PostgreSQL.

| Rôle | Ce qu'il voit |
|---|---|
| **Gérant** | Tout : tableau de bord, ventes, menu et recettes, stock, achats, fournisseurs, dépenses, tables, utilisateurs, réglages du ticket |
| **Caissier** | Uniquement la prise de commande par table, l'encaissement et l'impression du ticket (plus la liste des commandes du jour) |

## Technologies

| Couche | Choix |
|---|---|
| Front | React 19 + TypeScript + Vite + Tailwind CSS 4, composants shadcn/ui (Radix), TanStack Table, React Hook Form + Zod, Recharts |
| PWA | vite-plugin-pwa (service worker Workbox) + file d'attente hors-ligne des commandes |
| API | Node 22 + Fastify 5 (TypeScript), validation Zod partagée avec le front |
| Authentification | JWT (jose) + mots de passe **argon2id**, **PIN rapide** pour le caissier (HMAC + argon2id, verrouillage après 5 échecs), RBAC côté serveur |
| Actualisation | Sans WebSocket : sondage léger toutes les 8 s (compatible Vercel, Render, tout hébergeur) |
| Base de données | PostgreSQL, hébergée sur **Supabase** (ou n'importe quel Postgres) |
| Sauvegardes | script `pg_dump` manuel (`scripts/backup`) vers un stockage S3 externe, rotation, restauration scriptée — aucune exécution automatique |

```
apps/web         front React (PWA)
apps/mobile      application Android (React Native / Expo) — voir apps/mobile/README.md
apps/api         API Fastify, migrations SQL, import Excel, tests
packages/shared  schémas Zod, rôles/permissions, types partagés
scripts/backup   backup.sh · prune.sh · restore.sh
docs/            architecture, déploiement, sauvegardes, impression
```

## Démarrage rapide (développement)

Prérequis : Node 22+, et soit Docker, soit un projet Supabase.

```bash
npm install
cp .env.example .env          # puis éditer JWT_SECRET (openssl rand -base64 48)
docker compose up -d db       # Postgres local  (ou mettre l'URL Supabase dans DATABASE_URL)
npm run dev                   # API :3000 + front :5173 (proxy /api)
```

Ouvrez http://localhost:5173 et connectez-vous avec `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` (créé automatiquement au premier démarrage s'il n'existe aucun gérant ; retirez ces variables ensuite).

### Importer votre Excel

```bash
npm run import-excel -- ./Gestion_Restaurant_Complete.xlsx --tables 12
```

Importe catégories, menu (prix « 20 000 Ar » convertis en entiers), ingrédients et produits revendus, recettes, achats et dépenses, et crée 12 tables. L'import est **rejouable** : il ne modifie jamais ce qui existe déjà et n'ajoute pas deux fois l'historique. Il affiche la liste des points à corriger à la main (recettes sans quantité, unités d'achat différentes des unités de recette, plats absents du menu…). Les lignes d'achat sans date ou sans prix deviennent du *stock initial*.

### Créer d'autres utilisateurs

Depuis l'écran **Utilisateurs** (gérant). Un caissier reçoit un **PIN de 4 à 6 chiffres** ; il se connecte avec son identifiant + PIN (pavé numérique tactile). Le gérant se connecte avec un mot de passe (8 caractères minimum). En ligne de commande : `npm run create-admin -- <identifiant> --password <mdp>`.

## Fonctionnement métier

- **Commande par table** : une commande ouverte par table ; on ajoute des plats (recherche, catégories, notes « sans piment »), « Enregistrer » ou « Encaisser ».
- **Encaissement** : Espèces (montant reçu et rendu), MVola, Orange Money, Airtel Money, Carte. Le ticket est imprimé automatiquement.
- **Stock** : chaque vente décrémente le stock via les **recettes** (plats cuisinés) ou directement (produits revendus : boissons…). Les achats l'incrémentent (quantité × facteur de conversion, ex. 1 kg = 1000 g). Journal de mouvements complet, inventaire par comptage, alerte quand le niveau passe sous le seuil ou devient négatif.
- **Tableau de bord** : ventes, achats, dépenses et bénéfice du jour et du mois (mêmes formules que l'Excel), trésorerie du jour avec solde initial, ventes sur 30 jours, plats les plus vendus, modes de paiement, stock à commander, tableau mensuel de l'année.
- **Annulation** : le caissier peut annuler une commande *ouverte* ; seul le gérant peut annuler une vente *encaissée* (motif obligatoire, stock restitué).
- Toutes les actions sensibles sont inscrites dans un journal d'audit (`audit_log`).

## Impression des tickets

Deux modes, au choix par appareil (menu de l’utilisateur → « Impression ») : voir [docs/PRINTING.md](docs/PRINTING.md).

1. **Navigateur** : ticket mis en page 58/80 mm (`@media print`). Avec Chrome lancé en `--kiosk-printing`, l'impression est silencieuse.
2. **RawBT (Android)** : envoie des commandes **ESC/POS** à une imprimante thermique Bluetooth/USB, sans boîte de dialogue.
Le bouton **Addition** de l'écran de commande imprime la note avant paiement ; un ticket de caisse est imprimé à l'encaissement et peut être réimprimé depuis « Commandes du jour ».

## Hors-ligne

Le service worker met en cache l'application et, en lecture, le menu, les tables et les réglages. Si le réseau coupe, une commande « Enregistrer » ou « Encaisser » part dans une **file d'attente locale** (identifiant généré côté appareil, rejeu sans doublon) et est envoyée automatiquement au retour de la connexion ; le ticket s'imprime quand même. Limite assumée : les écrans de gestion (gérant) demandent le réseau.

## Déploiement

Une seule image Docker (API + front compilé) : voir [docs/DEPLOY.md](docs/DEPLOY.md) pour Supabase + Fly.io / Render / VPS (Caddy HTTPS).

```bash
docker compose up -d --build          # base locale + app sur :3000
docker compose --profile https up -d  # + HTTPS automatique (DOMAIN=resto.exemple.mg)
```

## Sauvegardes

`scripts/backup/backup.sh` fait un `pg_dump` (format custom compressé), vérifie qu'il est relisible, le chiffre en option (age), l'envoie vers S3/R2/B2 et applique la rotation (30 jours, 5 dernières toujours gardées). Il se lance à la main (le workflow GitHub Actions quotidien a été retiré). Procédure complète et test de restauration : [docs/BACKUP.md](docs/BACKUP.md).

## Sécurité (résumé)

- Droits imposés **côté serveur** à chaque route (le front masque seulement les menus).
- argon2id partout ; PIN lié à un poivre serveur ; verrouillage de compte et limitation par IP ; réponse identique pour un compte inexistant.
- Désactiver un compte ou changer son mot de passe/PIN **révoque immédiatement** ses sessions ouvertes.
- Prix recalculés côté serveur (le client ne peut pas en imposer) ; paiement et commandes **idempotents**.
- Supabase : **RLS activé sans policy** sur toutes les tables et droits `anon`/`authenticated` retirés (migration 002) : la clé publique Supabase ne donne accès à rien. Seule l'API, avec le rôle `postgres`, lit la base.
- CSP stricte (Helmet), jetons jamais dans les URL.
- Le jeton de session est conservé dans le `localStorage` de l'appareil (durée `JWT_TTL`, 12 h par défaut) ; la CSP limite le risque XSS.

## Tests

```bash
npm run typecheck
npm test                                   # API sur PGlite (Postgres WASM) + front
TEST_DATABASE_URL=postgres://…/resto_test npm test   # API sur un vrai Postgres (base dont le nom contient « test »)
```

32 tests d'intégration API (authentification, verrouillage PIN, révocation, RBAC, commandes idempotentes, décrément de stock, annulation, tableau de bord) et des tests de la génération ESC/POS.

## À savoir / pistes d'évolution

- Les ventes de test du classeur (une seule journée) ne sont pas importées.
- `npm audit` signale 2 alertes modérées héritées de `exceljs` (dépendance `uuid`, utilisée seulement par la commande d’import Excel, hors serveur web) ; sans effet pratique ici.
- Paiements Mobile Money : le mode de paiement est enregistré, sans intégration API des opérateurs.
- Idées suivantes : marge par plat (coût de recette), tickets cuisine/bar par poste, impression directe Web Bluetooth/WebUSB, export Excel/PDF des rapports, prévisions de ventes (Python/pandas).


## Module Hôtel (version web)

Menu **Hôtel** (gérant uniquement) :

| Écran | Rôle |
|---|---|
| Planning | Gantt chambres × jours par catégorie, barres colorées par statut, puces (arrivées/départs du jour, confirmée, en option, annulées), « Vue planning liste » (périodes, export CSV et PDF), réservation simple ou groupée, export PDF du planning |
| Chambres en direct | Statut calculé en temps réel (disponible, réservée, arrivée du jour, occupée, ménage, maintenance, hors service), check-in / check-out |
| Réservation | Prix par nuit issu des tarifs dynamiques (modifiable), suppléments avec quantités (matelas, location cuisine…), remise % ou Ar, acompte, paiements (espèces, Mvola, Orange Money, Airtel Money, chèque, virement, autre), remboursements, facture PDF |
| Clients et comptes | Fiches clients, solde, relevé de compte PDF |
| Chambres (gestion), Types, Suppléments, Tarifs dynamiques | Paramétrage |
| Réglages hôtel et démo | Nom/adresse/NIF, préfixe `RES HM-01/yy.nnnnnn`, heures, taxe de séjour, TVA, pied de facture ; **Mettre à jour les valeurs démo** recrée des réservations d'essai autour d'aujourd'hui, **Effacer la démo** les supprime (seules les lignes `is_demo` sont touchées) |

API : `/api/hotel/*` (migration `003_hotel.sql`, RLS activée). Tests : `apps/api/test/hotel.test.ts`.

## Rentabilité des menus

Restaurant › Finances › **Rentabilité des menus** : pour chaque plat, boisson ou produit revendu, prix de vente − coût matières (ingrédients de la recette × prix d'achat enregistrés, en coût moyen pondéré ou dernier prix), marge en %, quantités vendues et bénéfice réalisé sur la période, avec le détail des ingrédients et un export CSV. API : `GET /api/profitability?from&to&basis=average|last`.

## Ventes antérieures, suppression d'utilisateur, tableau de bord

- **Gestion › Ventes antérieures** : saisie d'une vente passée (date au choix, plats déroulants, quantités, mode de paiement, mise à jour facultative du stock au jour de la vente). API : `POST /api/sales/backdated` (gérant).
- **Réglages › Utilisateurs › Supprimer définitivement** : supprime le compte même avec un historique ; ses ventes, achats et dépenses sont conservés mais détachés de son nom (`DELETE /api/users/:id?force=true`). La corbeille classique reste prudente (refuse si historique). Le dernier gérant et votre propre compte ne peuvent pas être supprimés.
- Le bloc « Trésorerie du jour » (solde initial / reste en caisse) a été retiré du tableau de bord web et mobile ; la route `PUT /api/dashboard/opening-balance` n'existe plus.

## Prix d'achat à l'inventaire, recherche en vente, verre de jus

- **Niveaux de stock › Inventaire** : en plus de la quantité comptée, on saisit le **prix d'achat** (par unité d'achat : bouteille, kg…). Il est mémorisé (`stock_items.cost_ref`) et sert au calcul de rentabilité tant qu'aucun achat n'est enregistré (ou s'il est plus récent que le dernier achat pour « dernier prix »). Ensuite, le coût = moyenne pondérée des achats. Le tableau des niveaux affiche le prix d'achat et la valeur en stock.
- **Nouvelle vente** : barre de recherche (sans accents ni majuscules) ; un clic sur un résultat l'ajoute ou augmente sa quantité.
- **Produit composé (verre de jus)** : une recette peut maintenant utiliser n'importe quel article de stock, ingrédient ou produit. Exemple :
  1. Stock « Jus naturel 1,5 L » : unité **ml**, unité d'achat **bouteille**, facteur **1500**.
  2. Article de menu « Verre de jus » (type cuisiné, 2 000 Ar) avec la recette **250 ml** de « Jus naturel 1,5 L » (= 0,167 bouteille, affiché dans la recette).
  3. Article « Jus naturel 1,5 L » (type revendu, 9 000 Ar) avec **Quantité retirée du stock par vente = 1500**.
  6 verres retirent exactement 1 500 ml, soit 1 bouteille, sans erreur d'arrondi (c'est pourquoi le stock se compte en ml). Migration `004_stock_cost_portions.sql`.
