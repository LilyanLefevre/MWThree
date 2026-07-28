# MWThree — Explorateur MW3 jouable dans le navigateur

Reconstruit un Call of Duty MW3 (2011) jouable dans le navigateur en parsant les fichiers de jeu originaux.

⚠️ **Usage strictement local** — aucun asset n'est redistribué. L'utilisateur doit pointer vers sa propre installation MW3.

---

## Prérequis

- **Node.js** >= 20
- **Navigateur** : Chrome ou Edge (nécessaire pour l'API `showDirectoryPicker`)
- **Installation MW3 locale** : pour tester avec les vrais fichiers

---

## Structure du projet

```
mwthree/
├── docs/                    # Documentation et plan
│   ├── PLAN.md              # Plan complet du projet
│   └── SESSION_REFERENCE.md # Référence pour les sessions de dev
├── inputs/                  # Fichiers de test
│   └── mp_seatown/          # Map de test (format IW4x)
├── packages/
│   ├── iw5-core/            # Parsers binaires (FastFile, zone, assets)
│   ├── iw5-collision/       # ClipMap → Colliders Rapier3D
│   └── viewer/              # App React Three Fiber
├── .opencode/               # Configuration opencode (IA)
├── package.json             # Root workspace
└── tsconfig.base.json       # Configuration TypeScript de base
```

---

## Commandes

### Lancer le viewer (développement)

```bash
npm run dev
```

Ouvre un navigateur sur `http://localhost:5173` avec :
- Scene 3D de test (boîte + sol)
- Contrôles FPS : clic sur le canvas → WASD + souris + ESPACE
- Bouton **"Select MW3 Game Folder"** pour charger une installation MW3
- HUD affichant les maps et archives détectées

### Build complet (tous les packages)

```bash
npm run build
```

Construit dans l'ordre :
1. `@mwthree/iw5-core` → `packages/iw5-core/dist/`
2. `@mwthree/iw5-collision` → `packages/iw5-collision/dist/`
3. `viewer` → `packages/viewer/dist/`

### Lancer les tests

```bash
# Tous les tests
npm run test

# Tests d'un package spécifique
npm run test -w packages/iw5-core
npm run test -w packages/iw5-core -- --watch    # mode watch
```

### Vérifier le typage

```bash
npm run typecheck
```

### Linter

```bash
npm run lint
```

### Builder un package spécifique

```bash
npm run build -w packages/iw5-core
npm run build -w packages/iw5-collision
npm run build -w packages/viewer
```

### Installer une dépendance dans un package

```bash
npm install <pkg> -w packages/viewer          # dépendance runtime
npm install --save-dev <pkg> -w packages/viewer  # dépendance dev
```

---

## Développement

```bash
# 1. Cloner
git clone https://github.com/LilyanLefevre/MWThree.git
cd MWThree

# 2. Installer les dépendances
npm install

# 3. Vérifier que tout build
npm run build

# 4. Lancer le viewer
npm run dev

# 5. Sélectionner un dossier MW3 via l'interface
#    (ou utiliser inputs/mp_seatown/ pour les tests)
```

---

## Fichiers de test

Le dossier `inputs/mp_seatown/` contient une map de test :

| Fichier | Taille | Format | Usage |
| :------ | :----- | :----- | :---- |
| `mp_seatown.ff` | 25 MB | IW4x | FastFile principal |
| `mp_seatown_load.ff` | 792 B | IW4x | FastFile de chargement |
| `mp_seatown.iwd` | 70 MB | ZIP | Textures et sons |
| `mp_seatown.arena` | 258 B | texte | Configuration de map |

Ces fichiers proviennent d'une installation MW3 locale. Le format est **IW4x**
(magic `IW4x`, version 3), une variante du format standard MW3 (`IWff0100`).

---

## État d'avancement

| Phase | Statut |
| :---- | :----- |
| 0 — Fondations (monorepo, scene 3D, FPS, dossier selector) | ✅ Terminé |
| 1 — Décompression FastFile | 🔄 En cours |
| 2 — Zone loader et résolution de pointeurs | ⏳ À faire |
| 3 — Collision et déplacement FPS (Rapier3D) | ⏳ À faire |
| 4 — Géométrie visuelle (GfxWorld, XModel) | ⏳ À faire |
| 5 — Textures et IWD | ⏳ À faire |
| 6 — Entités et UX explorateur | ⏳ À faire |

---

## Licence

MIT — code uniquement. Les assets MW3 restent la propriété d'Activision.
