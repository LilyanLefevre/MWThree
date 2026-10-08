# Reverse Engineering Notes — IW5 (MW3) FastFile / Zone

> **Règle :** toute découverte de RE se documente ici immédiatement.
> Ces notes décrivent ce qui est **vérifié sur les 16 maps `mp_*.ff` de `inputs/zone/`** :
> chaque zone est consommée jusqu'au dernier octet et les tailles de blocs simulées sont
> identiques à celles de l'en-tête XFile (`ZoneLoader.test.ts` le vérifie sur `mp_dome`).

---

## 1. FastFile (`.ff`) → zone

```
0      magic "IWff0100" (signé, retail PC) | "IWffu100" (non signé)
8      version (u32 LE)
12     9 octets de préfixe
21     [signé uniquement] "IWffs100" + 0x4000 octets d'en-tête d'authentification
16405  flux zlib (signé) | 21 : flux zlib (non signé)
```

Zones signées : le flux zlib est découpé en chunks de 0x2000 octets. Chaque groupe contient
**256 chunks de données suivis d'1 chunk de hash** (à ignorer). On concatène les chunks de
données puis on inflate (`FastFileLoader.compressedStream()`).

La zone décompressée commence par le **XFile** (44 octets) :
`size`, `externalSize`, `blockSize[9]` (TEMP, PHYSICAL, RUNTIME, VIRTUAL, LARGE, CALLBACK, VERTEX, INDEX, SCRIPT),
puis l'**XAssetList** (16 octets : `stringCount`, `strings*`, `assetCount`, `assets*`).

> Un ancien dossier `inputs/mp_seatown/` au format "IW4x" (mod) n'est pas supporté ; utiliser les zones retail `inputs/zone/<map>/`.

## 2. Modèle de chargement (miroir de OpenAssetTools)

Le flux est **séquentiel** : les structs sont lues "inline", puis, en profondeur d'abord et dans
l'ordre des membres, les données des pointeurs `FOLLOWING`. Aucun saut en avant/arrière.

Valeurs de pointeur dans le flux :

| Valeur | Sens |
|---|---|
| `0` | null |
| `0xFFFFFFFF` (FOLLOWING) | les données suivent inline |
| `0xFFFFFFFE` (INSERT) | les données suivent inline **et** un slot de 4 octets est alloué dans le bloc VIRTUAL ; les références ultérieures visent ce slot |
| autre | référence : `((bloc << 28) \| offset) + 1` vers une donnée déjà chargée |

Allocation (simulée pour résoudre les références) :
- chaque pointeur FOLLOWING alloue `count × sizeof` dans le **bloc courant** avec l'alignement du type ;
- les en-têtes d'assets sont chargés en **TEMP** (non référençable, ne s'accumule pas) puis leurs membres sont chargés dans **VIRTUAL** ;
- `set block <membre> <BLOC>` change le bloc des données d'un pointeur ; en **RUNTIME** rien n'est lu dans le fichier mais l'espace est compté ;
- les blocs VERTEX / INDEX / SCRIPT reçoivent leurs données (XSurface verts/indices, scripts).

Résolution des références :
- données `reusable` / tableaux : adresse d'allocation, ou **pointeur intérieur** (`plane`, `borders`… pointent au milieu d'un tableau → recherche par intervalle, `LoadedZone.resolveRef`) ;
- assets (types dont le bloc est TEMP) : on référence **l'adresse du pointeur qui contient l'asset** — le champ `header` de l'entrée de `XAssetList` (`base + 8·i + 4`), ou le membre pointeur de la struct où l'asset a été chargé en FOLLOWING, ou le slot INSERT ;
- les chaînes (`set string`) sont dédupliquées de la même façon ; les `const char*` sans règle sont aussi des chaînes.

Détails qui ont coûté cher :
1. `reorder:` accepte `...` = « les autres membres, dans l'ordre de déclaration ». Les membres déclarés *après* le dernier membre listé gardent leur place après le groupe (`clipMap_t` : `dynEnt*` en dernier).
2. Une règle `set count a[0] …` ne remplace pas `set block a …` : fusionner les règles `a[i]` et `a`.
3. Structs à tableau terminal de taille variable (`arraysize` : `MaterialTechnique.passArray`, `GfxImageLoadDef.data`, `XAnimPartTrans…`) : lire l'en-tête jusqu'au tableau, évaluer la taille, lire le tableau ; l'espace supplémentaire compte dans le bloc.
4. `GfxCellTree::aabbTree` a pour compte `GfxWorld::aabbTreeCounts[GfxCellTree - GfxWorld::aabbTrees]` (indice de l'élément).
5. Un pointeur de pointeurs avec `dims` (ex. `techniques[54]`) charge chaque élément à l'unité.

## 3. Schéma (structs + règles)

`packages/iw5-core/zonecode/` contient `IW5_Assets.h` et les règles `XAssets/*.txt` d'OpenAssetTools (MIT).
`scripts/genSchema.mjs` les compile en `src/generated/iw5Schema.json` (structs, offsets, tailles, enums, règles) ;
les tailles sont vérifiées contre les `static_assert(sizeof…)` du header. L'interpréteur (`src/zone/ZoneLoader.ts`)
n'a aucune connaissance en dur des assets : il lit ce JSON.

Ordre des types d'assets : `PHYSPRESET, PHYSCOLLMAP, XANIMPARTS, XMODEL_SURFS, XMODEL, MATERIAL, PIXELSHADER, VERTEXSHADER,
VERTEXDECL, TECHNIQUE_SET, IMAGE, SOUND, SOUND_CURVE, LOADED_SOUND, CLIPMAP, COMWORLD, GLASSWORLD, PATHDATA, VEHICLE_TRACK,
MAP_ENTS, FXWORLD, GFXWORLD, LIGHT_DEF, UI_MAP(23, absent), FONT, MENULIST, MENU, LOCALIZE, ATTACHMENT, WEAPON,
SNDDRIVER(30, absent), FX, IMPACT_FX, SURFACE_FX, 34-37 absents, RAWFILE(38), SCRIPTFILE, STRINGTABLE(40), LEADERBOARD,
STRUCTURED_DATA_DEF, TRACER, VEHICLE, ADDON_MAP_ENTS(45)`.

## 4. Contenu d'une zone de map multijoueur (mp_dome)

792 assets listés : 330 `MaterialTechniqueSet`, 213 `snd_alias_list_t`, 86 `XModel`, 83 `FxEffectDef`, 23 `ScriptFile`,
16 `StringTable`, 16 `XAnimParts`, 12 `Material`, 6 `RawFile`, et 1 de chacun : `ComWorld`, `FxWorld`, `GfxLightDef`,
**`GfxWorld`**, `GlassWorld`, **`clipMap_t`**, `FxImpactTable`. Les images, la plupart des matériaux, shaders, `XModelSurfs`,
`MapEnts` sont chargés *inline* depuis d'autres assets (le `MapEnts` est celui de `clipMap_t.mapEnts`).
Les noms commençant par `,` (techsets, shaders) sont des assets « par défaut » vides.

### Entités (`MapEnts.entityString`)

Format compact : un bloc `{ … }` par entité, lignes `<id> "<valeur>"` où `id` est un index dans la table de
chaînes-constantes du moteur. Identifiés par les valeurs : `1668 classname`, `1669 origin`, `1670 model`,
`1671 spawnflags`, `1672 target`, `1673 targetname`, `1677 angles`, `11848 script_gameobjectname`, `1774 script_noteworthy`
(`ENTITY_KEYS` dans `MapExtract.ts` ; les autres ids sortent en `key_<id>`).

### GfxWorld

- `draw.vd.vertices` : `GfxWorldVertex` (44 octets : xyz, binormalSign, couleur, uv, uv lightmap, normale/tangente packées 4 octets) ;
  `draw.indices` : `u16`. Chaque `dpvs.surfaces[i].tris` = `{firstVertex, vertexCount, triCount, baseIndex}`, indices relatifs à `firstVertex`.
- Les triangles sont **dans le sens horaire** (D3D) : on échange 2 sommets pour three.js.
- Normale packée : octets `(b−127)` normalisés (le 4ᵉ octet est un facteur d'échelle ignoré après normalisation).
- Repère jeu : Z vers le haut, unités = pouces. Scène : `(x, z, −y) × 0.0254` (mètres, Y vers le haut).
- `GfxWorld` fait 640 octets ; le premier mot (`name`) est typiquement une **référence** vers une chaîne déjà chargée.

### Lightmaps (`GfxWorld.draw.lightmaps`)

Formule tirée des pixel shaders IW4 décompilés (dépôt `iw4x-community/dexilifier`, `HLSL/ps/lm_sun_fog_r0c0_sm3.hlsl`) :
```
H = secondary(u, v/2)          B = secondary(u, v/2 + 0.5)        // deux moitiés empilées
d = (H.a·4.08 − 2.08, B.a·4.064516 − 2.064516) ; k = saturate(1/√(1 + d·d))
lumière = (B.rgb·k + H.rgb)² + primary(u, v) × saturate(N·sunDir) × sunColor
couleur = (colorMap × couleurSommet)² × lumière                // gamma 2 : le moteur linéarise par le carré
```
IW5 (`mp_dome`) : primary 1024×2048 L8, secondary 512×2048 ARGB ; la disposition du primary = celle d'une moitié du secondary
agrandie ×2 (vérifié visuellement : mêmes charts, bloc vide au même endroit relatif). L'ancienne extraction échantillonnait le
secondary sur toute sa hauteur : l'ambiant venait d'une autre zone de l'atlas (fausses « taches de soleil » en intérieur).
Les props (shaders `lp_*_sun`) : `(2·texel)² + saturate(N·sunDir) × sunColor × texel.w`, texel = texture 3D 4×4×4 de la light grid
lue sur la surface du cube (`n / max|n|`), `w` = part de soleil visible.

### Brouillard et vision (RawFiles de la zone)

La zone d'une map contient en clair (RawFile, zlib si `compressedLen > 0` ; le buffer `char*` sort en `Int8Array`, à relire en
`Uint8Array` pour pako) : `maps/createart/<map>_fog.gsc` (brouillard), `vision/<map>.vision` (dvars `r_film*` : teintes de
post-traitement, glow) et `sun/<map>.sun` (sprite et flare du soleil). Le script de brouillard enchaîne des blocs
`ent = create_vision_set_fog("<nom>"); ent.startDist = …;` : le premier est celui de la map. Densité du moteur = ln 2 / halfwayDist
(`setExpFog`, KisakCOD `g_scr_main_mp.cpp`) ; le vertex shader calcule `clamp(exp(d·fogConsts.z + fogConsts.w), fogConsts.y, 1)`,
cohérent avec `z = −densité`, `w = densité·start`, `y = 1 − maxOpacity`. Valeurs `mp_dome` : start 1274, halfway 3080,
couleur (0.54, 0.63, 0.68), maxOpacity 0.51. Couleurs de sommet du monde : blanches hors décalques sur les 16 maps (vérifié).

### Light grid (`GfxWorld.lightGrid`) — décodé et utilisé pour les props

Sondes de lumière du moteur pour les modèles. La logique de lookup est reprise du renderer IW3 décompilé
(KisakCOD, `rb_light.cpp` : `R_LightGridLookup`, `R_GetLightGridSampleEntryQuad`, `R_GetLightingAtPoint`) ; elle est
identique en IW5 (`LightGrid.ts`).
- Cellule : `pos = (floor(v) + 0x20000) >> 5` en x/y, `>> 6` en z (32 × 32 × 64 unités) ; interpolation trilinéaire sur 8 coins.
- `rowDataStart[pos[rowAxis] − mins[rowAxis]]` (`0xFFFF` = rangée vide) = offset **en mots de 4 octets** dans `rawRowData`.
- En-tête de rangée (12 octets) : `colStart u16`, `colCount u16`, `zStart u16`, `zCount u16`, `firstEntry u32`, puis des
  **runs** `cols u8`, `numZ u8`, et si `numZ > 0` un `baseZ` sur 1 octet (2 si `zCount > 255`). Chaque colonne d'un run a `numZ`
  entrées à partir de `z = zStart + baseZ`. Vérifié : Σ cols = `colCount`, Σ cols × numZ = écart des `firstEntry`.
- `entries[i]` (4 octets) = `colorsIndex u16`, `primaryLightIndex u8`, `needsTrace u8` (bits par coin : vérifier la visibilité
  par un trace, ignoré ici).
- **Le soleil n'est pas dans les couleurs.** `primaryLightIndex == lastSunPrimaryLightIndex` (ou 255) signifie « ce coin voit le
  soleil », 0 « à l'ombre » ; le moteur ajoute `sunColor × poids × 0,5` à l'ambiant. C'est pour ça que la moyenne des couleurs
  ne corrélait pas avec le lightmap du sol (essai précédent, r ≈ 0).
- `colors[k].rgb[56][3]` : la **surface d'un cube 4×4×4** (64 − 8 cellules intérieures), envoyée au GPU comme texture 3D
  (`R_SetLightGridColors`, les 8 cellules intérieures recopient des coins). Axes vérifiés sur `mp_dome` (sondes au soleil) :
  tranche = z (tranche 3 = +z, la plus bleue : le ciel), rangée = y, colonne = x, indice 0 = côté négatif ; les faces
  opposées au soleil sont les plus claires (elles voient les murs éclairés).
- Hors grille : le moteur prend `colors[1]` (ou `colors[0]` sous la grille) et considère le point au soleil.
- Validation : 99 % des props de `mp_dome` ont une sonde ; la carte « soleil » vue de dessus reproduit l'ombre du dôme et des bâtiments.

## 5. Perf (machine de dev lente, Chrome)

`mp_dome` (premier chargement, en dev) : décompression ≈ 3 s (zlib natif), lecture de la zone ≈ 1,5–2 s, textures ≈ 6 s
(requêtes HTTP Range + inflate natif, images S3TC envoyées compressées au GPU). Rechargement depuis le cache IndexedDB ≈ 2,5 s.
Essayés sans gain : fflate, pool de workers pour les textures.

## 6. Règles de code

1. Ne jamais deviner une taille de struct : régénérer le schéma et lancer `npx tsx scripts/loadZone.mts <zone.ff>` — doit afficher
   `bytesRead == taille de la zone` et des blocs simulés == blocs de l'en-tête (TEMP exclu).
2. Documenter ici toute nouvelle divergence entre le header OAT et les fichiers retail.
3. Tests : `npm run test -w packages/iw5-core` (l'intégration est ignorée si `inputs/` est absent).
