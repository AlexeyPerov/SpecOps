# GL-05 — Общий toolbar и режим Changes

**Статус:** Accepted — реализация, mounted/API/Git tests и desktop-приёмка завершены; [доказательства и ограничения](evidence/README.md). **Зависимости:** GL-01, GL-02, GL-04.

## Работы

- [x] Вынести в toolbar подписанные действия Commit, Pull, Push, Fetch, Branch, Merge, Stash; справа — открыть remote, показать папку, терминал, настройки, где доступны платформенные команды.
- [x] Fetch сделать явным действием. Pull/Push открывают modal confirmation entry points вместо немедленного запуска команды. Полные формы выбора target/options остаются зависимостями GL-06/07.
- [x] Commit открывает Changes и фокусирует сообщение; Branch и Stash используют текущие сценарии. Merge недоступен с объяснением до реализации соответствующей Git-операции.
- [x] В Changes слева staged/unstaged файлы и форма коммита, справа diff выбранного файла. Сохранить stage selected/all, unstage selected и commit; не обещать staging строк/блоков.
- [x] Учитывать busy/cancel/error, ahead/behind и наличие remote; счётчики показывать только из актуального состояния. Не копировать значения бейджей со снимка.
- [x] Узкое окно сворачивает второстепенные действия в overflow, сохраняя доступность и подписи для accessibility.
- [x] Сохранить очередь, pre-git save guard, существующие проверки bare/detached/no-upstream, обновление файлов/refs после операции и запрос авторизации.

## Приёмка

- [x] Переключение History ↔ Changes сохраняет сообщение коммита и корректный выбор, не отправляет команды автоматически.
- [x] Недоступные действия объяснимы; видимая кнопка не создаёт впечатление реализованной операции при отсутствии backend.
- [x] Уже выполняющаяся мутация исключает конфликтующий запуск из toolbar, дерева, диалога или другого окна в рамках текущих гарантий очереди.
- [x] Cancel останавливает операцию, повторный клик не создаёт дубликаты; результат согласован с реальным Git-состоянием.

**Проверка:** mounted toolbar/navigation tests, регрессия текущего stage/commit и remote busy/cancel flow.

## Реализованные границы

Доступны Show folder, Settings и Open remote для HTTP(S) URL. Платформенной команды открытия терминала сейчас нет, действие не показывается. Минимальные Pull/Push confirmation shells вызывают существующие Git операции с выбранным remote/default options; расширенные формы и backend options не объявляются реализованными до GL-06/07. Merge disabled с объяснением.

Mounted tests проверяют toolbar, фокус Commit, сохранение draft и active diff при History ↔ Changes, save guard staging/commit, исключение повторного запуска, отмену, refresh после ошибки и смену workspace во время preflight. Реальные viewport/overflow screenshots, авторизация через desktop и многoоконная сценарная проверка ожидают GL-08; текущая очередь Git сохранена.
