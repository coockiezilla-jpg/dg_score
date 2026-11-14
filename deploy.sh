#!/bin/bash
# Выкладка DG score на GitHub Pages.
#
# Использование:
#   ./deploy.sh              — выложить текущую версию
#   ./deploy.sh 1.0.2        — поднять версию приложения до 1.0.2 и выложить
#
# Скрипт держит версию приложения и версию кэша service worker
# согласованными: CACHE_NAME = dgscore-v<версия>-<метка сборки>.
# Метка сборки меняется при каждой выкладке, поэтому телефон всегда
# получает свежие файлы, даже если номер версии не поднимали.

set -euo pipefail

cd "$(dirname "$0")"

NEW_VERSION="${1:-}"

if [ -n "$NEW_VERSION" ]; then
  sed -i '' -E "s/^const VERSION = '[^']*';/const VERSION = '${NEW_VERSION}';/" app.js
fi

VERSION="$(sed -nE "s/^const VERSION = '([^']*)';/\1/p" app.js)"
if [ -z "$VERSION" ]; then
  echo "Ошибка: не удалось прочитать VERSION из app.js" >&2
  exit 1
fi

BUILD_ID="$(date +%Y%m%d-%H%M)"
CACHE="dgscore-v${VERSION}-${BUILD_ID}"

sed -i '' -E "s/^const CACHE_NAME = '[^']*';/const CACHE_NAME = '${CACHE}';/" sw.js

echo "Версия приложения: ${VERSION}"
echo "Кэш service worker: ${CACHE}"

# Синтаксис
node --check app.js
node --check sw.js

# Все ассеты из precache должны существовать
MISSING="$(grep -oE "'\./[^']+'" sw.js | tr -d "'" | sed 's|^\./||' | while read -r f; do
  [ "$f" = "" ] && continue
  [ -e "$f" ] || echo "$f"
done)"

if [ -n "$MISSING" ]; then
  echo "Ошибка: в precache указаны отсутствующие файлы:" >&2
  echo "$MISSING" >&2
  exit 1
fi

# Страховка: абсолютные пути от корня в подкаталоге GitHub Pages не работают
if grep -nE '(src|href)="/' index.html >/dev/null 2>&1; then
  echo "Ошибка: в index.html есть абсолютные пути (/...), они не работают в подкаталоге" >&2
  exit 1
fi

git add -A
if git diff --cached --quiet; then
  echo "Нечего выкладывать: изменений нет."
  exit 0
fi

git commit -m "DG score v${VERSION} (build ${BUILD_ID})"
git push

echo
echo "Готово. GitHub Pages обновится в течение ~1 минуты."
echo "На телефоне: закрыть приложение и открыть заново."
