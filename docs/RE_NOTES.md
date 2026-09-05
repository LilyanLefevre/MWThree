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

### Light grid (`GfxWorld.lightGrid`) — décodage partiel, non utilisé

Sondes de lumière du moteur pour les objets dynamiques/props. Observé sur `mp_dome` :
- `mins` / `maxs` en coordonnées de grille : x 3830–4266, y 3924–4381, z 2040–2070. Hypothèse cohérente avec la map :
  cellule = `floor(x / 32) + 4096`, `floor(y / 32) + 4096`, `floor(z / 64) + 2048` (couvre aussi les palettes d'airdrop à x ≈ −8256).
- `rowAxis = 0`, `colAxis = 1` ; `rowDataStart[r]` (une entrée par rangée x, `0xFFFF` = rangée vide) est un offset **en mots de 4 octets** dans `rawRowData`.
- En-tête de rangée (12 octets) : `colStart u16`, `colCount u16`, `zStart u16`, `zCount u16`, `firstEntry u32` (absolus), suivi de
  **runs de colonnes** : `cols u8`, `numZ u8`, puis `zOffset u8` seulement si `numZ > 0`. Chaque colonne d'un run a `numZ` entrées
  consécutives à partir de `z = zStart + zOffset`. **Vérifié** : sur toutes les rangées de `mp_dome`, Σ cols = `colCount` et
  Σ cols × numZ = `firstEntry` de la rangée suivante − `firstEntry` (ex. rangée 282 : 162 colonnes, 1 384 entrées).
- `entries[i]` = `{ colorsIndex, primaryLightIndex, needsTrace }` ; `colors[k].rgb[56][3]` = 56 échantillons RGB par sonde
  (valeurs lisses, plausibles : sonde au soleil ≈ 146 126 100).
- **Non résolu** : en prenant la sonde de la cellule de chaque prop (taille 32/32/64 + décalage 4096/4096/2048, ordre colonne- ou
  z-majeur), la luminosité moyenne obtenue ne corrèle pas (r ≈ 0) avec le lightmap du sol sous le prop. Soit la conversion
  position → cellule est fausse, soit les 56 échantillons ne sont pas une simple irradiance. Les props restent donc éclairés par le
  lightmap du sol sous eux (`computePropLighting`).

## 5. Perf (machine de dev lente, Chrome)

`mp_dome` (premier chargement, en dev) : décompression ≈ 3 s (zlib natif), lecture de la zone ≈ 1,5–2 s, textures ≈ 6 s
(requêtes HTTP Range + inflate natif, images S3TC envoyées compressées au GPU). Rechargement depuis le cache IndexedDB ≈ 2,5 s.
Essayés sans gain : fflate, pool de workers pour les textures.

## 6. Règles de code

1. Ne jamais deviner une taille de struct : régénérer le schéma et lancer `npx tsx scripts/loadZone.mts <zone.ff>` — doit afficher
   `bytesRead == taille de la zone` et des blocs simulés == blocs de l'en-tête (TEMP exclu).
2. Documenter ici toute nouvelle divergence entre le header OAT et les fichiers retail.
3. Tests : `npm run test -w packages/iw5-core` (l'intégration est ignorée si `inputs/` est absent).
