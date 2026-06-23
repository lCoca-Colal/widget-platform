// Минимальное хранилище на JSON-файле.
// В бою заменяется на PostgreSQL/Supabase — интерфейс функций остаётся тем же.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify({ widgets: [], events: [], submissions: [] }, null, 2)
    );
  }
}

function read() {
  ensure();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function write(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function uid(prefix) {
  return (
    (prefix ? prefix + "_" : "") +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}

// ---- Widgets ----
function listWidgets() {
  return read().widgets;
}

function getWidget(id) {
  return read().widgets.find((w) => w.id === id) || null;
}

function createWidget({ id, type, name, config, domains }) {
  const db = read();
  const now = new Date().toISOString();
  const widget = {
    id: id || uid("w"),
    type,
    name: name || "Без названия",
    status: "published",
    config: config || {},
    domains: domains || [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  db.widgets.push(widget);
  write(db);
  return widget;
}

function updateWidget(id, patch) {
  const db = read();
  const w = db.widgets.find((x) => x.id === id);
  if (!w) return null;
  if (patch.name !== undefined) w.name = patch.name;
  if (patch.status !== undefined) w.status = patch.status;
  if (patch.config !== undefined) w.config = patch.config;
  if (patch.domains !== undefined) w.domains = patch.domains;
  w.version += 1; // бамп версии -> инвалидация кэша конфига
  w.updatedAt = new Date().toISOString();
  write(db);
  return w;
}

function deleteWidget(id) {
  const db = read();
  const before = db.widgets.length;
  db.widgets = db.widgets.filter((w) => w.id !== id);
  db.events = db.events.filter((e) => e.widgetId !== id);
  db.submissions = db.submissions.filter((s) => s.widgetId !== id);
  write(db);
  return db.widgets.length < before;
}

// ---- Events (аналитика) ----
function addEvents(events) {
  const db = read();
  for (const e of events) {
    db.events.push({
      id: uid("e"),
      widgetId: e.widgetId,
      type: e.type,
      hostDomain: e.hostDomain || "unknown",
      visitorId: e.visitorId || "anon",
      ts: e.ts || new Date().toISOString(),
      meta: e.meta || {},
    });
  }
  write(db);
  return events.length;
}

function eventsForWidget(id) {
  return read().events.filter((e) => e.widgetId === id);
}

// ---- Submissions (лиды форм) ----
function addSubmission({ widgetId, payload, hostDomain }) {
  const db = read();
  const sub = {
    id: uid("s"),
    widgetId,
    payload,
    hostDomain: hostDomain || "unknown",
    ts: new Date().toISOString(),
  };
  db.submissions.push(sub);
  write(db);
  return sub;
}

function submissionsForWidget(id) {
  return read().submissions.filter((s) => s.widgetId === id);
}

module.exports = {
  uid,
  listWidgets,
  getWidget,
  createWidget,
  updateWidget,
  deleteWidget,
  addEvents,
  eventsForWidget,
  addSubmission,
  submissionsForWidget,
};
