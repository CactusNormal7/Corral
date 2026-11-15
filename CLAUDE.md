# Corral — notes pour les sessions de développement

Cockpit Electron pour piloter wrangler sur plusieurs projets. Vue d'ensemble, installation
et format de `corral.json` : voir `README.md`. Lire d'abord `src/shared/ipc-contract.ts`
et `src/shared/types.ts`, qui décrivent le système.

## Carte

```
src/main/index.ts              bootstrap, fenêtre, arrêt de tous les process à la fermeture
src/main/ipc/index.ts          TOUS les handlers ipcMain ; garde-fous appliqués ici, avant spawn
src/main/domain/               logique pure, sans Electron — seul endroit testé (*.test.ts)
  config-parser.ts               TOML/JSONC → WorkerConfig ; env `local` = config par défaut
  worker-discovery.ts            scan des wrangler.toml|jsonc|json (prof. 6, dossiers ignorés)
  wrangler-cli.ts                lockfile → pnpm/npm/yarn/bun, et toutes les fonctions *Args
  wrangler-runner.ts             spawn sans shell, streaming ligne à ligne, NO_COLOR
  wrangler-parsers.ts            parsing défensif des sorties, port du dev server, URL explorer
  migrations-matrix.ts           fichiers sur disque × relevés wrangler
  project-store.ts               projects.json dans userData, écriture atomique
  guard.ts                       requirementFor / assertConfirmed
  custom-actions-loader.ts       corral.json + scripts du package.json racine
src/main/services/             hubs avec état, injectés dans registerIpc
  worker-registry.ts             workerId → config relue sur disque + cwd + commande wrangler
  output-hub.ts                  onglets de log (runInTab) pour les commandes non interactives
  pty-hub.ts                     sessions node-pty (dev, login, tail, actions interactives)
  dev-server-hub.ts              un `wrangler dev` par Worker, état et port
src/preload/index.ts           implémente CorralApi sur ipcRenderer, exposé en window.corral
src/renderer/                  Vue 3 + PrimeVue (Aura) + Pinia ; components/, stores/
src/shared/                    types.ts (modèle) et ipc-contract.ts (canaux + CorralApi)
```

Alias Vite côté renderer : `@renderer`, `@shared`. Imports avec extension `.js`.

## Architecture

- Process et disque : **main uniquement**. Le renderer passe par `window.corral`
  (`contextIsolation: true`, `nodeIntegration: false`).
- **Le renderer ne construit jamais une ligne de commande.** Il nomme une action et ses
  paramètres (workerId, binding, `EnvRef`) ; le main choisit l'argv via `wrangler-cli.ts`.
- Ajouter une opération = `CHANNELS` + signature dans `CorralApi` (ipc-contract) +
  handler (ipc) + implémentation (preload) + UI. Les handlers v0.2 (`deployRun`,
  `d1Execute`, `d1Info`, `deploymentsList`, `logsTail`) existent dans `ipc/index.ts` mais
  **ne sont ni dans `CorralApi` ni dans le preload** : à ajouter avant tout composant.
  `customActions` est exposé de bout en bout mais sans UI.
- Commande courte → `run()` et `CommandResult`. Commande longue non interactive →
  `output.runInTab()`. Commande qui veut un TTY → `pty.spawn()`.

## Règles d'exécution de wrangler

1. Toujours le wrangler **du projet** (`pnpm exec wrangler`, `npx --no-install wrangler`,
   `yarn wrangler`, `bunx wrangler`), choisi par lockfile en remontant depuis le dossier
   de la config jusqu'au dossier enregistré, et lancé avec `cwd` = dossier de la config.
   Jamais un wrangler global.
2. Préférer `--json` quand il existe ; sinon parser le texte défensivement — ne jamais
   supposer que la 1re ligne est utile. `extractJson` sait lire un JSON précédé de
   bandeaux, mais n'est encore appelé nulle part (seul `d1 info` demande `--json`).
3. Env nommé → toujours `--env <nom>` (`envFlag`) : les bindings ne sont pas hérités.
   `local` = config par défaut + `--local`, sans `--env`.
4. Tué par signal ≠ succès : code 130 (runner et pty-hub).
5. Sortie streamée ligne à ligne ; une erreur wrangler est affichée telle quelle, jamais
   avalée ni reformulée.

## Garde-fous non négociables

- Écriture sur un env distant ⇒ confirmation. Env de production (`production`/`prod`, ou
  marqué via `prodLikeEnvs`) ⇒ retaper le nom exact. Vérifié par `guard()` dans
  `ipc/index.ts` **avant** le spawn ; tout nouveau handler qui écrit en distant prend un
  `ConfirmedRequest` et appelle `guard()` en premier.
- Bandeau permanent : vert local, orange distant, rouge prod (`EnvBanner.vue`).
- Aucune écriture dans les fichiers des projets. `config-parser` et `worker-registry` sont
  en lecture seule ; l'état propre à Corral va dans `projects.json`.
- Aucune suppression de ressource Cloudflare.
- `spawn` avec tableau d'arguments, `shell: false`. Seules les actions personnalisées
  passent par `$SHELL -lc` (écrites par l'utilisateur dans son dépôt).
- On n'affiche jamais la valeur d'une var, seulement son nom.

## Pièges du code

- `wrangler d1 migrations list` ne liste que les migrations **en attente**. Appliquée =
  fichier sur disque ∖ en attente (`toMigrationsReport`). Une migration en attente absente
  du disque est conservée.
- Une case `unknown` (relevé absent ou en erreur) n'est **jamais** « appliquée ».
  L'UI affiche « non relevé ».
- Le runner force `NO_COLOR=1` / `FORCE_COLOR=0` : le panneau de sortie est du HTML, pas
  un terminal. `stripAnsi` passe quand même derrière. Les PTY gardent les couleurs.
- La matrice affichée est recalculée dans `MigrationsMatrix.vue` ;
  `buildMigrationsMatrix` (domaine) n'est utilisé que par les tests. Garder les deux
  cohérents ou brancher le composant sur le domaine.
- Les colonnes distantes ne se chargent pas seules (appel au compte Cloudflare), et
  « Appliquer » ne recharge pas la matrice.
- `wrangler dev` tourne toujours sur la config par défaut (`devArgs()`).
- Le port du dev server est **lu** dans la sortie (`parseDevServerPort`), jamais supposé.
- `DevServerHub.stop` publie `stopped` avant de tuer : sinon `onExit` conclut à un crash.
- `workerId` = sha1(projectId + chemin de config) ; `projectId` = sha1(chemin). Stables
  entre deux lancements, ils changent si un fichier bouge.
- Un `database_id` non-UUID est un placeholder : avertissement, pas une erreur bloquante.
- `isProdLike` est toujours faux pour `local`, même marqué.
- Un dossier n'expose qu'une config : TOML > JSONC > JSON.
- pnpm 10.28 ignore `pnpm.onlyBuiltDependencies` de `package.json` : binaire Electron et
  `spawn-helper` de node-pty à réparer à la main (voir README). Node 26 casse
  l'installation d'Electron.

## Conventions

- Commentaires en **français**, identifiants en **anglais**, UI en **français**.
- Un commentaire explique le **pourquoi** (contrainte, invariant, piège), jamais le quoi.
  S'aligner sur le registre des commentaires existants.
- Branches : `feature/<nom>` ou `hotfix/<nom>`.
- Ne jamais s'ajouter en contributeur : pas de `Co-Authored-By`, aucune mention d'un
  modèle ou d'un outil dans les commits, le code ou la doc.
- Prettier : 100 colonnes, guillemets doubles, virgules finales.

## Avant de déclarer une tâche finie

```sh
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

Toute nouvelle logique de décision (argv, parsing, garde-fou) va dans `src/main/domain/`
avec ses tests ; les handlers et composants restent minces.

## Lancer sans écran (conteneur Linux)

```sh
pnpm build && xvfb-run -a ./node_modules/electron/dist/electron --no-sandbox --remote-debugging-port=9222 .
```

`--no-sandbox` parce que le conteneur tourne en root. Piloter avec Playwright via
`chromium.connectOverCDP("http://127.0.0.1:9222")`. Registre lu dans
`~/.config/corral/projects.json` (format `{ "version": 1, "projects": [{ "id", "name",
"path" }] }`, `id` = 16 premiers hex du sha1 du chemin).
