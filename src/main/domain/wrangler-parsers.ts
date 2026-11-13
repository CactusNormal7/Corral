/**
 * Parsing défensif des sorties de wrangler.
 * wrangler préfixe parfois sa sortie de bandeaux (proxy, mise à jour disponible) et
 * change la mise en forme de ses tableaux entre versions : on ne suppose jamais que
 * la première ligne est utile, ni qu'un `--json` commence au premier caractère.
 */

/**
 * Extrait la première valeur JSON d'une sortie, en repartant de la ligne qui ouvre
 * réellement la structure plutôt que du premier crochet venu.
 */
export function extractJson<T>(stdout: string): T | null {
  const lines = stdout.split("\n");
  for (let start = 0; start < lines.length; start++) {
    const trimmed = lines[start]!.trimStart();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) continue;
    const candidate = lines.slice(start).join("\n");
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Ce crochet ouvrait autre chose (un bandeau, un fragment de log) : on continue.
    }
  }
  return null;
}

/** Réponse de wrangler quand toutes les migrations sont déjà passées. */
const NO_PENDING_PATTERN = /no migrations to apply/i;

/**
 * Lignes de décor des tableaux de wrangler (cli-table3) et bandeaux à écarter.
 * On ne garde que le contenu des cellules.
 */
const TABLE_BORDER_PATTERN = /^[\s│┌┐└┘├┤┬┴┼─━╭╮╯╰|+=-]*$/;

/** Séquences ANSI : wrangler colore sa sortie dès qu'il croit parler à un terminal. */
// eslint-disable-next-line no-control-regex -- retirer les couleurs exige de viser ESC.
const ANSI_PATTERN = /\u001B\[[0-9;]*[A-Za-z]/g;

/**
 * Retire les séquences ANSI d'un texte. `NO_COLOR` ne suffit pas toujours : tous
 * les outils ne le respectent pas, et une sortie colorée affichée en HTML donnerait
 * des « [90m » en clair.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function stripDecoration(line: string): string {
  return stripAnsi(line).replace(/[│|]/g, " ").trim();
}

/**
 * `wrangler d1 migrations list` ne liste que les migrations **non appliquées**.
 * On en déduit les appliquées en soustrayant de la liste des fichiers sur disque
 * (cf. `buildMigrationsMatrix`), plutôt que de supposer un format pour les deux.
 */
export function parsePendingMigrations(stdout: string): string[] {
  if (NO_PENDING_PATTERN.test(stdout)) return [];

  const pending: string[] = [];
  for (const rawLine of stdout.split("\n")) {
    if (TABLE_BORDER_PATTERN.test(rawLine)) continue;
    const line = stripDecoration(rawLine);
    if (line.length === 0) continue;
    // En-tête du tableau et phrase d'introduction : pas des noms de fichiers.
    if (/^name$/i.test(line)) continue;
    if (/migrations to be applied/i.test(line)) continue;
    // Un nom de migration est un fichier .sql ; tout le reste est du bavardage.
    for (const token of line.split(/\s{2,}/)) {
      const name = token.trim();
      if (name.endsWith(".sql")) pending.push(name);
    }
  }
  return [...new Set(pending)];
}

/**
 * Port du serveur de dev, lu dans la sortie de `wrangler dev`.
 * Le port demandé n'est pas toujours celui obtenu (port déjà pris), donc on lit
 * ce que wrangler annonce et non ce qu'on a demandé.
 */
export function parseDevServerPort(line: string): number | null {
  const clean = line.replace(ANSI_PATTERN, "");
  const match = clean.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})/i);
  if (!match) return null;
  const port = Number.parseInt(match[1]!, 10);
  return port > 0 && port <= 65535 ? port : null;
}

/** Vrai quand wrangler signale que le serveur est prêt à recevoir des requêtes. */
export function isDevServerReady(line: string): boolean {
  return /\bready on\b/i.test(line.replace(ANSI_PATTERN, ""));
}

/** URL du Local Explorer embarqué par wrangler (≥ 4.82), que Corral ne duplique pas. */
export function localExplorerUrl(port: number): string {
  return `http://localhost:${port}/cdn-cgi/explorer`;
}

export function devServerUrl(port: number): string {
  return `http://localhost:${port}`;
}

/**
 * Ce que wrangler répond quand la ressource visée n'existe pas.
 * Ce n'est pas une erreur de Corral : l'UI le présente comme une absence.
 */
export function saysMissing(text: string): boolean {
  return /does not exist|not found|could not find|couldn't find/i.test(text);
}

/**
 * Vrai si la sortie indique que wrangler n'a pas de session Cloudflare.
 * Permet à l'UI de proposer « se connecter » au lieu d'afficher une erreur brute.
 */
export function saysNotAuthenticated(text: string): boolean {
  return /not (?:logged in|authenticated)|you are not authenticated|run `?wrangler login/i.test(
    text,
  );
}
