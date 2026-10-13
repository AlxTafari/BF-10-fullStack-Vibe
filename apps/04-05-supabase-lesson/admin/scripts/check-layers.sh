#!/usr/bin/env bash
# Проверка правила зависимостей (ADR-008) для админки.
# routes → features → api → supabase; domain не импортирует ничего из остальных слоёв.
# Ищет запрещённые импорты по путям, код не исполняет.
set -u
cd "$(dirname "$0")/../src"

fail=0

# check <каталог> <regex запрещённого импорта> <пояснение>
check() {
  local dir="$1" pattern="$2" why="$3"
  local hits
  hits=$(grep -rnE "^(import|export) .*from ['\"](${pattern})" "$dir" --include='*.ts' --include='*.tsx' 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "✗ $dir: $why"
    echo "$hits" | sed 's/^/    /'
    fail=1
  fi
}

# domain — чистая логика: ни React, ни Supabase, ни другие слои (zod допустим).
check domain '@/(routes|features|api|components)|react|@supabase/|@reduxjs/|@tanstack/' \
  'domain не зависит от React, Supabase и других слоёв'
# api — единственное место с supabase-js; верхних слоёв не знает.
check api '@/(routes|features|components)' \
  'api не знает про экраны и компоненты'
# features — через api, напрямую в Supabase нельзя.
check features '@/routes|@supabase/supabase-js' \
  'features не знают про маршруты и не импортируют supabase-js'
# общие компоненты (shadcn) — без знания о приложении.
check components '@/(routes|features|api|domain)|@supabase/' \
  'components/ui ничего не знает о приложении'
# routes — только сборка экранов, к Supabase не обращаются.
check routes '@supabase/supabase-js' \
  'routes не импортируют supabase-js'

# Типы из database.types.ts допустимы везде — это не supabase-js.
[ "$fail" -eq 0 ] && echo "✓ слои админки соблюдены"
exit "$fail"
