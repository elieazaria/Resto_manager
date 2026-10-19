# Sauvegardes et restauration

## Principe
Chaque nuit à **minuit (Antananarivo)**, GitHub Actions exécute `scripts/backup/backup.sh` :

1. `pg_dump` format *custom* compressé, schéma `public` uniquement (sans propriétaire ni privilèges Supabase) ;
2. contrôle : `pg_restore --list` doit relire le dump, taille minimale ;
3. chiffrement optionnel avec **age** ;
4. envoi vers un stockage S3 **externe à Supabase** (Cloudflare R2, Backblaze B2, AWS S3…), sous `prefix/AAAA/MM/resto-<horodatage>.dump` ;
5. rotation : suppression au-delà de `BACKUP_RETENTION_DAYS` (30), en gardant **toujours les 5 plus récentes**.

Utiliser un fournisseur différent de Supabase est le but : si le projet ou le compte est perdu, les sauvegardes restent accessibles. Les sauvegardes automatiques de Supabase (plans payants) sont un complément, pas un remplacement.

## Mise en place
Dans GitHub → *Settings → Secrets and variables → Actions* :

| Secret | Valeur |
|---|---|
| `BACKUP_DATABASE_URL` | URL **Session pooler** Supabase (les runners GitHub n'ont pas d'IPv6) |
| `BACKUP_DEST` | `s3://mon-bucket/resto` |
| `BACKUP_S3_KEY_ID`, `BACKUP_S3_SECRET` | clés d'accès au bucket (droits lecture/écriture/suppression sur ce bucket seulement) |
| `BACKUP_S3_ENDPOINT` | ex. `https://<compte>.r2.cloudflarestorage.com` |
| `BACKUP_AGE_RECIPIENT` | *(option)* clé publique `age1…` : `age-keygen -o cle.txt` ; **conservez `cle.txt` hors du dépôt, sans elle les dumps sont illisibles** |

Variables (optionnelles) : `BACKUP_RETENTION_DAYS`, `BACKUP_S3_REGION` (`auto` pour R2).
Réglez `PG_CLIENT_VERSION` dans `backup.yml` sur la version majeure du serveur Supabase (ou plus récente).

Lancez une première fois à la main : *Actions → Sauvegarde quotidienne → Run workflow*, puis vérifiez le fichier dans le bucket.

**Surveillance.** Un échec envoie un e-mail GitHub. GitHub **désactive les workflows planifiés après 60 jours sans activité** dans le dépôt : faites un commit de temps en temps ou regardez l'onglet *Actions*. Une alternative sans GitHub : une tâche cron sur un VPS, `0 21 * * * /chemin/scripts/backup/backup.sh`.

## Restaurer
```bash
# 1. base vierge (Supabase : nouveau projet, ou Postgres local)
# 2. récupérer le dump (aws s3 cp …) puis :
CONFIRM=yes ./scripts/backup/restore.sh resto-20261014T210000Z.dump "postgresql://…/postgres"
# dump chiffré :
CONFIRM=yes AGE_IDENTITY=cle.txt ./scripts/backup/restore.sh resto-….dump.age "postgresql://…"
# directement depuis S3 :
CONFIRM=yes ./scripts/backup/restore.sh s3://mon-bucket/resto/2026/10/resto-….dump "postgresql://…"
```
La restauration remplace les tables (`--clean --if-exists`, en une transaction : tout ou rien). Ensuite, pointez `DATABASE_URL` de l'application sur la base restaurée.

## Exercice de restauration (à faire chaque trimestre)
Une sauvegarde jamais restaurée n'est qu'une hypothèse. Restaurez le dernier dump dans une base de test et comparez quelques comptes :
```sql
select count(*) from menu_items; select count(*) from orders where status = 'paid'; select max(paid_at) from orders;
```
Le script a été vérifié sur ce principe : base source et base restaurée ont les mêmes effectifs.

## Récupération à un instant précis
Un dump quotidien limite la perte à **24 h** au pire. Si c'est trop, la fonction *Point-in-Time Recovery* de Supabase (plan payant) ou une exécution du script toutes les heures réduit l'exposition.
