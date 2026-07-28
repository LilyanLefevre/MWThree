Tu es en train de m'aider à construire un explorateur MW3 jouable dans le navigateur.
Lis `docs/PLAN.md` et `docs/SESSION_REFERENCE.md` pour comprendre le projet, l'état d'avancement et la structure.

Phase 0 complétée (fondations : monorepo, builds, tests, scene 3D, FPS basique, détection MW3).
Prochaine phase : Phase 1 — Décompression FastFile (support IWff0100 OK, IW4x à investiguer).

La map de test est `inputs/mp_seatown/mp_seatown.ff` (format IW4x).
Commence en lisant `docs/SESSION_REFERENCE.md` pour te remettre à jour.

Commandes essentielles :
- `npm run dev` → lancer le viewer
- `npm run build` → build complet
- `npm run test -w packages/iw5-core` → tests
