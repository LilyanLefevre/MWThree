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
├── mp_seatown.ff        # FastFile principal
├── mp_seatown_load.ff   # FastFile de chargement
├── mp_seatown.iwd       # Archive textures/sons
└── mp_seatown.arena     # Configuration de map
```

Utiliser `inputs/mp_seatown/mp_seatown.ff` comme fichier de référence
pour valider chaque phase.

## Structure du projet

```
mwthree/
├── ai/                   # Documents de cadrage (ce fichier + PLAN.md)
├── inputs/               # Fichiers de test (mp_seatown/)
├── packages/
│   ├── iw5-core/         # Parsers binaires (FF, zone, assets)
│   │   └── src/
│   │       └── FastFileLoader.ts  # Phase 1 en cours
│   ├── iw5-collision/    # clipMap_t → colliders Rapier3D (Phase 3)
│   └── viewer/           # App React Three Fiber
│       └── src/
│           ├── App.tsx               # Scene 3D + sélecteur dossier
│           ├── components/
│           │   └── FolderSelector.tsx  # showDirectoryPicker()
│           └── index.css             # Styles globaux
├── docs/                 # Notes RE, layouts structs
├── package.json          # Workspace root
└── tsconfig.base.json    # Base TS config
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
| fflate                    | Lecture .iwd (zip)                 | (à installer Phase 5)             |

## Commandes utiles

```bash
# Lancer l'app viewer en dev
cd packages/viewer && npm run dev

# Installer deps dans un package
npm install <pkg> --workspace=<workspace-name>

# Build viewer
npm run build --workspace=packages/viewer
```

## Architecture

```
Installation MW3 locale
  ↓ [File System Access API]
Sélecteur dossier → Détection zone/*.ff + main/*.iwd
  ↓
FastFileLoader (Phase 1) — décompresse .ff → zone brute
  ↓
ZoneParser + PointerResolver (Phase 2) — parse XFile → assets
  ↓
AssetParsers (Phase 2-5) — clipMap_t, GfxWorld, XModel, Material, Image
  ↓                          ↓
Rapier3D Collision (Ph3)    Three.js Renderer (Ph4-5)
  ↓                          ↓
FPS Controller (Ph3)        UI React R3F (Ph6)
```

## Décisions clés

*   **Physique :** Rapier3D plutôt que collision custom sur clipMap_t
*   **Navigation :** FPS controller WASD + souris avec Rapier3D
*   **Fichiers locaux :** Uniquement File System Access API, zéro upload
*   **Monorepo :** packages séparés (iw5-core, iw5-collision, viewer)
*   **Fallback :** WASM wrapper OAT si parsing TS trop lent (Phase 2)
