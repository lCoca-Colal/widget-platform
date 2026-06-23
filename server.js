const express = require("express");
const path = require("path");
const fs = require("fs");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
// Публичный адрес, с которого виджеты грузятся на чужих сайтах.
// По умолчанию — ваш домен. Можно переопределить переменной окружения PUBLIC_BASE_URL.
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || "https://q.grandcar.info").replace(/\/$/, "");

app.use(express.json({ limit: "12mb" }));

// CORS: публичные эндпоинты должны работать с любого чужого сайта.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function hostFromReq(req) {
  const origin = req.headers.origin || req.headers.referer || "";
  try {
    return origin ? new URL(origin).hostname : "direct";
  } catch {
    return "direct";
  }
}

/* ============================================================
   ПУБЛИЧНЫЕ ЭНДПОИНТЫ (для embed.js на чужих сайтах)
   ============================================================ */

// Публичная конфигурация платформы (для админки: какой адрес ставить в код вставки).
app.get("/api/v1/platform", (req, res) => res.json({ baseUrl: PUBLIC_BASE }));

// Конфиг виджета. Кэшируется по ETag = версия виджета.
app.get("/api/v1/public/widgets/:id/config", (req, res) => {
  const w = db.getWidget(req.params.id);
  if (!w || w.status !== "published") {
    return res.status(404).json({ error: "Виджет не найден или не опубликован" });
  }
  // Проверка домена (если список задан) — защита от чужого использования.
  if (w.domains && w.domains.length) {
    const host = hostFromReq(req);
    const allowed = w.domains.some((d) => host === d || host.endsWith("." + d));
    if (host !== "direct" && !allowed) {
      return res.status(403).json({ error: "Домен не разрешён для этого виджета" });
    }
  }
  const etag = `"v${w.version}"`;
  res.set("ETag", etag);
  // no-cache = браузер кэширует, но ОБЯЗАН сверяться с сервером по ETag перед использованием.
  // Так изменения виджета видны сразу, а при отсутствии изменений отдаётся лёгкий 304.
  res.set("Cache-Control", "no-cache");
  if (req.headers["if-none-match"] === etag) return res.status(304).end();
  res.json({ id: w.id, type: w.type, version: w.version, config: w.config });
});

// Приём событий аналитики (батчем). Не блокирует страницу (sendBeacon).
app.post("/api/v1/events", (req, res) => {
  const incoming = Array.isArray(req.body.events) ? req.body.events : [];
  const host = hostFromReq(req);
  const events = incoming
    .filter((e) => e && e.widgetId && e.type)
    .map((e) => ({ ...e, hostDomain: e.hostDomain || host }));
  db.addEvents(events);
  res.status(202).json({ accepted: events.length });
});

// Отправка формы с чужого сайта.
app.post("/api/v1/public/widgets/:id/submit", (req, res) => {
  const w = db.getWidget(req.params.id);
  if (!w || w.type !== "form") {
    return res.status(404).json({ error: "Форма не найдена" });
  }
  const sub = db.addSubmission({
    widgetId: w.id,
    payload: req.body.payload || {},
    hostDomain: hostFromReq(req),
  });
  db.addEvents([
    { widgetId: w.id, type: "submit", hostDomain: hostFromReq(req), visitorId: req.body.visitorId },
  ]);
  // Вебхук: если задан в настройках формы — шлём лид во внешний сервис (не блокируя ответ).
  if (w.config && w.config.webhookUrl) {
    try {
      fetch(w.config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgetId: w.id, payload: sub.payload, hostDomain: sub.hostDomain, ts: sub.ts }),
      }).catch(() => {});
    } catch (e) {}
  }
  res.status(201).json({ ok: true, id: sub.id });
});

/* ============================================================
   АДМИН-ЭНДПОИНТЫ (в проде за авторизацией; в прототипе открыты локально)
   ============================================================ */

app.get("/api/v1/widgets", (req, res) => res.json(db.listWidgets()));

app.get("/api/v1/widgets/:id", (req, res) => {
  const w = db.getWidget(req.params.id);
  if (!w) return res.status(404).json({ error: "Не найдено" });
  res.json(w);
});

app.post("/api/v1/widgets", (req, res) => {
  const { type, name, config, domains } = req.body;
  if (!["form", "popup", "social", "html", "video"].includes(type)) {
    return res.status(400).json({ error: "Неизвестный тип виджета" });
  }
  res.status(201).json(db.createWidget({ type, name, config, domains }));
});

// Дублировать виджет.
app.post("/api/v1/widgets/:id/duplicate", (req, res) => {
  const w = db.getWidget(req.params.id);
  if (!w) return res.status(404).json({ error: "Не найдено" });
  const copy = db.createWidget({
    type: w.type,
    name: w.name + " (копия)",
    config: JSON.parse(JSON.stringify(w.config || {})),
    domains: [],
  });
  res.status(201).json(copy);
});

app.patch("/api/v1/widgets/:id", (req, res) => {
  const w = db.updateWidget(req.params.id, req.body);
  if (!w) return res.status(404).json({ error: "Не найдено" });
  res.json(w);
});

app.delete("/api/v1/widgets/:id", (req, res) => {
  const ok = db.deleteWidget(req.params.id);
  res.json({ deleted: ok });
});

app.get("/api/v1/widgets/:id/submissions", (req, res) => {
  res.json(db.submissionsForWidget(req.params.id));
});

// Экспорт заявок в CSV (с BOM для корректной кириллицы в Excel).
app.get("/api/v1/widgets/:id/submissions.csv", (req, res) => {
  const subs = db.submissionsForWidget(req.params.id);
  const keys = new Set();
  subs.forEach((s) => Object.keys(s.payload || {}).forEach((k) => keys.add(k)));
  const cols = ["ts", "hostDomain", ...keys];
  const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const rows = [cols.join(",")];
  subs.forEach((s) =>
    rows.push(cols.map((c) => cell(c === "ts" || c === "hostDomain" ? s[c] : (s.payload || {})[c])).join(","))
  );
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="leads-${req.params.id}.csv"`);
  res.send("\uFEFF" + rows.join("\r\n"));
});

// Загрузка файла (data URL → локальный файл в public/uploads). Без БД и без внешних зависимостей.
app.post("/api/v1/upload", (req, res) => {
  try {
    const { dataUrl, filename } = req.body || {};
    const m = /^data:(.+?);base64,(.+)$/s.exec(dataUrl || "");
    if (!m) return res.status(400).json({ error: "Ожидается data URL (base64)" });
    const ext = (m[1].split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 5);
    const dir = path.join(__dirname, "public", "uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const base = (filename || "file").replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
    const name = Date.now().toString(36) + "_" + base + "." + ext;
    fs.writeFileSync(path.join(dir, name), Buffer.from(m[2], "base64"));
    res.json({ url: "/uploads/" + name });
  } catch (e) {
    res.status(500).json({ error: "Ошибка загрузки файла" });
  }
});

// Аналитика: агрегаты по виджету.
app.get("/api/v1/analytics/:id", (req, res) => {
  let events = db.eventsForWidget(req.params.id);
  const days = parseInt(req.query.days, 10);
  if (days && days > 0) {
    const since = Date.now() - days * 86400000;
    events = events.filter((e) => new Date(e.ts).getTime() >= since);
  }
  const count = (t) => events.filter((e) => e.type === t).length;
  const impressions = count("impression");
  const clicks = count("click");
  const submits = count("submit");
  const opens = count("open");

  const uniqueVisitors = new Set(events.map((e) => e.visitorId)).size;

  // По дням
  const byDay = {};
  for (const e of events) {
    const day = (e.ts || "").slice(0, 10);
    if (!byDay[day]) byDay[day] = { impression: 0, click: 0, submit: 0, open: 0 };
    if (byDay[day][e.type] !== undefined) byDay[day][e.type]++;
  }

  // По доменам
  const byDomain = {};
  for (const e of events) {
    byDomain[e.hostDomain] = (byDomain[e.hostDomain] || 0) + 1;
  }

  res.json({
    totals: {
      impressions,
      clicks,
      submits,
      opens,
      uniqueVisitors,
      ctr: impressions ? +((clicks / impressions) * 100).toFixed(1) : 0,
      conversion: impressions ? +((submits / impressions) * 100).toFixed(1) : 0,
    },
    byDay: Object.entries(byDay)
      .sort()
      .map(([day, v]) => ({ day, ...v })),
    byDomain: Object.entries(byDomain)
      .sort((a, b) => b[1] - a[1])
      .map(([domain, count]) => ({ domain, count })),
  });
});

/* ============================================================
   СТАТИКА
   ============================================================ */

// Диагностика: показывает, какие файлы реально видит сервер (можно удалить позже).
app.get("/debug", (req, res) => {
  const out = {};
  const show = (label, p) => {
    try { out[label] = fs.readdirSync(p); }
    catch (e) { out[label] = "НЕТ ПАПКИ: " + e.code; }
  };
  out.__dirname = __dirname;
  out.cwd = process.cwd();
  out.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "(не задан)";
  show(". (корень приложения)", __dirname);
  show("public", path.join(__dirname, "public"));
  show("public/admin", path.join(__dirname, "public", "admin"));
  res.json(out);
});

// embed.js и runtime отдаём с правильным content-type
app.use(express.static(path.join(__dirname, "public")));

// Корень -> админка
app.get("/", (req, res) =>
  res.redirect("/admin/")
);

app.listen(PORT, () => {
  console.log(`\n  ▸ Платформа виджетов запущена на порту ${PORT}`);
  console.log(`  ▸ Публичный адрес: ${PUBLIC_BASE}`);
  console.log(`  ▸ Админка:  ${PUBLIC_BASE}/admin/`);
  console.log(`  ▸ Loader:   ${PUBLIC_BASE}/embed.js\n`);
});
