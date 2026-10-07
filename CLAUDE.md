# MWThree

Explorateur MW3 (2011) jouable dans le navigateur, construit en parsant les fichiers du jeu de l'utilisateur (usage strictement local : ne jamais commiter ni redistribuer d'assets, `inputs/` est ignoré).

Lire d'abord `docs/SESSION_REFERENCE.md` (état, commandes, prochaines étapes) puis `docs/RE_NOTES.md` (format des zones).

## Commandes

- `npm run dev` : viewer (`/?dev=dome` charge `inputs/zone/dome/mp_dome.ff`)
- `npm run test -w packages/iw5-core` : tests (l'intégration est ignorée sans `inputs/`)
- `npx tsx scripts/loadZone.mts <zone.ff>` : vérifie qu'une zone est lue à l'octet près
- `node scripts/genSchema.mjs` : régénère `src/generated/iw5Schema.json`

## Conventions

- Commits directement sur `main`, atomiques, messages conventionnels (`feat:`, `fix:`, `docs:`…), historique propre et cohérent.
- Les structs d'assets ne s'écrivent pas à la main : elles viennent du schéma généré depuis OpenAssetTools.
