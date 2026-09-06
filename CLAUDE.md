# MWThree

Explorateur MW3 (2011) jouable dans le navigateur, construit en parsant les fichiers du jeu de l'utilisateur.
Usage strictement local : les fichiers du jeu (`inputs/`, ignoré par git) ne sont jamais commités ni redistribués.
Les captures du viewer, elles, sont les bienvenues dans `docs/images/screens/` et le README.

Lire d'abord `docs/SESSION_REFERENCE.md` (état, commandes, prochaines étapes), puis `docs/RE_NOTES.md` (format des zones,
faits vérifiés, points non résolus). `docs/README.md` indexe la doc technique et ses schémas.

## Commandes

- `npm run dev` : viewer ; `http://localhost:5173/?dev=dome&free=1` charge `inputs/zone/dome/mp_dome.ff`, et `free` accepte le clavier sans pointer lock
- `npm run build -w packages/iw5-core` : obligatoire après toute modif de `iw5-core` (le viewer importe son `dist`)
- `npm run test -w packages/iw5-core` : tests (l'intégration `mp_dome` est ignorée sans `inputs/`)
- `npx tsc -p packages/viewer/tsconfig.app.json --noEmit` et `npx oxlint` (dans `packages/viewer`) : à faire passer avant chaque commit
- `npx tsx scripts/loadZone.mts <zone.ff>` : la zone doit être lue à l'octet près, avec des blocs simulés identiques à l'en-tête
- `npx tsx scripts/checkMaps.mts` : tous les extracteurs sur les 16 maps (non-régression)
- `node scripts/genSchema.mjs` : régénère `packages/iw5-core/src/generated/iw5Schema.json`

## Bonnes pratiques

- **Git** : commits directement sur `main`, atomiques, messages conventionnels (`feat:`, `fix:`, `perf:`, `docs:`, `refactor:`, `chore:`), push après chaque commit. Ne jamais versionner de fichiers d'outils IA (`.opencode/`, `.playwright-cli/`, `.claude/settings.local.json`) ni `.DS_Store`.
- **Doc** : mettre à jour `docs/SESSION_REFERENCE.md` (état et prochaines étapes), `docs/04-rendu.md` / `docs/02-fichiers.md` (fonctionnement) et `docs/RE_NOTES.md` (découvertes et impasses) à chaque avancée, dans le commit concerné ou juste après.
- **Map de test** : toujours `mp_dome` (la plus rapide) pour les vérifications et captures. Les autres maps servent seulement à vérifier la non-régression via `checkMaps`.
- **Vérification visuelle** : Playwright CLI avec une session dédiée (`playwright-cli -s=mw3 …`), jamais la session par défaut (c'est le navigateur de l'utilisateur). En dev, `window.__player` expose la position et `window.__render` les fps / triangles. Supprimer `.playwright-cli/` après usage.
- **Cache** : incrémenter `CACHE_VERSION` (`packages/viewer/src/worker/cache.ts`) dès que les données extraites changent. Attention : Playwright repart d'un profil vierge à chaque `open`, donc pas de cache entre deux ouvertures de session.
- **Format des données** : les structs d'assets ne s'écrivent pas à la main, elles viennent du schéma OpenAssetTools compilé. Toute hypothèse de format se valide sur des données réelles (comptes qui tombent juste, rendu à l'écran) avant d'être intégrée ; une piste non validée se documente dans `RE_NOTES.md` sans être livrée.
- **Mesures** : annoncer des chiffres mesurés (temps du panneau d'info, `__render`), en précisant les conditions (dev, machine chargée). Le navigateur de test n'a pas de vrai GPU : ses fps ne sont pas représentatifs.
- **Médias** : captures JPEG via `sips`, GIF assemblés avec `gifenc` (ffmpeg est cassé sur la machine de dev, ne pas réparer l'installation de l'utilisateur).
