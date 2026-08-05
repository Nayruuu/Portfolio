Un historial legible no es cosmético. Una revisión se lee commit a commit, `git bisect`
asume que cada commit compila, y un `git log` claro sirve de memoria al proyecto. El rebase
interactivo es la herramienta que pone una rama en orden antes de subirla: reescribir un mensaje,
fundir un «wip» en el commit que corrige, reordenar, dividir, eliminar. Nada de magia,
solo Git que reproduce sus commits uno a uno dejándole intervenir entre cada uno.

## Abrir el todo

`git rebase -i` toma una **base**. Todos los commits situados después de ella se vuelven editables. Normalmente
se apunta a los N últimos commits de la rama, o a todo lo que la separa de `main`.

```bash
# The last 4 commits of the current branch
git rebase -i HEAD~4

# Every commit on this branch that isn't already on main
git rebase -i main
```

Git abre un archivo «todo» y lo rellena desde el commit más antiguo (arriba) hasta el más reciente (abajo).
Es el orden inverso a `git log`, y conviene tenerlo en mente antes de mover líneas.

```
pick a1b2c3d Ajoute le service de panier
pick d4e5f6a Corrige un typo
pick 7g8h9i0 Implémente le total
pick 1j2k3l4 wip
```

Cada línea empieza con un verbo. El trabajo consiste en reemplazar esos verbos, reordenar las
líneas, o eliminar algunas, y luego guardar para dejar que Git reproduzca la rama.

## Los verbos del todo

Siete comandos cubren lo esencial:

- `pick` (`p`): aplicar el commit tal cual. Es el valor por defecto en cada línea.
- `reword` (`r`): aplicar el commit, pero reabrir el editor para reescribir su mensaje.
- `edit` (`e`): aplicar el commit y luego **detenerse**, con `HEAD` situado sobre él, para enmendar el código
  o dividirlo.
- `squash` (`s`): fundir el commit en el de la línea de arriba, concatenando ambos
  mensajes en el editor.
- `fixup` (`f`): como `squash`, pero **descartando** el mensaje del commit absorbido. La opción por defecto
  para un «wip» o una corrección de typo.
- `drop` (`d`): eliminar el commit. Borrar la línea hace lo mismo.
- `exec` (`x`): no toca ningún commit, pero ejecuta el resto de la línea en una shell una vez
  alcanzado ese punto de la reproducción.

## Reordenar y fundir

Reordenar se hace moviendo las líneas. Retomemos el todo anterior, limpiado: cada
corrección se pega debajo del commit que repara, y se fusiona sin conservar su mensaje.

```
pick a1b2c3d Ajoute le service de panier
fixup d4e5f6a Corrige un typo
pick 7g8h9i0 Implémente le total
fixup 1j2k3l4 wip
```

Al guardar, cuatro commits se convierten en dos, cada uno con un diff limpio y un mensaje que se sostiene
sin tener el código delante. Si dos modificaciones tocan la misma línea, la reproducción **se interrumpe**
en el conflicto: `git status` muestra los archivos afectados, usted los corrige, `git add` marca la
resolución, y luego `git rebase --continue` retoma. No se hace `git commit`: es `--continue` quien recompone
el commit en curso. Un commit que queda vacío tras la resolución se salta con
`git rebase --skip`, y `git rebase --abort` devuelve la rama exactamente a su estado anterior.

## El fixup automático

Cuando detecta un bug en un commit ya revisado, no hace falta colocar la línea `fixup` a mano.
Indexe la corrección, vincúlela al commit objetivo, y deje que `--autosquash` la ordene:

```bash
# Tie the staged fix to the commit it repairs
git commit --fixup=7g8h9i0

# Autosquash moves every fixup!/squash! next to its target and pre-marks it
git rebase -i --autosquash main
```

`--fixup` escribe un commit cuyo mensaje es `fixup! Implémente le total`. `--autosquash` lee ese
prefijo, mueve la línea justo después de su objetivo en el todo y la marca `fixup` por usted.
`--squash=<sha>` hace lo mismo pero conserva un borrador de mensaje mediante `squash`. Un
`git config --global rebase.autoSquash true` hace el comportamiento implícito, y la opción se vuelve
innecesaria.

## Dividir un commit

Un commit que hace dos cosas se corta con `edit`. Márquelo, y la reproducción se detiene justo
en él, con `HEAD` situado sobre ese commit, el árbol limpio.

```bash
git rebase -i HEAD~3
# change 'pick' to 'edit' on the fat commit, save and quit

# The rebase pauses there. Rewind the commit, then re-commit in slices:
git reset HEAD^        # undo the commit; its changes return to the working tree
git add -p             # stage only the first coherent chunk
git commit -m "Extract the cart total helper"
git add -p
git commit -m "Wire the total into the checkout"
git rebase --continue
```

`git reset HEAD^` retrocede `HEAD` un commit y devuelve todas sus modificaciones al directorio
de trabajo (reset *mixed*, el valor por defecto), lo que le permite recomponer varios commits. Si
prefiere mantener una parte indexada y deshacer solo el resto, `git reset -p HEAD^` hace la selección hunk
por hunk. Misma lógica para probar cada commit de una serie: `git rebase -i --exec "npm test"
HEAD~6` inserta un `exec npm test` después de cada `pick` y se detiene en el primer commit que se pone en
rojo.

## Trasplantar una rama con `--onto`

La forma de tres argumentos, `git rebase --onto <nueva-base> <base-anterior> <rama>`, mueve
un rango de commits a otro lugar. El caso típico: ha abierto `feature` encima de una rama
`spike` que nunca irá a revisión, y quiere replantar solo los commits de `feature` sobre
`main`.

```bash
# Replay spike..feature onto main, leaving spike behind
git rebase --onto main spike feature
```

Git toma los commits accesibles desde `feature` pero no desde `spike`, y los reproduce sobre
`main`. La misma forma sirve para eliminar un commit en medio de una rama:
`git rebase --onto badcommit^ badcommit` reproduce todo lo que sigue a `badcommit` sobre su padre, lo que
lo borra sin tocar el resto.

## La regla de oro

**Nunca rebasar un historial compartido.** El rebase **reescribe** los commits: un SHA cubre el
contenido del commit y el de su padre, así que reproducir una serie les da a todos una nueva
identidad. Una rama ya subida que colegas han obtenido va a divergir de su copia; su
`git push --force` sobrescribe la referencia común y les deja fusiones penosas que desenredar.

Por tanto, se rebasa una rama **local** aún no subida, o una rama de la que se es el único
propietario. En este último caso, suba con `git push --force-with-lease`: se niega a sobrescribir
si la referencia remota se ha movido desde su último `fetch`, a diferencia de `--force`, que sobrescribe sin plantear
preguntas.

## La red de seguridad

Un rebase que sale mal nunca es fatal. `git reflog` guarda un rastro de **cada** posición
que ha ocupado `HEAD`, incluidas las que la reescritura ha «perdido».

```bash
git reflog
# 89abcde HEAD@{5}: rebase (start): checkout main
git reset --hard HEAD@{5}
```

`HEAD@{5}` designa el lugar donde se encontraba la rama cinco desplazamientos antes; `reset --hard`
la devuelve ahí, al commit exacto. La documentación de referencia sigue siendo el
[manual git-rebase](https://git-scm.com/docs/git-rebase), que detalla cada verbo y cada modo.

> El rebase interactivo hace una rama legible: un commit por idea, un mensaje que se sostiene sin
> tener el diff delante. Resérvelo para lo local, suba con `--force-with-lease`, y recuerde que
> el reflog rescata casi todos los errores.
