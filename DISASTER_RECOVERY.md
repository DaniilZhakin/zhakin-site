# Disaster Recovery Plan — жакин.рф

## 1. Назначение

Этот документ описывает восстановление официального сайта Даниила Жакина при отказе текущего хостинга, GitHub или отдельных компонентов инфраструктуры.

## 2. Архитектурный принцип

Сайт не должен зависеть от одного поставщика.

- Домен: отдельный контур управления DNS.
- Исходный код: Git-репозиторий.
- Production: текущий hosting / GitHub Pages.
- Резерв: независимая копия репозитория и assets.
- SEO: `robots.txt`, `sitemap.xml`, metadata и schema входят в исходный проект.
- Intelligence 3.0: отдельный необязательный контур; отказ collector не должен останавливать статический сайт.

Подробная последовательность построения независимого контура, DNS cutover и rollback описана в [`docs/INDEPENDENT-INFRASTRUCTURE-PLAN.md`](docs/INDEPENDENT-INFRASTRUCTURE-PLAN.md).

## 3. Восстановление при отказе хостинга

1. Получить последнюю рабочую копию репозитория.
2. Развернуть статический сайт на новом hosting.
3. Проверить главную, `about.html`, `projects.html`, `publications.html` и assets.
4. Проверить HTTPS.
5. Обновить DNS-записи домена на новый production только после прохождения независимой проверки.
6. Проверить `robots.txt`, `sitemap.xml`, canonical и основные HTTP-ответы.
7. После подтверждения доступности проверить индексацию в поисковых системах.

## 4. Восстановление при потере GitHub

Использовать независимую резервную копию репозитория. После восстановления:

1. создать новый Git-репозиторий;
2. загрузить исходный код и историю, если она сохранена в backup;
3. проверить deployment;
4. сохранить новый remote в локальной документации;
5. не менять DNS до успешной проверки production.

## 5. Что резервировать

Минимальный backup должен включать:

- весь исходный код;
- `assets/` и изображения;
- `robots.txt`;
- `sitemap.xml`;
- `CNAME`;
- SEO metadata и Schema.org;
- deployment-конфигурацию;
- Intelligence 3.0 collector, schema и migrations;
- этот документ;
- `docs/INDEPENDENT-INFRASTRUCTURE-PLAN.md`.

## 6. Intelligence 3.0 — аварийное восстановление

Collector является изолированным дополнением к статическому сайту. Браузерный transport нельзя включать до прохождения production gate.

### 6.1 Потеря или отказ Worker

1. Остановить browser transport, если он уже был разрешён.
2. Проверить доступность статического сайта: отказ collector не должен влиять на рендеринг и навигацию.
3. Развернуть Worker из последнего проверенного commit в независимом production/runtime окружении.
4. Проверить schema validation, CORS, `Content-Type`, rate limiting и ответ при недоступном D1.
5. Только после независимой проверки восстановить transport.

### 6.2 Потеря D1

1. Не менять production DNS и статический сайт.
2. Получить последнюю утверждённую резервную копию агрегатов.
3. Создать новый D1 database вне Git и получить новый реальный `database_id`.
4. Применить миграции из `intelligence/collector-cloudflare/migrations/`.
5. Проверить структуру `engagement_daily` и reconciliation с backup.
6. Обновить production configuration только через защищённый runtime/secret management контур; реальные IDs и credentials не коммитить в Git.
7. Выполнить независимый smoke test collector и только затем вернуть рабочий transport.

### 6.3 Rollback Worker

Rollback выполняется на последний известный рабочий commit, а не на произвольную версию. Перед возвратом traffic проверить:

- HTTP `POST /v1/events`;
- `OPTIONS` preflight;
- schema contract;
- rate limiting;
- D1 write/upsert;
- корректный `503 storage_unavailable` при отсутствии DB binding;
- отсутствие prohibited personal data в логах и payload.

D1 migration rollback не должен предполагаться автоматически: destructive migration требует отдельной backup/reconciliation процедуры. Предпочтительный путь — восстановление совместимой версии схемы или создание нового D1 с проверенными миграциями.

## 7. Контрольная проверка после восстановления

- [ ] HTTPS работает.
- [ ] Главная открывается.
- [ ] Все основные разделы открываются.
- [ ] Навигация работает.
- [ ] Изображения и assets загружаются.
- [ ] `robots.txt` доступен.
- [ ] `sitemap.xml` доступен.
- [ ] Canonical указывает на официальный домен.
- [ ] Нет массовых 404/500.
- [ ] Search Console / Webmaster Tools видят сайт.
- [ ] Если Intelligence 3.0 включён, collector проходит smoke test.
- [ ] D1 schema и aggregate retention проверены.
- [ ] Backup/export recovery проверен.

## 8. Правило изменений

Перед крупным изменением production необходимо иметь возможность восстановить предыдущую рабочую версию.

**Цель:** отказ одного сервиса не должен означать потерю сайта или блокировать его публичную работу.
