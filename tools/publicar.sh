#!/usr/bin/env bash
# Prepara la carpeta publicar/ con SOLO los archivos que usa la web, lista para subir a topgit.earth.
# Uso (desde la raíz del proyecto):  bash tools/publicar.sh
# Después sube el CONTENIDO de publicar/ a la raíz del alojamiento (index.html tiene que quedar en la raíz).
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=publicar
rm -rf "$DEST"; mkdir -p "$DEST"

copiar() { mkdir -p "$DEST/$(dirname "$1")"; cp -R "$1" "$DEST/$1"; }
copiar index.html
for d in css js vendor data assets/textures base-planetaria/web/data; do copiar "$d"; done
# documentos enlazados desde «Lo que hemos trabajado»
for f in base-planetaria/similitud/*.md; do copiar "$f"; done

# fuera lo que no es de la web
rm -rf "$DEST/base-planetaria/web/data/tierra/motor"   # duplicado: la web usa base-planetaria/web/data/analogos/
find "$DEST" \( -name '.DS_Store' -o -name '__pycache__' -o -name '*.pyc' \) -prune -exec rm -rf {} +

echo "Listo: $DEST/ ($(du -sh "$DEST" | cut -f1), $(find "$DEST" -type f | wc -l | tr -d ' ') archivos)"
echo "Archivo más grande: $(find "$DEST" -type f -exec ls -l {} + | sort -k5 -n | tail -1 | awk '{printf "%s (%.1f MB)", $9, $5/1048576}')"
