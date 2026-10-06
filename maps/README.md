# Maps incluses

Deux maps de la communauté (FastFiles ZoneTool/Plutonium) livrées avec le projet. Elles sont copiées dans le build (`dist/maps/`) et
proposées à tous les visiteurs, y compris sur un hébergement statique. Elles servent aussi de **référence** pour le format des maps
custom : `packages/iw5-core/src/zone/BundledMaps.test.ts` les lit entièrement en CI.

| Dossier | Map | Fichiers |
| :-- | :-- | :-- |
| `mp_shipment/` | Shipment | `.ff` (zone), `.iwd` (ses images), `_load.iwd` (écran de chargement), `_load.ff`, `.arena` |
| `mp_rust_long/` | Rust: Long | `.ff`, `.iwd` (images, dont l'écran de chargement), `_load.ff`, `.arena` |


Ajouter une map : un dossier `maps/<mp_nom>/` avec son `mp_nom.ff` (+ `.iwd`, `.arena`) ; le manifeste est généré au build. Utiliser le script `scripts/makeTexturePack.mts` pour conserver uniquement les textures d'une map et réduire la taille du build.
