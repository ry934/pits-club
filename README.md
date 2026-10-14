# Pause Kart

App compagnon des sessions de kart du midi : récap de session, classements, fiches pilotes, duels, records.
Lot 1 du cahier des charges « MK Companion ».

- **Saisie** : le Google Form existant, rien ne change pour les joueurs.
- **Données** : le Google Sheet reste la source de vérité ; un Apps Script pousse chaque course vers Supabase.
- **App** : React + Vite, hébergée sur Vercel. Sans configuration, elle tourne en mode démo sur l'historique embarqué.

## Mise en route (≈ 30 min, une seule fois)

### 1. Supabase (base de données et comptes)
1. Créer un compte sur supabase.com, puis un projet gratuit (région Europe, Paris ou Francfort).
2. SQL Editor > New query : coller `supabase/setup.sql` (schéma + pilotes + secret), remplacer le secret, Run. `seed.sql` reste disponible en secours pour importer l'historique sans le Sheet.
3. Toujours dans SQL Editor, choisir un secret (une longue phrase aléatoire) et l'enregistrer :
   ```sql
   insert into app_secrets (key, value) values ('sheet_sync', 'REMPLACER-PAR-UN-SECRET-LONG');
   ```
4. Authentication > Providers > Email : laisser activé. Pour aller vite, désactiver « Confirm email ».
5. Project Settings > API : noter **Project URL** et la clé **anon public**.

### 2. Synchro du Google Sheet
1. Dans le Sheet : Extensions > Apps Script, coller `apps-script/Code.gs`.
2. Paramètres du projet > Propriétés du script : `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SYNC_SECRET` (le secret de l'étape 1.3).
3. Exécuter une fois `installTriggers` et accepter les autorisations. La réconciliation de la nuit corrige toute modification faite à la main dans le Sheet.

### 3. Mise en ligne
1. Pousser ce dossier sur un dépôt GitHub (privé).
2. Sur vercel.com : New Project > importer le dépôt (framework détecté : Vite).
3. Variables d'environnement : `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`. Déployer.
4. Envoyer le lien aux joueurs : chacun crée son compte (Profil) et choisit son nom de pilote.

## Développement

```bash
npm install
npm run dev            # mode démo si .env est vide
npm test               # contrôle des calculs contre les records du Sheet
npm run build          # build de production (Vercel)
npm run build:preview  # un seul fichier HTML autonome, données de démo
python3 -I scripts/make_seed.py <export-du-sheet.txt>   # régénère les données de démo et seed.sql
```

## Direction artistique
« Neon Grand Prix » : borne d'arcade 90s × HUD de course. Tokens dans `src/styles.css` (couleurs à rôle fixe :
jaune = records, cyan = navigation, vert = victoires, rouge = défaites/rivalités, violet = Takes et raretés).
Polices : Oxanium (titres, chiffres), DM Sans (texte), JetBrains Mono (positions, scores). Emblèmes des trophées
dessinés en SVG dans `src/components/Emblem.tsx` (originaux, aucun asset Nintendo).

## Ce qui est réel, ce qui est simulé
- **Réel** : classements, sessions, rivalités, records, trophées (calculés sur l'historique), horoscope et défi du jour
  (version provisoire générée à partir des stats, l'IA arrive au lot 3).
- **Simulé** : `src/mock/takes.ts` uniquement. Les Takes des autres pilotes sont fictifs (résolus sur les vrais
  résultats) et le Take de l'utilisateur reste dans son navigateur. Rien n'est envoyé à un serveur : la confidentialité
  avant 13h, les comptes et la reformulation IA arrivent au lot 2 (RLS déjà prévue dans la migration).

## Règles de calcul (résumé)
- Deux saisies à moins de 60 s : la seconde remplace la première.
- Même nom deux fois dans une course : course écartée, listée dans Records > Saisies à corriger.
- Classement : position moyenne, puis victoires, puis nombre de courses.
- Cote : Elo multijoueur (K = 12, départ 1 500), utilisée pour la surperformance et les duels. Elle ne remplace pas la moyenne (même pouvoir prédictif, testé sur 4 356 duels).
- Session : close 20 min après la dernière course, ou via le bouton « Fin de session ».

Le détail complet est dans le cahier des charges.
