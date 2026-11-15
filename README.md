# Corral

Cockpit desktop pour piloter en local plusieurs projets Cloudflare Workers.

On enregistre ses dossiers de projets ; Corral y détecte les configs wrangler, affiche
l'infra de chaque Worker (bindings, vars, routes, crons) par environnement, et donne des
boutons pour les opérations courantes — migrations D1, serveur de dev, connexion au compte
— sans avoir à se souvenir des combinaisons `--env` / `--local` / `--remote` de wrangler.

Application Electron + Vue 3, pensée pour macOS. UI en français.

## Positionnement

- **Corral n'est pas un explorateur de données.** wrangler (≥ 4.82) embarque un Local
  Explorer (KV, R2, D1, Durable Objects, logs) servi sur `/cdn-cgi/explorer` par
  `wrangler dev`. Corral ouvre ce lien quand le serveur de dev tourne ; il ne le
  réimplémente pas.
- **Sa valeur est le cockpit multi-projets / multi-environnements** : voir d'un coup
  d'œil où en sont les migrations sur chaque env, lancer et arrêter les serveurs de dev,
  appliquer, déployer, suivre les logs.
- **La logique propre à un projet reste dans le projet.** Corral l'expose via des actions
  personnalisées déclarées dans un `corral.json` (voir plus bas), il ne la réimplémente
  pas.
- **Lecture seule sur les projets.** Corral ne modifie jamais `wrangler.toml` ni aucun
  fichier d'un projet. Les écritures passent par wrangler ou par les actions
  personnalisées. Aucune suppression de ressource Cloudflare n'est proposée.

<!-- Capture d'écran : aucune n'existe encore au dépôt. -->

## Prérequis

- macOS (cible principale ; le code n'a rien de spécifique à macOS, mais c'est le seul
  OS visé).
- Node.js. **Attention à Node 26** : avec Node 26, le script d'installation d'Electron
  s'interrompt sans erreur pendant l'extraction de l'archive, et le binaire Electron
  n'est pas installé. Node 23 fonctionne.
- pnpm 10.28 (épinglé par `packageManager` dans `package.json` ; `corepack enable` le
  fournit).
- Dans chaque projet piloté : `wrangler` installé **comme dépendance du projet**. Corral
  n'utilise jamais un wrangler global.

## Installation

```sh
pnpm install
```

### Piège : les scripts d'installation des modules natifs

`package.json` déclare `pnpm.onlyBuiltDependencies` (`electron`, `esbuild`, `node-pty`),
mais **pnpm 10.28 ignore ce champ** (il l'annonce par un `WARN` à chaque commande). Les
scripts d'installation de ces paquets ne sont donc pas exécutés, sans question ni
erreur. Conséquences observées :

- **Electron** : le binaire n'est pas téléchargé, `pnpm dev` ne peut pas démarrer.
- **node-pty** : le module se charge (il est livré précompilé pour macOS arm64/x64,
  aucune compilation n'est nécessaire), mais son `spawn-helper` n'est pas rendu
  exécutable. Tout ce qui passe par un PTY — serveur de dev, `wrangler login`, `tail`,
  actions interactives — échoue avec `posix_spawnp failed`.

Contournement, après `pnpm install` :

```sh
node node_modules/electron/install.js            # télécharge le binaire Electron (pas avec Node 26)
chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper
```

`pnpm approve-builds` est l'autre voie, interactive, pour autoriser ces scripts.

Les Xcode Command Line Tools ne servent que si node-pty doit se recompiler faute de
binaire précompilé pour la plateforme.

## Commandes

| Commande            | Effet                                                       |
| ------------------- | ----------------------------------------------------------- |
| `pnpm dev`          | Lance l'app en développement (electron-vite, rechargement). |
| `pnpm build`        | Compile main, preload et renderer dans `out/`.              |
| `pnpm start`        | Lance l'app depuis le build (`electron-vite preview`).      |
| `pnpm typecheck`    | `tsc` côté main/preload, `vue-tsc` côté renderer.           |
| `pnpm lint`         | ESLint, zéro avertissement toléré.                          |
| `pnpm format`       | Prettier en écriture.                                       |
| `pnpm format:check` | Prettier en vérification.                                   |
| `pnpm test`         | Vitest (logique pure du main process).                      |
| `pnpm test:watch`   | Vitest en mode surveillance.                                |

## Ce que fait la v0.1

- **Registre de projets** : ajout d'un dossier par le sélecteur natif, renommage, retrait
  (le dossier n'est jamais supprimé). Le registre est un fichier `projects.json` dans le
  dossier de données de l'app (`app.getPath('userData')`, soit
  `~/Library/Application Support/corral/` sous macOS).
- **Détection des Workers** : scan récursif du dossier à la recherche de
  `wrangler.toml`, `wrangler.jsonc`, `wrangler.json`. Un monorepo peut contenir plusieurs
  Workers ; chacun apparaît dans la barre latérale.
- **Vue Worker en lecture seule**, par environnement (`local` = config par défaut, puis
  chaque `[env.x]`) : nom du Worker, bindings D1 / KV / R2 / Durable Objects / Queues,
  **noms** des vars (jamais leurs valeurs), routes, crons. Un `database_id` absent ou qui
  n'a pas la forme d'un UUID est signalé.
- **Bandeau d'environnement permanent** : vert en local, orange sur un env distant, rouge
  sur un env de production.
- **Environnements de production** : `production` et `prod` le sont d'office ; tout autre
  env distant peut être marqué comme tel par un interrupteur (stocké dans le registre,
  jamais dans le projet).
- **Compte Cloudflare** : `wrangler whoami`, et `wrangler login` dans un terminal intégré.
- **Matrice des migrations D1**, une par binding D1 de la config par défaut : une ligne
  par fichier de migration, une colonne `local` (`--local`) puis une colonne par env
  nommé (`--remote --env x`). Seule la colonne `local` se charge à l'ouverture ; les
  colonnes distantes se relèvent à la demande. Bouton « Appliquer » par colonne.
- **Confirmations** : toute écriture distante demande une confirmation ; sur un env de
  production, il faut retaper son nom à l'identique. La vérification est faite dans le
  main process avant le lancement de la commande, pas seulement dans l'UI.
- **Serveur de dev** : `wrangler dev` dans un PTY (terminal xterm.js), un par Worker,
  port lu dans la sortie de wrangler, boutons « Ouvrir l'app » et « Local Explorer ».
  Les serveurs sont arrêtés à la fermeture de l'app.
- **Panneau de sortie commun** : un onglet par commande, sortie streamée ligne à ligne,
  ligne de commande affichée (pour la reproduire en terminal), code de sortie, copie.

### Limites connues

- Aucun test d'intégration avec un vrai wrangler ni un vrai compte Cloudflare : le
  chemin « succès » de `d1 migrations list` n'a jamais été exercé contre une vraie
  sortie wrangler.
- node-pty n'a jamais été exercé par l'app : serveur de dev, login, tail et actions
  interactives n'ont jamais démarré de vrai process.
- Les composants Vue n'ont pas de tests unitaires ; seule la logique du main process est
  testée.
- Jamais lancé sur macOS.
- Après « Appliquer », la matrice ne se recharge pas d'elle-même : il faut cliquer sur
  rafraîchir pour la colonne concernée.
- Un seul fichier de config par dossier (`wrangler.toml` prioritaire sur `.jsonc` puis
  `.json`) ; le scan descend au plus de 6 niveaux et ignore `node_modules`, `.wrangler`,
  `dist`, `.git`, `out`, `build`, `coverage`, `.next`, `.turbo`.
- La matrice n'a pas de colonne « config par défaut en `--remote` » : la config par
  défaut n'y apparaît qu'en local.
- `wrangler dev` tourne toujours sur la config par défaut, jamais sur un env nommé.
- Le gestionnaire de paquets (donc la façon d'appeler wrangler) est détecté par lockfile
  en remontant depuis la config, **sans dépasser le dossier enregistré** : enregistrez la
  racine du monorepo, pas un sous-dossier.

## Actions personnalisées : `corral.json`

Un fichier `corral.json` à la racine du dossier enregistré déclare des commandes propres
au projet. Les commentaires et virgules finales sont acceptés (JSONC).

```jsonc
{
  "actions": [
    {
      "id": "seed-local",
      "label": "Seed base locale",
      "command": "pnpm run db:seed",
      "cwd": "apps/server",
    },
    {
      "id": "shell-db",
      "label": "Console D1 locale",
      "command": "pnpm exec wrangler d1 execute DB --local",
      "interactive": true,
    },
  ],
}
```

| Champ         | Requis | Défaut  | Rôle                                                     |
| ------------- | ------ | ------- | -------------------------------------------------------- |
| `id`          | oui    | —       | Identifiant de l'action.                                 |
| `command`     | oui    | —       | Ligne de commande, exécutée par `$SHELL -lc`.            |
| `label`       | non    | `id`    | Libellé affiché.                                         |
| `interactive` | non    | `false` | `true` : lancée dans un terminal (PTY) plutôt qu'en log. |
| `cwd`         | non    | `.`     | Dossier d'exécution, relatif à la racine du projet.      |

Une entrée sans `id` ou sans `command` est ignorée. Les scripts du `package.json` racine
sont aussi proposés comme actions (`npm run <nom>`, sauf les scripts de cycle de vie
comme `postinstall`) ; une action de `corral.json` du même id (`script:<nom>`) les
remplace.

Ce sont les seules commandes que Corral fait passer par un shell : c'est l'utilisateur
qui les a écrites dans son propre dépôt. Elles ne passent pas par les confirmations
d'environnement.

**En v0.1, ces actions sont chargées et exécutables côté main process, mais aucun écran
ne les affiche encore.**

## Prévu en v0.2

Le main process sait déjà exécuter ces commandes ; il manque leur exposition au renderer
et les écrans :

- déploiement (`wrangler deploy --env x`), avec confirmation ;
- SQL sur une base D1 (`wrangler d1 execute`), avec confirmation en distant ;
- informations sur une base (`wrangler d1 info --json`) ;
- liste des déploiements (`wrangler deployments list`) ;
- logs en direct (`wrangler tail`) dans un terminal ;
- les actions personnalisées de `corral.json`.

## Architecture en bref

Toute exécution de process et tout accès disque vivent dans le main process Electron.
Le renderer (Vue) n'y accède que par un pont `contextBridge` typé et minimal
(`contextIsolation: true`, `nodeIntegration: false`) ; il nomme une action et ses
paramètres, et c'est le main qui construit la ligne de commande. Le contrat des canaux
IPC est dans `src/shared/ipc-contract.ts`.
