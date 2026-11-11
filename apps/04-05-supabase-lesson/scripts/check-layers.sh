#!/usr/bin/env bash
# Проверка правила зависимостей чистой архитектуры (ADR-008) для Edge Functions.
# Зависимости направлены только внутрь: handlers → services → repositories / domain.
# Скрипт ищет запрещённые импорты по путям; код не исполняет. Вызывается из CI (S08).
set -u
cd "$(dirname "$0")/../supabase/functions"

fail=0

# check <каталог> <regex запрещённого импорта> <пояснение>
check() {
  local dir="$1" pattern="$2" why="$3"
  local hits
  hits=$(grep -rnE "^(import|export) .*from .*(${pattern})" "$dir" --include='*.ts' 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "✗ $dir: $why"
    echo "$hits" | sed 's/^/    /'
    fail=1
  fi
}

# domain — чистая логика: ни БД, ни Telegram, ни LLM, ни другие слои.
check _shared/domain 'repositories/|services/|telegram/|llm/|supabase-js|telegram-webhook/' \
  'domain не зависит от инфраструктуры и других слоёв'
# repositories — только доступ к данным.
check _shared/repositories 'services/|telegram/|telegram-webhook/' \
  'repositories не знают про сервисы, Telegram и обработчики'
# services — сценарии ядра, без Telegram и без обработчиков.
check _shared/services 'telegram/|telegram-webhook/' \
  'services не знают про Telegram и обработчики'
# telegram — клиент API, ничего не знает про приложение.
check _shared/telegram 'repositories/|services/|domain/|telegram-webhook/' \
  'telegram-клиент не знает про слои приложения'
# llm — клиент модели (S09), как telegram: ничего не знает про приложение.
check _shared/llm 'repositories/|services/|domain/|telegram/|telegram-webhook/' \
  'llm-клиент не знает про слои приложения'
# обработчики (telegram-webhook) — только через сервисы, в репозитории напрямую нельзя.
check telegram-webhook 'repositories/' \
  'обработчики обращаются к данным только через services'
# Edge Function менеджера (S06b) — тоже обработчик: данные только через services.
check manager-chat 'repositories/|domain/' \
  'manager-chat обращается к данным и правилам только через services'
# …и к LLM тоже (ADR-008): клиента модели создаёт services/ai. Исключение — тесты и testing/: сценарным
# тестам нужен фейковый LLM из _shared/llm/fakeLlm.ts, как фейковый Telegram.
llm_hits=$(grep -rnE "^(import|export) .*from .*llm/" telegram-webhook --include='*.ts' \
  --exclude-dir=testing --exclude='*.test.ts' 2>/dev/null || true)
if [ -n "$llm_hits" ]; then
  echo "✗ telegram-webhook: обработчики не вызывают LLM напрямую, только через services/ai"
  echo "$llm_hits" | sed 's/^/    /'
  fail=1
fi

# SDK Gemini — только в _shared/llm: типы Google не текут в сервисы и тесты.
sdk_hits=$(grep -rnE "from .*@google/genai" . --include='*.ts' | grep -v '^\./_shared/llm/' || true)
if [ -n "$sdk_hits" ]; then
  echo "✗ @google/genai импортируется вне _shared/llm"
  echo "$sdk_hits" | sed 's/^/    /'
  fail=1
fi

[ "$fail" -eq 0 ] && echo "✓ слои соблюдены"
exit "$fail"
