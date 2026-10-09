# Maps incluses

Deux maps de la communauté (FastFiles ZoneTool/Plutonium) livrées avec le projet. Elles sont copiées dans le build (`dist/maps/`) et
proposées à tous les visiteurs, y compris sur un hébergement statique. Elles servent aussi de **référence** pour le format des maps
custom : `packages/iw5-core/src/zone/BundledMaps.test.ts` les lit entièrement en CI.

| Dossier | Map | Fichiers |
| :-- | :-- | :-- |
| `mp_shipment/` | Shipment | `.ff` (zone), `.iwd` (ses images), `_load.iwd` (écran de chargement), `_load.ff`, `.arena` |
| `mp_rust_long/` | Rust: Long | `.ff`, `.iwd` (images, dont l'écran de chargement), `_load.ff`, `.arena` |

**Ces maps ne contiennent pas les textures de base du jeu** (béton, plâtre, bois… ne sont pas dans leurs `.iwd`) : sans les archives de
Modern Warfare 3, elles s'affichent en couleurs de remplacement. Le jeu d'Activision n'est jamais distribué : fournissez votre dossier
(onglet « Mes fichiers » du menu, ou un dossier partagé au déploiement, voir `README.md`).

Ajouter une map : un dossier `maps/<mp_nom>/` avec son `mp_nom.ff` (+ `.iwd`, `.arena`) ; le manifeste est généré au build. Ne mettre ici
que des maps dont l'auteur autorise la redistribution, et la déclarer dans `CREDITS.md`.
