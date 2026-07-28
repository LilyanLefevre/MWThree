# MW3 Explorer — Référence de Session

## Dernier état d'avancement

| Phase                          | Statut      |
| :----------------------------- | :---------- |
| Phase 0 — Fondations projet    | ✓ COMPLETE  |
| Phase 1 — Décompression FF     | EN COURS    |
| Phase 2 — Zone loader          | ⏳ PENDING  |
| Phase 3 — Collision + FPS      | ⏳ PENDING  |
| Phase 4 — GfxWorld             | ⏳ PENDING  |
| Phase 5 — Textures IWD         | ⏳ PENDING  |
| Phase 6 — UX entités           | ⏳ PENDING  |

## Map de test

```
inputs/mp_seatown/
├── mp_seatown.ff        # Format IW4x (magic: IW4x, version 3)
├── mp_seatown_load.ff   # FastFile de chargement
├── mp_seatown.iwd       # Archive textures/sons
└── mp_seatown.arena     # Configuration de map
```

**Note :** `mp_seatown.ff` est au format **IW4x** (pas IWff0100 standard MW3).
Le support IW4x nécessite plus de RE → sera traité en Phase 1.
Pour l'instant, les tests utilisent un fichier synthétique IWff0100.

## Structure du projet

```
mwthree/
├── .opencode/instructions.md     # Instructions de session
├── ai/
│   ├── PLAN.md                   # Plan complet du projet
│   └── SESSION_REFERENCE.md      # Ce fichier
├── inputs/
│   └── mp_seatown/               # Fichiers de test (IW4x)
├── packages/
│   ├── iw5-core/                 # Parsers binaires ✓ builds + tests
│   │   ├── src/
│   │   │   ├── index.ts          # Exports publics
│   │   │   ├── FastFileLoader.ts # Décompression FF (IWff0100 ok, IW4x partiel)
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
├── docs/
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
| pako                      | Décompression zlib des FF          | iw5-core                          |
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

## Problèmes ouverts

- `inputs/mp_seatown/mp_seatown.ff` est en format **IW4x** (magic "IW4x", version 3). 
  Le format de compression n'est pas standard MW3. À analyser en Phase 1.
- `iw5-collision` est un squelette vide. La vraie implémentation commence en Phase 3.

## Décisions clés

- **Physique :** Rapier3D plutôt que collision custom sur clipMap_t
- **Navigation :** FPS controller WASD + souris (Phase 0 basique, Phase 3 avec Rapier3D)
- **Fichiers locaux :** Uniquement File System Access API, zéro upload
- **Monorepo :** npm workspaces avec packages séparés
- **Tests :** vitest pour iw5-core, à étendre
- **Fallback :** WASM wrapper OAT si parsing TS trop lent (Phase 2)
