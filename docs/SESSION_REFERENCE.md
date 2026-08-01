# MW3 Explorer — Référence de Session

## Dernier état d'avancement

| Phase                          | Statut      |
| :----------------------------- | :---------- |
| Phase 0 — Fondations projet    | ✓ COMPLETE  |
| Phase 1 — Décompression FF     | ✓ COMPLETE  |
| Phase 2 — Zone loader          | ⏳ PENDING  |
| Phase 3 — Collision + FPS      | ⏳ PENDING  |
| Phase 4 — GfxWorld             | ⏳ PENDING  |
| Phase 5 — Textures IWD         | ⏳ PENDING  |
| Phase 6 — UX entités           | ⏳ PENDING  |

## Map de test

```
inputs/Call of Duty - Modern Warfare 3/zone/english/
├── mp_seatown.ff          # Format IWff0100 (72MB) ✓ decompressible
├── mp_seatown_load.ff     # FastFile de chargement IWff0100 ✓
├── mp_bootleg.ff          # Format IWff0100 ✓
├── code_pre_gfx.ff        # Format IWffu100 ✓
├── code_pre_gfx_mp.ff     # Format IWff0100 ✓
├── ... (80+ fichiers)
```

Les fichiers réels MW3 dans l'installation utilisateur (`inputs/Call of Duty - Modern Warfare 3/`) sont au format standard MW3 (`IWff0100` ou `IWffu100`) et se décompressent correctement maintenant.

`inputs/mp_seatown/` contient des fichiers **IW4x** (mod tool) qui ne sont pas standard MW3 — à traiter plus tard.

## Structure du projet

```
mwthree/
├── .opencode/instructions.md     # Instructions de session
├── docs/
│   ├── PLAN.md                   # Plan complet du projet
│   └── SESSION_REFERENCE.md      # Ce fichier
├── inputs/
│   └── mp_seatown/               # Fichiers de test (IW4x)
├── packages/
│   ├── iw5-core/                 # Parsers binaires ✓ builds + tests
│   │   ├── src/
│   │   │   ├── index.ts          # Exports publics
│   │   │   ├── FastFileLoader.ts # Décompression FF (IWff0100 ✓, IWffu100 ✓, IW4x ⏳)
│   │   │   └── FastFileLoader.test.ts
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── package.json          # @mwthree/iw5-core
│   ├── iw5-collision/            # Collision Rapier3D (scaffolding)
│   │   └── src/
│   │       └── index.ts          # Stub
│   │   ├── tsconfig.json
│   │   └── package.json          # @mwthree/iw5-collision
│   └── viewer/                   # App React Three Fiber ✓ builds
│       └── src/
│           ├── App.tsx           # Scene 3D + détection MW3
│           ├── components/
│           │   ├── FolderSelector.tsx  # showDirectoryPicker()
│           │   └── FPSCamera.tsx       # WASD + souris FPS
│           ├── types.ts          # MapInfo interface
│           ├── index.css         # Styles globaux
│           └── main.tsx          # Entry point
├── package.json                  # Root workspace
├── tsconfig.base.json            # Base TS config
└── .gitignore
```

## Stack technique

| Technologie               | Usage                              | Package                           |
| :------------------------ | :--------------------------------- | :-------------------------------- |
| TypeScript + Vite         | App web                            | viewer                            |
| Three.js                  | Rendu 3D                           | three, @react-three/fiber         |
| React Three Fiber         | React ↔ Three.js                   | @react-three/fiber                |
| Drei                      | Utilitaires Three.js               | @react-three/drei                 |
| Rapier3D                  | Moteur physique                    | @dimforge/rapier3d-compat         |
| @react-three/rapier       | Pont Rapier3D ↔ R3F               | @react-three/rapier               |
| pako                      | Décompression zlib des FF (IWff0100, IWffu100) | iw5-core             |
| vitest                    | Tests unitaires                    | root (devDep)                     |
| fflate                    | Lecture .iwd (zip)                 | (à installer Phase 5)             |

## Commandes utiles

```bash
# Dev (viewer avec HMR)
npm run dev

# Build complet (iw5-core + iw5-collision + viewer)
npm run build

# Tests
npm run test -w packages/iw5-core

# Tester tous les packages
npm run test

# Typecheck tous les packages
npm run typecheck

# Lancer le viewer standalone
cd packages/viewer && npm run dev
```

## Format FastFile MW3 (IW5) — Résumé

### Structure `IWff0100` (Signed)
```
Offset 0:     IWff0100        (8 bytes magic)
Offset 8:     version (uint32 LE)
Offset 12:    9-byte prefix   (constant structure)
Offset 21:    IWffs100        (auth header magic, 8 bytes)
Offset 29:    00 00 00 00     (reserved, 4 bytes)
Offset 33:    auth header data (total 0x4000 = 16384 bytes d'auth header)
Offset 16405: zlib stream     (zone data compressée en single stream)
```

### Structure `IWffu100` (Unsigned)
```
Offset 0:     IWffu100        (8 bytes magic)
Offset 8:     version (uint32 LE)
Offset 12:    9-byte prefix   (constant structure)
Offset 21:    zlib stream     (zone data compressée en single stream)
```

### Décompression
- `IWff0100` : `pako.inflate(data[16405:])` → zone buffer
- `IWffu100` : `pako.inflate(data[21:])` → zone buffer

## Problèmes ouverts

- `inputs/mp_seatown/mp_seatown.ff` est en format **IW4x** (magic "IW4x", version 3). 
  À traiter séparément.
- Le zone buffer décompressé est au format XFile (avec block sizes etc.) — c'est le travail de Phase 2.
- Les gros fichiers (72MB+) peuvent prendre plusieurs secondes à décompresser. Option Web Worker à envisager.
- `iw5-collision` est un squelette vide. La vraie implémentation commence en Phase 3.

## Décisions clés

- **Physique :** Rapier3D plutôt que collision custom sur clipMap_t
- **Navigation :** FPS controller WASD + souris (Phase 0 basique, Phase 3 avec Rapier3D)
- **Fichiers locaux :** Uniquement File System Access API, zéro upload
- **Monorepo :** npm workspaces avec packages séparés
- **Tests :** vitest pour iw5-core, à étendre
- **Fallback :** WASM wrapper OAT si parsing TS trop lent (Phase 2)
