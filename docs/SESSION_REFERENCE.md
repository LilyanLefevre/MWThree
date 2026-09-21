# MW3 Explorer — Référence de session

## État d'avancement

| Phase | Statut |
| :-- | :-- |
| 0 — Fondations (monorepo, viewer R3F, détection MW3) | ✓ |
| 1 — Décompression FastFile (`IWff0100` signé, `IWffu100`) | ✓ |
| 2 — Zone loader (assets, pointeurs, blocs) | ✓ — les 16 maps `mp_*` de `inputs/zone/` se chargent à l'octet près |
| 3 — Collision + déplacement FPS | ✓ — brushes `clipMap_t` solides/playerclip → enveloppes convexes → un trimesh Rapier (+ triangles de terrain) ; marche, saut, vol libre, **C** affiche la collision. Les modèles statiques ne bloquent pas le joueur en jeu (clip par brushes) |
| 4 — Géométrie visuelle | ✓ — surfaces BSP du `GfxWorld` + modèles statiques et props d'entités (`script_model`, état intact) instanciés (`smodelDrawInsts` → `XModel` LOD0), couleur par matériau. Textures de tous les modèles (y compris props d'entités) et formats IWi wavelet décodés |
| 5 — Textures `.iwd` / `.iwi` | ✓ — color maps des matériaux (DXT1/3/5, ARGB, RGB, A8) lues dans `main/*.iwd`, appliquées au monde et aux props ; alpha-test pour le feuillage. Lightmaps du monde appliquées (formule du moteur). Props éclairés par la light grid. Manquent : spec maps, shaders d'origine |
| 6 — Entités / UX | ✓ — noms de maps, téléportation entre spawns, repères de spawns, objectifs des modes de jeu, mini-carte |
| 7 — Interface | ✓ — menu (maps du serveur ou dossier local), écrans de chargement d'origine, HUD, menu pause ; release locale via `vite preview` |

## Lancer

```bash
npm run build -w packages/iw5-core   # le viewer importe le dist
npm run dev                          # http://localhost:5173
```

- **Menu** (`ui/MainMenu.tsx`) : onglet Serveur (maps listées par `/__inputs-list/maps`, servies par le plugin `localInputs` de `vite.config.ts` en dev **et** en `vite preview`) ou Mes fichiers (dossier MW3 via `showDirectoryPicker`). Vignettes `preview_mp_<map>_lobby`, fond = `loadscreen_mp_<map>` de la map survolée, lus dans les `.iwd` par `worker/imageWorker.ts` (`menuImages.ts`).
- **Chargement** (`ui/LoadingScreen.tsx`) : écran d'origine de la map, nom, ligne de lieu (texte de remplacement dans `mapNames.ts` : les vraies chaînes sont dans `zone/english/*.ff`, absent de `inputs/`), progression (téléchargement, étapes du worker, textures) ; il reste affiché jusqu'aux textures.
- **Jeu** : HUD (`ui/Hud.tsx` : mini-carte, réticule, map et mode, raccourcis ; **I** = panneau technique), **Échap** = menu pause (`ui/PauseMenu.tsx` : reprendre, changer de map, calques, commandes).
- `?map=dome` (ou `?dev=dome`) ouvre directement une map du serveur ; `&free=1` accepte le clavier sans pointer lock (tests automatisés) ; en dev, `window.__look(yaw, pitch, [x, y, z]?)` oriente la caméra (et la place en vol libre). La fin de chargement se détecte par la présence de `.hud`.
- **Release locale** : `npm run build` puis `npm run preview -w packages/viewer -- --host` (port 4173) ; testé sur le PC (16 maps listées, Seatown chargée). Un hébergement statique de `packages/viewer/dist/` n'a pas d'onglet Serveur.
- **Dossier partagé** : `inputs/` ou `$MWTHREE_INPUTS` ; maps cherchées dans `zone/<map>/mp_<map>.ff` et `zone/<langue>/mp_<map>.ff` (installation MW3 telle quelle).
- **Docker** : `Dockerfile` (build puis `vite preview`, jeu monté en lecture seule sur `/data`), `docker-compose.yml` (`MW3_DIR`). Testé sur le Mac avec `inputs/` monté (16 maps, lecture par plages). **CI** : `.github/workflows/ci.yml` (tests, typage, oxlint, build ; image poussée sur `ghcr.io/<owner>/mwthree`, `latest` depuis `main`, version depuis les tags `v*`).
- Contrôles : clic = capture souris, WASD/ZQSD, Espace = saut, Maj = sprint, Ctrl = accroupi, **V = vol libre**, **C** = afficher la collision, **T / Maj+T** = spawn suivant/précédent (spawns deathmatch), **O** = repères de spawns (bleu alliés, rouge axe, vert deathmatch, jaune autres modes), **G** = volumes des triggers (orange : utilisation/bombe, jaune : zones, rouge : dégâts), **B** = objectifs (drapeaux de domination A/B/C avec leur rayon de capture, sites de bombe, drapeaux CTF, QG, sabotage ; affichés par défaut, aussi sur la mini-carte)
- Mini-carte en haut à gauche : zone jouable (délimitée par les spawns) vue de dessus, ombrée par la hauteur, avec les spawns et le joueur
- Les maps sont listées sous leur nom commercial (Dome, Fallen, Bakaara…) (Espace/Ctrl = monter/descendre).
- Chargement : géométrie en quelques secondes (Web Worker), puis les textures arrivent (≈ 300 images pour `mp_dome`) ; voir « Perf » dans `RE_NOTES.md`.
- **Cache** : le résultat décodé (géométrie + textures, ces dernières par morceaux de 64 Mo car Chrome refuse les valeurs IndexedDB de plus de ~127 Mo) est gardé dans IndexedDB, avec une clé qui dépend du `.ff` et de l'ensemble des `.iwd` ; les versions précédentes sont purgées. Incrémenter `CACHE_VERSION` (`packages/viewer/src/worker/cache.ts`) quand l'extraction change.
- Les textures sont lues dans `main/*.iwd` du dossier choisi (ou `inputs/main/` avec `?dev=`).

### Sur le PC de test (Windows, `ssh pc`)

Clone dans `C:\Users\Lilyan\mwthree` (avec `inputs/` : `main/*.iwd` et les 16 `zone/<map>/mp_<map>.ff`, sans `dlc`). Serveur : `ssh pc "cd mwthree\packages\viewer && npx vite --host 0.0.0.0 --port 5173"` lancé lui aussi via `Invoke-CimMethod Win32_Process Create` pour survivre à la session SSH (log dans `C:\Users\Lilyan\vite.log`),
ouvert depuis le Mac sur `http://192.168.1.207:5173/?dev=dome&free=1`. Playwright tourne sur le PC (vrai GPU, fps représentatifs) ;
lancer `playwright-cli -s=mw3 open …` via `Invoke-CimMethod Win32_Process Create`, sinon le navigateur meurt avec la session SSH.
Premier chargement de `mp_dome` mesuré sur le PC (dev) : décompression 947 ms, lecture 342 ms, textures 925 ms ; 60 fps (vsync).

## Vérifier le loader

```bash
npx tsx scripts/loadZone.mts inputs/zone/dome/mp_dome.ff   # bytesRead == taille zone, blocs simulés == en-tête
npm run test -w packages/iw5-core                            # inclut l'intégration mp_dome (ignorée sans inputs/)
npx tsx scripts/checkMaps.mts                                # passe tous les extracteurs sur les 16 maps de inputs/zone
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
  src/zone/MapExtract.ts           GfxWorld → mesh, props, matériaux ; MapEnts → entités
  src/textures/                    Iwd.ts (zip aléatoire), Iwi.ts (en-tête + mips), Dxt.ts (S3TC → RGBA)
packages/viewer/
  src/worker/mapWorker.ts          décompression + lecture + extraction hors thread UI
  src/components/WorldMesh.tsx     mesh + TrimeshCollider
  src/components/Player.tsx        capsule Rapier + PointerLockControls
packages/iw5-core/src/zone/Collision.ts  clipMap_t → mesh de collision (brushes + terrain)
packages/iw5-collision/            stub (inutilisé pour l'instant)
scripts/                           genSchema.mjs, loadZone.mts (outils de vérification)
```

## Prochaines étapes

1. **Éclairage** : lightmaps, props et brouillard suivent les formules des shaders du moteur (voir `RE_NOTES.md`). Reste : post-traitement du fichier `vision` (teintes `r_film*`, glow), « sun fog » de 5 maps, specular/normal maps du monde, traces `needsTrace` de la light grid, ombres dynamiques des props.
2. **Performance du rendu** : LOD 0/1 des props en place (−37 % de triangles sur `mp_dome`) ; pistes suivantes : LOD 2+, culling par cellule (`GfxWorld.cells`/portails) si le framerate devient un problème.
3. **Premier chargement** (≈ 11 s au total sur `mp_dome` en dev, dont ≈ 6 s de textures) : décodage paresseux des structs, ciel en cube map GPU au lieu de la conversion équirectangulaire (≈ 1,5 s). Le cache IndexedDB couvre les rechargements.

## Captures

`docs/images/screens/` : captures du viewer sur `mp_dome` (Playwright CLI, session `-s=mw3`, `?dev=dome&free=1`, fenêtre 1280×720, converties en JPEG avec `sips`). Le GIF de visite des spawns est assemblé à partir de captures successives (touche `T`) avec `gifenc` (ffmpeg n'est pas utilisable sur la machine de dev). À refaire quand le rendu change nettement.

## Décisions

- Physique Rapier3D ; fichiers locaux uniquement (File System Access API), aucun asset redistribué.
- Les structs/règles viennent d'OpenAssetTools : on ne les réécrit pas à la main, on les compile (`genSchema.mjs`).
- Repère scène : `(x, z, −y) × 0.0254` (mètres, Y haut).
