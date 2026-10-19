# Déploiement

## 1. Base de données Supabase

1. Créez un projet Supabase (région la plus proche, ex. Europe ou Asie du Sud).
2. *Project Settings → Database → Connection string* : copiez l'URL **Session pooler** (port 5432, compatible IPv4) avec le mot de passe du projet. Elle sert à l'API **et** aux sauvegardes.
   - N'utilisez pas le *Transaction pooler* (6543) pour les migrations ni `pg_dump`.
   - Rôle `postgres` obligatoire : il contourne RLS, et l'API est la seule à lire la base.
3. `DATABASE_SSL=require`.
4. Les migrations s'appliquent au démarrage de l'API (`AUTO_MIGRATE=true`) ou à la main : `npm run migrate`. La migration 002 active **RLS sans policy** sur toutes les tables : la clé `anon` publique de Supabase ne peut rien lire.
5. N'activez pas l'API Data (PostgREST) ni les clés `anon`/`service_role` dans le front : l'application ne les utilise pas.

## 2. Hébergement de l'application (une image Docker)

Le WebSocket exige un processus **toujours actif** : évitez les plateformes « serverless ».

### Fly.io (exemple)
```bash
fly launch --no-deploy --dockerfile Dockerfile --internal-port 3000
fly secrets set DATABASE_URL='postgresql://postgres.<ref>:<mdp>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
  DATABASE_SSL=require JWT_SECRET="$(openssl rand -base64 48)" PIN_PEPPER="$(openssl rand -base64 24)" \
  BOOTSTRAP_ADMIN_USERNAME=admin BOOTSTRAP_ADMIN_PASSWORD='un-mot-de-passe-long'
fly deploy
```
Gardez au moins une machine allumée (`min_machines_running = 1`, `auto_stop_machines = "off"`) sinon les WebSocket et le premier chargement subissent un démarrage à froid.

### Render / Railway
Service web Docker pointant sur le `Dockerfile`, port 3000, santé `/healthz`, mêmes variables d'environnement.

### VPS (auto-hébergé, sans Supabase)
```bash
cp .env.example .env     # éditer JWT_SECRET, DOMAIN, POSTGRES_PASSWORD…
docker compose --profile https up -d --build
```
Caddy obtient le certificat HTTPS automatiquement (le domaine doit pointer sur le serveur).

## 3. Premier démarrage

1. Ouvrez l'URL, connectez-vous avec `BOOTSTRAP_ADMIN_*`, **changez le mot de passe** (menu utilisateur) puis supprimez ces deux variables.
2. Importez l'Excel en local avec `DATABASE_URL` pointant sur Supabase : `npm run import-excel -- fichier.xlsx --tables 12`, ou saisissez le menu à la main.
3. Créez les caissiers (écran *Utilisateurs*) avec leur PIN.
4. Écran *Restaurant et ticket* : nom, adresse, téléphone, pied de ticket, largeur du papier.
5. Sur chaque téléphone/tablette : ouvrir l'URL → « Ajouter à l'écran d'accueil » (installation PWA) → menu utilisateur → *Impression*.

## Variables d'environnement
Voir `.env.example` (toutes commentées). Indispensables : `DATABASE_URL`, `DATABASE_SSL`, `JWT_SECRET` (≥ 32 caractères). Recommandées : `PIN_PEPPER`, `TRUST_PROXY=true` derrière un proxy.

## Front hébergé séparément (optionnel)
Compilez avec `VITE_API_URL=https://api.exemple.mg` et déclarez l'origine du front dans `CORS_ORIGINS` côté API. Le déploiement en une seule origine reste le plus simple (pas de CORS, service worker et WebSocket sans configuration).
