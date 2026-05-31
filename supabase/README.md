# Déploiement

## 1. Edge Function (création d'admin)

```bash
# Installer Supabase CLI
npm install -g supabase

# Se connecter
supabase login

# Lier le projet
supabase link --project-ref fpllagysfbrxhyzizudy

# Déployer la fonction
supabase functions deploy create-admin --no-verify-jwt

# Définir la variable d'environnement (service_role)
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<votre_service_role_key>
```

> La `service_role key` se trouve dans : Supabase Dashboard → Settings → API → `service_role` key (project settings).

## 2. Migrations SQL

Les migrations SQL s'appliquent via l'éditeur SQL du dashboard Supabase :
1. Aller dans `SQL Editor`
2. Copier-coller le contenu du fichier concerné
3. Exécuter
