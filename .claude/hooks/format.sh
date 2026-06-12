#!/usr/bin/env bash
# PostToolUse hook — formate le fichier édité avec Prettier.
# La config Prettier (.prettierrc.json + .prettierignore) vit dans client/ : on s'y
# place avant de lancer prettier, comme le script npm, pour que l'ignore protège
# les templates à alignement manuel volontaire (player). Le chemin du fichier est
# absolu, donc le cd ne le casse pas.
# Si Prettier n'est pas installé, npx --no-install échoue sans bruit : no-op.
f=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$f" ] && exit 0
case "$f" in
  *.ts|*.scss|*.html|*.json)
    [ -f "$f" ] || exit 0
    cd "${CLAUDE_PROJECT_DIR:-.}/client" 2>/dev/null || exit 0
    npx --no-install prettier --write --ignore-unknown "$f" >/dev/null 2>&1
    ;;
esac
exit 0
