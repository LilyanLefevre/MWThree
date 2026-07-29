# Reverse Engineering Notes — IW5 (MW3) Zone Format

> **Règle :** Chaque découverte de RE doit être documentée ici immédiatement.
> Ne jamais supposer qu'on s'en souviendra à la prochaine session.

---

## 1. Fichier FastFile Signé (IWff0100)

### Structure physique

```
Offset 0:      IWff0100          (8 bytes magic)
Offset 8:      version (uint32 LE, = 1)
Offset 12:     9-byte prefix     (constant)
Offset 21:     IWffs100          (auth header magic, 8 bytes)
Offset 29:     00 00 00 00      (reserved, 4 bytes)
Offset 33:     auth header data  (0x4000 = 16384 bytes)
Offset 16405:  zlib stream       (données compressées)
```

### Décompression Signed

Pour les signed zones, NE PAS décompresser directement `data[16405:]`.
Les hash chunks (SHA-256) sont entrelacés avec les data chunks :

```
Group : [hash_chunk(1×0x2000)] [data_chunks(256×0x2000)]
         hash_chunk = 0x2000B bytes (hash + padding/size)
         data_chunk = 0x2000 à 0x2000B bytes
         → data utile = data_chunk[1:] (0x2000A max)
```

Algorithme :
1. Skip auth header (16405 bytes from start)
2. Lire en boucle : pour chaque groupe, skip 1 chunk (hash), collecter 256 chunks (data)
3. Concaténer tous les data chunks
4. `pako.inflate(concat)` → zone buffer

**Testé sur :** mp_dome.ff, mp_dome_load.ff, so_survival_mp_dome.ff, patch_*.ff ✓

---

## 2. Structure de la Zone Décompressée

```
+0x0000 : XFile header (44 bytes)
  └ size (uint32)         — taille totale sans le header
  └ externalSize (uint32)
  └ blockSizes (9×uint32) — TEMP, PHYSICAL, RUNTIME, VIRTUAL, LARGE, CALLBACK, VERTEX, INDEX, SCRIPT

+0x002C : XAssetList
  └ stringCount (uint32)
  └ stringsPtr (uint32)           — POINTER_FOLLOWING si suite inline
  └ assetCount (uint32)
  └ assetsPtr (uint32)            — POINTER_FOLLOWING si suite inline

+0x003C : Script string pointers (stringCount × uint32)
          Chaque pointeur = POINTER_FOLLOWING (0xFFFFFFFF) → string null-terminated suite inline
                           | 0 → null
                           | autre → block-referenced

+...    : Script string data (strings null-terminated)

+...    : Asset entry array (assetCount × 8 bytes)
          Chaque entrée = rawType (uint32) + pointer (uint32)
          pointer = POINTER_FOLLOWING (0xFFFFFFFF) → asset data suite inline
                   | 0 → null
                   | autre → block-referenced

assetDataStart (= stream.tell() après le tableau d'assets)
```

### Block ordering (header → decompressed buffer)

Dans l'ordre du header (seuls les blocs avec size > 0 sont présents) :

```
  #0  TEMP     4,195,008  (4.0 MB)
  #1  PHYSICAL (absent)
  #2  RUNTIME    524,800  (0.5 MB)
  #3  VIRTUAL 38,451,167  (36.7 MB)
  #4  LARGE    (absent)
  #5  CALLBACK (absent)
  #6  VERTEX  19,968,448  (19.0 MB)
  #7  INDEX    3,170,636  (3.0 MB)
  #8  SCRIPT     16,640   (0.0 MB)
  Total      66,326,699   (63.3 MB)
```

**blockStart = decompressed.length - totalBlockSizes**

Pour mp_dome.ff :
- decompressed = 106,171,404 bytes
- totalBlocks = 66,326,699 bytes
- blockStart = 0x25FFB61 (= 39,844,705)
- inline data region = 0x0 → 0x25FFB61 (39,844,705 bytes)
- asset data start = 0x4062 (= 16,482)
- asset data region = 0x4062 → 0x25FFB61 (39,828,223 bytes)

---

## 3. Encodage des Pointeurs (OAT Confirmé)

### POINTER_FOLLOWING et INSERT

| Valeur (32-bit) | Nom | Signification |
|:----------------|:----|:--------------|
| `0x00000000` | NULL | null pointer |
| `0xFFFFFFFF` | POINTER_FOLLOWING | Donnée suit inline dans le stream |
| `0xFFFFFFFE` | POINTER_INSERT | Sera patché via alias lookup |
| autre | OFFSET | Encodage `(blockIdx << 28) \| (offset & 0x0FFFFFFF) + 1` |

### Block-referenced pointers (FORMULE OAT)

OAT `ConvertOffsetToPointerNative`:

```
offsetInt   = encodedPtr - 1
blockIndex  = (offsetInt >>> 28) & 0xF    — top nibble = block index
blockOffset = offsetInt & 0x0FFFFFFF      — lower 28 bits = block offset
actualData  = blocks[blockIndex].buffer + blockOffset
```

**Décodage inverse pour écrire un pointeur** :
```
encodedPtr = (blockIndex << 28) | (blockOffset & 0x0FFFFFFF) + 1
```

**Vérifié expérimentalement** :
- `maps/mp/mp_dome.d3dbsp` @ VIRTUAL+0x8704D3 → ptr = `0x308704D4` (block=3) ✓
- `mc/mtl_brush_toujanebigbushy` @ TEMP+0x6D730 → ptr = `0x006D731` (block=0) ✓
- RAWFILE entry 305 dataPtr `0x00010300` → TEMP+0x10300 (631KB) ✓

**ATTENTION :** Le `+1` dans l'encodage sert à distinguer `nullptr` (0) du vrai
offset 0 (qui s'encoderait 1). Pour le décodage : soustraire 1 PUIS extraire
block index et offset.

### XString name pointers — NON RÉSOLU

Les champs `const char* name` dans les structures inline (ex: GlassWorld offset 0,
RawFile offset 0) utilisent ce même format de pointeur 32-bit. Cependant,
les valeurs rencontrées (ex: `0x001FE00F`, `0x000480E4`) ne se résolvent PAS
en strings valides dans les blocks via la formule OAT.

**Hypothèse :** Les `const char*` fields pourraient utiliser l'indexation
ScriptString (`scr_string_t = uint16_t` dans OAT ZoneTypes.h) plutôt que
le format de pointeur brut. Les ScriptStrings sont la table de 513 strings
chargée depuis l'en-tête de la zone. La résolution nécessiterait de
comprendre comment la valeur 32-bit du champ `name` se mappe à un
index ScriptString.

### Données textes trouvées dans les blocks

Les strings de type chemin/asset existent BIEN dans les blocks :

| Block | Contenu trouvé |
|:------|:---------------|
| TEMP | `mc/mtl_brush_*` (material names), etc. |
| VIRTUAL | `maps/mp/mp_dome.d3dbsp`, `maps/mp/mp_dome_fx.gsc`, etc. |
| RUNTIME | `mc/mtl_*` material names |

**Aucune string de type raw/maps/code trouvée dans la région inline**
(avant blockStart). La seule string de chemin dans l'inline est
`maps/mp/mp_dome.d3dbsp` à 0x7227EA, précédée de POINTER_FOLLOWING.

---

## 4. Asset Entries — Types et Headers

### Type mapping (iw5-core ZoneParser)

```
 0: PHYSPRESET          9: TECHNIQUE_SET      18: VEHICLE_TRACK
 1: PHYSCOLLMAP        10: IMAGE              19: MAP_ENTS
 2: XANIMPARTS         11: SOUND              20: FXWORLD
 3: XMODEL_SURFS       12: SOUND_CURVE        21: GFXWORLD
 4: XMODEL             13: LOADED_SOUND       22: LIGHT_DEF
 5: MATERIAL           14: CLIPMAP            23-30: ...
 6: PIXELSHADER        15: COMWORLD           31: FX
 7: VERTEXSHADER       16: GLASSWORLD         38: RAWFILE
 8: VERTEXDECL         17: PATHDATA           39: SCRIPTFILE
                                              40: STRINGTABLE
```

### Header sizes (zone format) par type

Ces tailles sont calculées à partir des structures OAT `IW5_Assets.h`.
La taille "zone format" inclut tous les champs fixes lus séquentiellement
depuis le stream (pointeurs, ints, shorts, chars), MAIS PAS les données
variables qui suivent inline (arrays countés sans `set block`).

```
  0: 72   1: 72   2: 88   3: 36   4: 308   5: 100 ← OAT
  6: 16   7: 16   8: 100  9: 228  10: 32   11: 12
 12: 136  13: 44  14: 264  ← OAT   15: 16   16: 8
 17: 44   18: 12  19: 112 20: 124  21: 636  22: 24
 23: 24   24: 24  25: 12  26: 176  27: 8    28: 164
 29: 200  30: 0   31: 52  32: 8    33: 8    34: 8
 35: 8    36: 8   37: 8   38: 12   39: 24   ← OAT 40: 16
 41: 28   42: 12  43: 120 44: 700  45: 60
```

**IMPORTANT :** Les tailles OAT (annotées `← OAT`) diffèrent pour certains types.
Exemples :
- **MATERIAL (5) :** j'avais 104, OAT donne 100 (différence de 4 bytes)
- **CLIPMAP (14) :** j'avais 256, OAT donne 264
- **SCRIPTFILE (39) :** j'avais 16, OAT donne 24 (4e champ `bytecodeLen`)
- **STRINGTABLE (40) :** 16 confirmé (name + columnCount + rowCount + values*)

⚠️ **NB :** Les données variables suivant le header (ex: buffer de RawFile,
cell values de StringTable) ne sont PAS incluses dans ces tailles.
La consommation stream réelle = header + name string (si POINTER_FOLLOWING)
+ données variables de chaque champ POINTER_FOLLOWING ou counted array inline.

### Distribution des types (mp_dome.ff, 792 assets)

```
type  9 (TECHNIQUE_SET) : 330
type 11 (SOUND)          : 213
type  4 (XMODEL)         : 86
type 31 (FX)             : 83
type 39 (SCRIPTFILE)     : 23
type  2 (XANIMPARTS)     : 16
type 40 (STRINGTABLE)    : 16
type  5 (MATERIAL)       : 12
type 38 (RAWFILE)        : 6
type 14 (CLIPMAP)        : 1
type 15 (COMWORLD)       : 1
type 16 (GLASSWORLD)     : 1
type 20 (FXWORLD)        : 1
type 21 (GFXWORLD)       : 1
type 22 (LIGHT_DEF)      : 1
type 32 (IMPACT_FX)      : 1
```

---

## 5. STRINGTABLE (type 40) — Loader vérifié

### Format

```c
struct StringTable {
    XString name;           // nom du fichier CSV, suit inline si POINTER_FOLLOWING
    int columnCount;        // colonnes
    int rowCount;           // lignes
    StringTableValue *values;  // pointeur vers cell pointer array
};

// Cell pointer array: columnCount × rowCount × { ptr (uint32), hash (uint32) }
// ptr = POINTER_FOLLOWING → string suit inline à followingOffset
//     | 0 → null
//     | 0xFFFFXXXX → string at offset stringDataStart + (ptr & 0xFFFF)
//     | (blockIndex << 28) | offset → string dans un bloc
```

### Consommation
- Header: 16 bytes
- Name: si POINTER_FOLLOWING → string null-terminated après le struct
- Cell pointers: columnCount × rowCount × 8 bytes
- Cell string data: toutes les strings des cellules

**16 STRINGTABLEs consomment 557,106 bytes** (de 0x4062 à 0x8C094)
pour mp_dome.ff (1945 configstrings × 2 colonnes par table).

---

## 6. Technique de Position Tracking

### Approche correcte

Pour tracker la position dans le flux inline :

```ts
function entrySize(entry, pos): number {
    const hdr = HEADER_SIZES[entry.rawType] ?? 4;
    const namePtr = view.getUint32(pos);
    if (namePtr === POINTER_FOLLOWING) {
        // name suit APRÈS le struct body
        let p = pos + hdr;
        while (view.getUint8(p) !== 0) p++;
        return hdr + (p - (pos + hdr)) + 1;  // +1 pour null
    }
    return hdr;
}
```

**Ne PAS utiliser skipAsset()** de AssetLoaders — il ne lit que 4 bytes + name
(ne skip pas le struct body complet), ce qui casse le tracking.

### Piège : 0xFFFFFFFF = POINTER_FOLLOWING vs -1 (data value)

Dans les structs, `0xFFFFFFFF` peut être :
- Un **POINTER_FOLLOWING** → la donnée suit inline → augmente la consommation
- Un **int -1** (donnée) → ne change pas la consommation

Le type TECHNIQUE_SET (type 9, hdr=228) a 39 champs à `0xFFFFFFFF`
MAIS ce sont des valeurs de données (flags, indices), PAS des pointers.
Ne pas ajouter de following data pour TECHNIQUE_SET.

### Pattern matching pour trouver des positions

Pour trouver une entrée spécifique dans le flux inline,
on peut chercher une **séquence de name pointers** consécutifs :

```js
const seq = [
  { type: 16, hdr: 8,  namePtr: 0x001fe00f },  // entry 300
  { type: 14, hdr: 256, namePtr: 0x00018000 },  // entry 301
  { type: 39, hdr: 16,  namePtr: 0x000490e4 },  // entry 302
  // ... etc
];
// Chaque entrée est à offset = début_sequence + sum(headerSizes précédents)
```

Cette technique a permis de trouver **entry 300-312** à `0xE94F6`
(à 315,356 bytes après GFXWORLD header).

---

## 7. Entrées Complexes avec Following Data

### GFXWORLD (type 21)

- Header: 636 bytes
- Name: block-referenced (POINTER_FOLLOWING? Vérifié: non, block ref)
- **Following data mesurée : 315,356 bytes** (de 0x9C51A à 0xE94F6)
- Contient des champs POINTER_FOLLOWING aux offsets +52 et +64
  (probablement `dpvsTree` et `draw`)

### FXWORLD (type 20)

- Header: 116 bytes
- Following data : NON MESURÉ

### Autres types complexes potentiels

- CLIPMAP (type 14, hdr=256)
- MAP_ENTS (type 15, hdr=16)
- COMWORLD (type 15, hdr=12)
- VEHICLE_TRACK (type 14, hdr=256)

---

## 8. Entrées 300-312 (Section SCRIPTFILE/RAWFILE)

**Position trouvée par pattern matching :** `0xE94F6`

### SCRIPTFILE (type 39) — struct 16 bytes

```c
struct ScriptFile {
    XString name;           // block-referenced
    int compressedLen;
    int len;
    XString bytecode;       // block-referenced
};
```

### RAWFILE (type 38) — struct 12 bytes

```c
struct RawFile {
    XString name;           // block-referenced
    int len;
    XString data;           // block-referenced
};
```

### Entry 305 (RAWFILE) — données vérifiées

```
Pos:       0xE962E
namePtr:   0x000480e4 (block 0 = TEMP, offset 0x480e4)
len:       631,012 bytes
dataPtr:   0x00010300 (block 0 = TEMP, offset 0x10300)
Data at:   TEMP_start + 0x10300 = 0x260FE61
Data type: binaire (~35% printable ASCII)
```

---

## 9. Problèmes Ouverts

### A. Encodage pool-based des pointeurs

Les valeurs comme `0x0d800400` (MATERIAL struct, top nibble = 0xD)
n'ont pas de bloc correspondant (max index 8 = SCRIPT).
→ Probablement un encodage pool-based différent.
→ Nécessite les adresses mémoire game (pool base addresses).

### B. Résolution des XString block-referenced

`namePtr = 0x000480e4` dans TEMP+0x480e4 donne `0x00...` (string vide).
Aucun offset testé (start, end, autres blocks) ne donne de string lisible.
→ Encodage non standard pour signed zones ?
→ Double indirection (pointeur vers pointeur) ?

### C. 38.8 MB de following data non trackée

Après GFXWORLD (315,356 bytes de following) et entries 300-791,
il reste 38,842,709 bytes de following data non allouée (de 0xF4A0C à 0x25FFB61).
→ Probablement le following data d'autres entrées complexes (FXWORLD, etc.)
→ Impossible à tracker sans définitions de struct complètes.

### D. Ordre des blocs en mémoire game

Les blocs sont contigus dans le buffer décompressé, mais leur ordre
en mémoire game (adresses de base) est inconnu.
→ Nécessite RE du loader IW5 ou référence OAT.

---

## 10. Faits Vérifiés

| Fait | Valeur |
|:-----|:-------|
| Taille décompressée mp_dome.ff | 106,171,404 bytes |
| Header XFile | 44 bytes |
| assetDataStart | 0x4062 (16,482) |
| blockStart (début blocks) | 0x25FFB61 (39,844,705) |
| Total block data | 66,326,699 bytes |
| STRINGTABLE total | 557,106 bytes (0x4062 → 0x8C094) |
| GFXWORLD entry 299 | 0x9C29E |
| GFXWORLD following data | 315,356 bytes |
| Entry 300 start | 0xE94F6 |
| Entry 305 (RAWFILE) | 0xE962E |
| RAWFILE 305 data | TEMP+0x10300, 631KB binaire |
| Pointeurs tous POINTER_FOLLOWING | Oui (792/792 entries) |
| stringCount | 513 |
| assetCount | 792 |

---

## 11. Règles de Code

1. **Toujours vérifier les deux côtés** : la valeur `0xFFFFFFFF` peut être
   POINTER_FOLLOWING ou un int -1 selon le contexte (champ pointer vs data).
2. **skipAsset est buggé** pour le tracking de position — il ne lit que 4 bytes
   du struct body. Utiliser `headerSize + optionalName` à la place.
3. **Ne PAS chercher des strings** dans les blocks avec des offsets bruts —
   l'encodage des XString block-referenced n'est pas encore compris.
4. **Documenter TOUTE nouvelle découverte** ici immédiatement.
5. **Tester les changements** avec `npm run test -w packages/iw5-core`.
