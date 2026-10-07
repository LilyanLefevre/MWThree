# MW3 Explorer — Référence de session

## État d'avancement

| Phase | Statut |
| :-- | :-- |
| 0 — Fondations (monorepo, viewer R3F, détection MW3) | ✓ |
| 1 — Décompression FastFile (`IWff0100` signé, `IWffu100`) | ✓ |
| 2 — Zone loader (assets, pointeurs, blocs) | ✓ — les 16 maps `mp_*` de `inputs/zone/` se chargent à l'octet près |
| 3 — Collision + déplacement FPS | ✓ — brushes `clipMap_t` solides/playerclip → enveloppes convexes → un trimesh Rapier (+ triangles de terrain) ; marche, saut, vol libre, **C** affiche la collision. Reste : collision des modèles statiques |
| 4 — Géométrie visuelle | ✓ — surfaces BSP du `GfxWorld` + modèles statiques instanciés (`smodelDrawInsts` → `XModel` LOD0), couleur par matériau. Manquent : LOD, collision des props |
| 5 — Textures `.iwd` / `.iwi` | ⏳ |
| 6 — Entités / UX | ◐ — entités décodées (spawns utilisés pour placer le joueur) ; pas d'overlay debug |

## Lancer

```bash
npm run build -w packages/iw5-core   # le viewer importe le dist
npm run dev                          # http://localhost:5173
```

- Bouton « Select MW3 Game Folder » → choisir le dossier d'installation (ou un dossier contenant `zone/<map>/mp_<map>.ff`), puis cliquer une map.
- Raccourci dev (Vite uniquement) : `http://localhost:5173/?dev=dome` charge `inputs/zone/dome/mp_dome.ff` ; `&free=1` accepte le clavier sans pointer lock (tests automatisés).
- Contrôles : clic = capture souris, WASD/ZQSD, Espace = saut, Maj = sprint, **V = vol libre**, **C** = afficher la collision (Espace/Ctrl = monter/descendre).
- Chargement ≈ 20–30 s (Web Worker) ; voir « Perf » dans `RE_NOTES.md`.

## Vérifier le loader

```bash
npx tsx scripts/loadZone.mts inputs/zone/dome/mp_dome.ff   # bytesRead == taille zone, blocs simulés == en-tête
npm run test -w packages/iw5-core                            # inclut l'intégration mp_dome (ignorée sans inputs/)
node scripts/genSchema.mjs                                   # régénère src/generated/iw5Schema.json
```

## Structure

```
packages/iw5-core/
  zonecode/            header + règles OpenAssetTools (source du schéma)
  src/FastFileLoader.ts            .ff → zone (load() pako, loadAsync() natif)
  src/generated/iw5Schema.json     généré par scripts/genSchema.mjs
  src/zone/ZoneLoader.ts           interpréteur piloté par le schéma (pointeurs, blocs, références)
  src/zone/Expr.ts                 évaluateur des expressions de règles (counts/conditions)
  src/zone/MapExtract.ts           GfxWorld → mesh, MapEnts → entités
packages/viewer/
  src/worker/mapWorker.ts          décompression + lecture + extraction hors thread UI
  src/components/WorldMesh.tsx     mesh + TrimeshCollider
  src/components/Player.tsx        capsule Rapier + PointerLockControls
packages/iw5-core/src/zone/Collision.ts  clipMap_t → mesh de collision (brushes + terrain)
packages/iw5-collision/            stub (inutilisé pour l'instant)
scripts/                           genSchema.mjs, loadZone.mts (outils de vérification)
```

## Prochaines étapes

1. **Textures** : `.iwd` (fflate) + `.iwi` (DXT) + `Material.textureTable`.
2. **Perf du chargement** : décodage paresseux, moins de copies, cache IndexedDB du résultat.
3. Overlay entités (spawns, triggers), sélecteur de map, noclip/téléport.

## Décisions

- Physique Rapier3D ; fichiers locaux uniquement (File System Access API), aucun asset redistribué.
- Les structs/règles viennent d'OpenAssetTools : on ne les réécrit pas à la main, on les compile (`genSchema.mjs`).
- Repère scène : `(x, z, −y) × 0.0254` (mètres, Y haut).
