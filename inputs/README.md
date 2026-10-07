Dossier des fichiers de jeu locaux (ignoré par git, sauf ce fichier et les `.arena`).

**Map d'exemple : `mp_dome`** — à copier depuis ta propre installation MW3 :

```
inputs/zone/dome/mp_dome.ff        # FastFile de la map (≈ 60 Mo)
inputs/zone/dome/mp_dome_load.ff   # optionnel
```

La même arborescence `inputs/zone/<map>/mp_<map>.ff` fonctionne pour les autres maps (`seatown`, `bootleg`, …).
Les archives `main/*.iwd` (textures, sons) iront dans `inputs/main/` (utilisées plus tard).

Le viewer en dev charge directement une map avec `http://localhost:5173/?dev=dome`.
