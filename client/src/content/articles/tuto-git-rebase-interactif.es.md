## Abrir el todo

`git rebase -i` toma una **base**: todos los commits que vienen después de ella se vuelven editables. Generalmente se apunta a los N últimos commits de la rama actual.

```bash
# Réécrire les 4 derniers commits
git rebase -i HEAD~4

# Ou : tout ce qui sépare ma branche de main
git rebase -i main
```

Git abre entonces una lista, del más antiguo (arriba) al más reciente (abajo). Cada línea comienza con un comando que se reemplaza:

```bash
pick a1b2c3d Ajoute le service de panier
pick d4e5f6a Corrige un typo
pick 7g8h9i0 Implémente le total
pick 1j2k3l4 wip
```

## Los comandos del día a día

- `reword` (`r`): conservar el commit pero reescribir su mensaje.
- `squash` (`s`): fusionar en el commit anterior **conservando** ambos mensajes.
- `fixup` (`f`): como squash, pero **descartando** el mensaje del commit fusionado — perfecto para un «wip» o una corrección de errata.
- `edit` (`e`): detenerse en el commit para modificar el código o dividirlo.
- `drop` (`d`): eliminar el commit por completo.

Reordenar se hace simplemente **moviendo las líneas**. Aquí el todo anterior limpio:

```bash
pick a1b2c3d Ajoute le service de panier
fixup d4e5f6a Corrige un typo
pick 7g8h9i0 Implémente le total
fixup 1j2k3l4 wip
```

Al guardar, Git reproduce los commits en el nuevo orden. Si dos modificaciones tocan la misma línea, aparece un **conflicto**: se resuelve, luego `git add` y `git rebase --continue`. En cualquier momento, `git rebase --abort` devuelve la rama a su estado anterior.

### El fixup automático

Para preparar una corrección destinada a un commit concreto, `--fixup` y luego `--autosquash` lo organizan todo por ti:

```bash
git commit --fixup=7g8h9i0
git rebase -i --autosquash main
```

## La regla de oro

**Nunca rebasear un historial compartido.** El rebase **reescribe** los commits: sus SHA cambian. Si la rama ya está en el repositorio remoto y los compañeros la han descargado, tu `git push --force` divergirá de su copia y provocará conflictos desagradables. Por tanto, se rebasea únicamente una rama **local**, aún no publicada — o una rama de la que se es el único propietario, con un `git push --force-with-lease` que rechaza sobreescribir trabajo inesperado.

## Recuperarse tras un error

Un rebase que sale mal nunca es fatal: `git reflog` guarda un registro de **cada** posición de `HEAD`, incluso las «perdidas» por la reescritura.

```bash
git reflog
# ... 89abcde HEAD@{5}: rebase (start): ...
git reset --hard HEAD@{5}
```

Se recupera la rama exactamente tal como estaba antes del rebase. La documentación de referencia es el [manual git-rebase](https://git-scm.com/docs/git-rebase).

> El rebase interactivo reescribe la historia para hacerla **narrable**: un commit = una idea, un mensaje claro. Resérvalo para lo local, asegura tus pushs con `--force-with-lease`, y recuerda que el reflog es tu red de seguridad.
