# 01 — Vue d'ensemble

```mermaid
flowchart LR
    U[Dossier MW3 local] -->|File System Access API| W
    subgraph W[Web Worker]
        FF[FastFileLoader<br/>.ff → zone brute] --> ZL[ZoneLoader<br/>schéma + pointeurs]
        ZL --> EX[MapExtract<br/>mesh + entités]
    end
    EX -->|buffers transférés| V[Viewer React Three Fiber]
    V --> R[Rendu three.js]
    V --> P[Physique Rapier<br/>joueur capsule]
```

Le travail lourd (décompression, lecture de ~100 Mo de structures) se fait dans un **Web Worker** pour ne pas figer l'interface ; seuls des tableaux typés (`Float32Array`, `Uint32Array`) sont renvoyés à l'interface.

## Paquets

| Paquet | Rôle |
|---|---|
| `packages/iw5-core` | décompression des `.ff`, lecture des zones, extraction du mesh et des entités |
| `packages/viewer` | application web : worker, rendu, joueur |
| `packages/iw5-collision` | à venir : brushes `clipMap_t` → colliders |

## Le principe clé : un schéma compilé, pas du code écrit à la main

Il existe des centaines de structures d'assets (modèles, matériaux, sons…). Plutôt que de les écrire une à une, on réutilise les définitions d'**OpenAssetTools** :

```mermaid
flowchart LR
    H[IW5_Assets.h<br/>structs C] --> G
    R[XAssets/*.txt<br/>règles: count, condition, reorder…] --> G
    G[scripts/genSchema.mjs] --> J[iw5Schema.json<br/>341 structs, offsets, tailles]
    J --> I[ZoneLoader<br/>interpréteur]
```

Les tailles calculées sont vérifiées contre les `static_assert(sizeof …)` du header, et l'ensemble est validé de bout en bout : sur les 16 maps testées, la zone est lue jusqu'au dernier octet et les tailles de blocs correspondent à l'en-tête.
