# Tu fork: cómo está armado y cómo se actualiza

Este repo NO es "un fork con 300 commits propios". Es **upstream + tu trabajo**, y el
trabajo estaba sin commitear. Esta guía deja eso ordenado:

```
main      → espejo de upstream. NUNCA tiene cambios tuyos.
mi-fork   → donde vivís. main + tus commits.
```

`feat/argentina-portals` queda como marcador en el commit base, por si querés retomar
esa idea como PR a upstream.

## Regla de oro

`main` solo avanza de release en release, sin editar nada. Todo lo tuyo va en `mi-fork`.
El día que actualizás, el merge trae solo lo que upstream cambió, y los conflictos
aparecen únicamente en los archivos que vos tocaste (hoy: `web/`).

## Traer una versión nueva (ej. 1.40.0)

```bash
# 1. Actualizar el espejo. Elegí UNA de las dos:

# 1a. Con el updater oficial (recomendado: respeta el user layer)
git switch main
node update-system.mjs apply --confirm

# 1b. O a mano con el tag del release
git switch main
git fetch origin --tags
git merge --ff-only career-ops-v1.40.0

# 2. Bajar upstream a tu rama de trabajo
git switch mi-fork
git merge main

# 3. Si hay conflictos, son tuyos vs upstream en web/ — resolvelos acá.
#    Después de resolver: npm --prefix web test && npm --prefix web run typecheck
```

Si el release no te interesa (o te asusta), no hacés nada: `main` se queda quieto y
`mi-fork` sigue funcionando. El aviso de update se silencia con
`node update-system.mjs dismiss --version 1.40.0` (vuelve a aparecer en la siguiente).

## Qué NO hacer

- **No corras `node update-system.mjs apply` estando en `mi-fork`.** El updater escribe
  los archivos de sistema con `git checkout FETCH_HEAD -- <paths>`: en tu rama pisaría
  tus ediciones de `web/` sin preguntar. Siempre desde `main`.
- No mergees upstream en `mi-fork` sin mirar el diff: `git log --oneline mi-fork..main`
  antes del merge te dice qué entra.
- No hagas `git reset --hard` con trabajo sin commitear. Si tenés dudas:
  `git stash -u` o commit en una rama `wip/...`.

## Tu data no corre riesgo

Está todo gitignored (user layer): `cv.md`, `config/`, `modes/_profile.md`,
`modes/_custom.md`, `portals.yml`, `voice-dna.md`, `data/`, `reports/`, `documents/`,
`output/`, `dev-local/`. Ningún update, merge ni clone las toca.

Recuperación nuclear, si algo sale mal: `git clone` de tu fork en otra carpeta y copiás
esas rutas. Es exactamente lo que el propio updater recomienda.

## Higiene que ahorra dolor

```bash
git config rerere.enabled true   # recuerda cómo resolviste cada conflicto
git config rerere.autoupdate true
```

Y de vez en cuando, un seguro fuera del repo (no incluye datos personales):

```bash
git bundle create ~/career-ops-$(date +%F).bundle --all
```

## Tests: usá Node 22, o NO_COLOR=1

El repo declara `engines.node: ^22.13.0 || >=23.4.0`, pero con **Node 26** algunos
tests fallan por un cambio de comportamiento de Node, no del código:
`web/tests/lib/web-ts-alias-loader.test.mjs` compara la salida de un proceso hijo y
Node 26 la colorea (`\x1b[33mtrue\x1b[39m`), así que `"true function"` no coincide.

```bash
NO_COLOR=1 npm --prefix web test        # cualquier Node
# o, mejor, correr el repo con Node 22 LTS
```

Fallos conocidos que NO son tuyos (v1.40.0):

- `clis-coverage.test.mjs`: `docs/SUPPORTED_CLIS.md` documenta Oh My Pi (`omp`)
  pero `web/src/lib/clis.ts` no tiene la entrada. Gap de upstream.
- `profile-write-shape.test.mjs` (10): la ruta `/api/profile` cambió de forma en
  el refactor local y ese test todavía no la acompaña.

## Qué es divergencia real hoy

Solo `web/` (más dos docs). El resto de tus "customizaciones" son archivos de user layer
que ya están fuera de git. Si algún día querés que actualizar deje de doler del todo,
los candidatos a PR upstream son el fix del mensaje de error de cuota y el selector de
modelo; el refactor de profile/CV es el que sí es tuyo.
