Un historial Git limpio hace que una revisión sea legible y un `git bisect` eficaz. El rebase
interactivo (`git rebase -i`) es la herramienta para reescribir una rama antes de subirla:
fusionar, renombrar, reordenar, eliminar commits. Aquí tienes cómo manejarlo sin romper
una rama compartida.

## Abrir el todo

`git rebase -i` toma una **base**: todos los commits que vienen después de ella se vuelven
editables. Normalmente se apunta a los últimos N commits de la rama actual.

```bash
# Rewrite the last 4 commits
git rebase -i HEAD~4

# Or: everything between my branch and main
git rebase -i main
```

Git abre entonces una lista, del más antiguo (arriba) al más reciente (abajo). Cada línea
comienza con un comando que se reemplaza:

```bash
pick a1b2c3d Añade el servicio de carrito
pick d4e5f6a Corrige un typo
pick 7g8h9i0 Implementa el total
pick 1j2k3l4 wip
```

## Los comandos del día a día

- `reword` (`r`): mantener el commit pero reescribir su mensaje.
- `squash` (`s`): fusionar con el commit anterior **conservando** ambos mensajes.
- `fixup` (`f`): como squash, pero **descartando** el mensaje del commit fusionado, perfecto para
  un «wip» o una corrección de typo.
- `edit` (`e`): detenerse en el commit para modificar el código o dividirlo.
- `drop` (`d`): eliminar el commit por completo.

Reordenar se hace **moviendo las líneas**. Aquí está el todo anterior ya limpio:

```bash
pick a1b2c3d Añade el servicio de carrito
fixup d4e5f6a Corrige un typo
pick 7g8h9i0 Implementa el total
fixup 1j2k3l4 wip
```

Al guardar, Git reproduce los commits en el nuevo orden. Si dos modificaciones tocan
la misma línea, aparece un **conflicto**: se resuelve, luego `git add` y `git rebase
--continue`. En cualquier momento, `git rebase --abort` devuelve la rama a su estado anterior.

### El fixup automático

Para preparar una corrección destinada a un commit concreto, `--fixup` seguido de `--autosquash`
lo ordenan todo por ti:

```bash
git commit --fixup=7g8h9i0
git rebase -i --autosquash main
```

## La regla de oro

**Nunca rebasar un historial compartido.** El rebase **reescribe** los commits: sus SHA
cambian.

Si la rama ya está en el repositorio remoto y algunos compañeros la han descargado, tu
`git push --force` divergirá de su copia y provocará conflictos desagradables.

Por tanto, solo se rebasa una rama **local**, aún no subida. O una rama de la que uno
es el único propietario, con un `git push --force-with-lease` que se niega a sobrescribir un
trabajo inesperado.

## Recuperarse tras un error

Un rebase que sale mal nunca es fatal: `git reflog` guarda un registro de **cada**
posición de `HEAD`, incluso las «perdidas» por la reescritura.

```bash
git reflog
# ... 89abcde HEAD@{5}: rebase (start): ...
git reset --hard HEAD@{5}
```

Se recupera la rama exactamente tal como estaba antes del rebase. La documentación de referencia es
el [manual git-rebase](https://git-scm.com/docs/git-rebase).

> El rebase interactivo reescribe la historia para hacerla **narrable**: un commit = una idea,
> un mensaje claro. Resérvalo para lo local, protege tus pushes con `--force-with-lease`, y
> recuerda que el reflog es tu red de seguridad.
