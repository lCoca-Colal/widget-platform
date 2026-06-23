/* Админка: список виджетов, конструктор, аналитика, заявки. */
const API = "";
const TYPE_META = {
  form: { ico: "✉", label: "form" },
  popup: { ico: "◰", label: "popup" },
  social: { ico: "❝", label: "social" },
  html: { ico: "‹/›", label: "html" },
  video: { ico: "▶", label: "video" },
};

let widgets = [];
let activeId = null;
let activeTab = "build";
let embedBase = location.origin; // адрес для кода вставки (переопределяется из /api/v1/platform)
let analyticsDays = 0; // период аналитики: 0 = всё время

const $ = (s, r = document) => r.querySelector(s);
const el = (t, props = {}, html) => {
  const e = document.createElement(t);
  Object.assign(e, props);
  if (html != null) e.innerHTML = html;
  return e;
};
const escAttr = (s) => String(s == null ? "" : s).replace(/"/g, "&quot;");

async function api(path, opts) {
  const r = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.status === 204 ? null : r.json();
}

/* ---------------- Список ---------------- */
async function loadWidgets() {
  widgets = await api("/api/v1/widgets");
  renderList();
  if (widgets.length) {
    if (!activeId || !widgets.some((w) => w.id === activeId)) selectWidget(widgets[0].id);
  } else {
    activeId = null;
    showEmpty();
  }
}

function showEmpty() {
  $("#content").innerHTML =
    '<div class="empty"><div class="empty-art">▣</div>' +
    "<h2>Выберите виджет слева</h2>" +
    "<p>или создайте новый, чтобы настроить его и получить код вставки.</p></div>";
}

function renderList() {
  const list = $("#widgetList");
  list.innerHTML = "";
  widgets.forEach((w) => {
    const item = el("div", { className: "wl-item" + (w.id === activeId ? " active" : "") });
    item.innerHTML =
      `<div class="wl-ico">${TYPE_META[w.type].ico}</div>` +
      `<div class="wl-meta"><div class="wl-name">${escAttr(w.name)}</div>` +
      `<div class="wl-type">${TYPE_META[w.type].label}</div></div>`;
    item.onclick = () => selectWidget(w.id);
    list.appendChild(item);
  });
}

async function selectWidget(id) {
  activeId = id;
  renderList();
  renderWidget();
}

/* ---------------- Каркас виджета ---------------- */
async function renderWidget() {
  const w = await api("/api/v1/widgets/" + activeId);
  const content = $("#content");
  content.innerHTML = "";

  const head = el("div", { className: "w-head" });
  const paused = w.status === "paused";
  head.innerHTML =
    `<div><div class="w-title">${escAttr(w.name)} ` +
    `<span class="status-badge ${paused ? "paused" : "live"}">${paused ? "на паузе" : "опубликован"}</span></div>` +
    `<div class="w-id">ID: <span class="pill">${w.id}</span> · версия ${w.version}</div></div>` +
    `<div class="head-actions">` +
    `<button class="btn" id="pauseBtn">${paused ? "Опубликовать" : "Поставить на паузу"}</button>` +
    `<button class="btn" id="dupBtn">Дублировать</button>` +
    `<button class="btn btn-danger" id="delBtn">Удалить</button></div>`;
  content.appendChild(head);
  $("#delBtn").onclick = () => deleteWidget(w.id);
  $("#dupBtn").onclick = () => duplicateWidget(w.id);
  $("#pauseBtn").onclick = async () => {
    await api("/api/v1/widgets/" + w.id, { method: "PATCH", body: JSON.stringify({ status: paused ? "published" : "paused" }) });
    renderWidget();
  };

  const tabs = el("div", { className: "tabs" });
  [["build", "Конструктор"], ["analytics", "Аналитика"], ["leads", "Заявки"]].forEach(([k, label]) => {
    const t = el("button", { className: "tab" + (activeTab === k ? " active" : "") }, label);
    t.onclick = () => { activeTab = k; renderWidget(); };
    tabs.appendChild(t);
  });
  content.appendChild(tabs);

  const panel = el("div");
  content.appendChild(panel);

  if (activeTab === "build") renderBuild(panel, w);
  else if (activeTab === "analytics") renderAnalytics(panel, w);
  else renderLeads(panel, w);
}

/* ---------------- Конструктор ---------------- */
function field(label, name, value, type = "text", placeholder = "") {
  return `<label class="fld"><span>${label}</span>` +
    (type === "textarea"
      ? `<textarea name="${name}" rows="2" placeholder="${escAttr(placeholder)}">${escAttr(value)}</textarea>`
      : `<input name="${name}" type="${type}" value="${escAttr(value)}" placeholder="${escAttr(placeholder)}" />`) +
    `</label>`;
}
function selectField(label, name, value, options) {
  const opts = options.map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${l}</option>`).join("");
  return `<label class="fld"><span>${label}</span><select name="${name}">${opts}</select></label>`;
}
// Поле с кнопкой загрузки файла (картинка/видео) — файл сохраняется локально, в поле подставляется URL.
function fileField(label, name, value, accept) {
  return `<label class="fld"><span>${label}</span>` +
    `<div class="file-row"><input name="${name}" type="text" value="${escAttr(value)}" placeholder="URL или загрузите файл" />` +
    `<button type="button" class="btn upload-btn" data-upload="${name}">Загрузить</button></div>` +
    `<input type="file" data-uploadfor="${name}" accept="${accept || "*/*"}" style="display:none" /></label>`;
}
// Блок «размещение на странице» для встраиваемых виджетов (форма, лента, HTML).
function placementFields(c) {
  return `<div class="row2">` +
    selectField("Размещение на странице", "placement", c.placement || "inline", [
      ["inline", "В потоке страницы (где код)"],
      ["bottom-right", "Закрепить снизу справа"],
      ["bottom-left", "Закрепить снизу слева"],
      ["top-right", "Закрепить сверху справа"],
      ["top-left", "Закрепить сверху слева"],
    ]) +
    field("Ширина при закреплении, px", "floatWidth", c.floatWidth ?? 360, "number") +
    `</div>` +
    `<div class="hint">«В потоке» — виджет появляется там, где вставлен код. Любой угол — виджет закрепляется поверх страницы (с кнопкой закрытия).</div>`;
}

function renderBuild(panel, w) {
  const c = w.config || {};
  let form = "";

  if (w.type === "form") {
    form =
      field("Заголовок", "title", c.title || "") +
      field("Подзаголовок", "subtitle", c.subtitle || "") +
      `<label class="fld"><span>Поля формы</span><div class="checks">` +
      checkbox("fields.name", "Имя", c.fields?.name) +
      checkbox("fields.email", "Email", c.fields?.email !== false) +
      checkbox("fields.phone", "Телефон", c.fields?.phone) +
      checkbox("fields.message", "Сообщение", c.fields?.message) +
      `</div></label>` +
      `<div class="row2">` +
      field("Текст кнопки", "buttonText", c.buttonText || "Отправить") +
      field("Цвет акцента", "accent", c.accent || "#4338CA") +
      `</div>` +
      field("Сообщение после отправки", "successText", c.successText || "Спасибо! Заявка отправлена.") +
      field("Webhook URL (куда слать лиды, необязательно)", "webhookUrl", c.webhookUrl || "") +
      placementFields(c);
  } else if (w.type === "popup") {
    form =
      field("Заголовок", "title", c.title || "") +
      field("Текст", "text", c.text || "", "textarea") +
      `<div class="row2">` +
      field("Текст кнопки", "buttonText", c.buttonText || "") +
      field("Ссылка кнопки", "buttonUrl", c.buttonUrl || "") +
      `</div>` +
      `<div class="row2">` +
      selectField("Триггер показа", "trigger", c.trigger || "timer", [
        ["timer", "По таймеру"], ["scroll", "При скролле"], ["exit", "Exit-intent"], ["now", "Сразу"],
      ]) +
      selectField("Позиция", "position", c.position || "center", [
        ["center", "Центр"], ["bottom-right", "Снизу справа"], ["top-bar", "Полоса сверху"],
      ]) +
      `</div>` +
      `<div class="row2">` +
      field("Задержка, сек (для таймера)", "delaySeconds", c.delaySeconds ?? 3, "number") +
      field("Частота показа, дней (0 = всегда)", "frequencyDays", c.frequencyDays ?? 1, "number") +
      `</div>` +
      fileField("Картинка (необязательно)", "imageUrl", c.imageUrl || "", "image/*") +
      field("Цвет акцента", "accent", c.accent || "#0D9488");
  } else if (w.type === "video") {
    form =
      fileField("Видео (YouTube/Vimeo ссылка или файл .mp4)", "videoUrl", c.videoUrl || "", "video/*") +
      `<div class="hint">Поддерживаются ссылки YouTube и Vimeo, либо загруженный файл MP4.</div>` +
      `<div class="row2">` +
      selectField("Позиция", "position", c.position || "bottom-right", [["bottom-right", "Снизу справа"], ["bottom-left", "Снизу слева"]]) +
      field("Задержка появления, сек", "delaySeconds", c.delaySeconds ?? 2, "number") +
      `</div>` +
      field("Метка над подписью", "title", c.title || "Видео") +
      field("Подпись у кружка", "caption", c.caption || "") +
      `<div class="row2">` +
      field("Текст кнопки в модалке (необязательно)", "ctaText", c.ctaText || "") +
      field("Ссылка кнопки", "ctaUrl", c.ctaUrl || "") +
      `</div>` +
      field("Цвет акцента", "accent", c.accent || "#4338CA");
  } else if (w.type === "social") {
    const itemsJson = JSON.stringify(c.items || [], null, 2);
    form =
      field("Заголовок", "title", c.title || "") +
      selectField("Раскладка", "layout", c.layout || "grid", [["grid", "Сетка"], ["list", "Список"]]) +
      `<label class="fld"><span>Отзывы (JSON: author, rating, text)</span>` +
      `<textarea name="items" rows="10" style="font-family:var(--mono);font-size:13px">${escAttr(itemsJson)}</textarea></label>` +
      `<div class="hint">Каждый отзыв: {"author":"Имя","rating":5,"text":"..."}. В бою это тянется из API соцсетей/отзовиков.</div>` +
      placementFields(c);
  } else if (w.type === "html") {
    form =
      `<label class="fld"><span>HTML-код виджета</span>` +
      `<textarea name="html" rows="12" style="font-family:var(--mono);font-size:13px" placeholder="&lt;div&gt;Любой HTML, CSS и JS&lt;/div&gt;">${escAttr(c.html || "")}</textarea></label>` +
      `<div class="hint">Можно вставить любой HTML/CSS/JS. Рендерится в изолированном sandbox-iframe — скрипты работают, но не имеют доступа к чужому сайту.</div>` +
      field("Высота, px", "height", c.height ?? 300, "number") +
      placementFields(c);
  }

  panel.innerHTML =
    `<div class="build-grid">` +
    `<div><div class="section"><h4>Настройки</h4><div id="cfgForm">${form}</div>` +
    `<div class="save-bar"><button class="btn btn-primary" id="saveBtn">Сохранить</button>` +
    `<span class="saved-note" id="savedNote">✓ Сохранено — превью и сайты обновлены</span></div></div>` +
    `<div class="section"><h4>Код для вставки на любой сайт</h4>` +
    embedBlock(w.id) +
    `<div class="hint" style="margin-top:12px;margin-bottom:0">Вставьте эту строку в HTML любого сайта. Виджет обновляется автоматически при изменении настроек.</div></div></div>` +
    `<div><div class="section preview-section"><h4>Живое превью</h4>` +
    `<div class="browser"><div class="browser-bar"><span></span><span></span><span></span></div>` +
    `<iframe id="previewFrame" src="/preview.html?id=${w.id}&t=${Date.now()}"></iframe></div>` +
    `<div class="hint" style="margin:10px 0 0">Так виджет выглядит на странице. Поп-апы и видео появляются внутри этой рамки.</div></div></div>` +
    `</div>`;

  $("#saveBtn").onclick = () => saveConfig(w);
  bindCopy();
  bindUploads();
}

// Загрузка файлов: кнопка открывает выбор файла, файл уходит на сервер, в поле подставляется URL.
function bindUploads() {
  document.querySelectorAll(".upload-btn").forEach((btn) => {
    const name = btn.getAttribute("data-upload");
    const fileInput = document.querySelector(`[data-uploadfor="${name}"]`);
    const textInput = document.querySelector(`#cfgForm [name="${name}"]`);
    if (!fileInput || !textInput) return;
    btn.onclick = () => fileInput.click();
    fileInput.onchange = () => {
      const f = fileInput.files[0];
      if (!f) return;
      const orig = btn.textContent;
      btn.textContent = "загрузка…";
      btn.disabled = true;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const res = await api("/api/v1/upload", { method: "POST", body: JSON.stringify({ dataUrl: reader.result, filename: f.name }) });
          textInput.value = res.url;
        } catch (e) {
          alert("Не удалось загрузить файл");
        }
        btn.textContent = orig;
        btn.disabled = false;
      };
      reader.readAsDataURL(f);
    };
  });
}

function checkbox(name, label, checked) {
  return `<label class="chk"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}/>${label}</label>`;
}

function embedBlock(id) {
  const origin = embedBase;
  const code = `&lt;script src="${origin}/embed.js" data-widget-id="${id}" async&gt;&lt;/script&gt;`;
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(origin);
  const warn = isLocal
    ? `<div class="hint" style="color:var(--warn);margin:10px 0 0">⚠ Адрес localhost работает только на этом компьютере. Чтобы виджет открывался на других сайтах, задайте PUBLIC_BASE_URL или используйте туннель (см. README).</div>`
    : "";
  return `<div class="embed-block"><button class="copy-btn" data-copy='<script src="${origin}/embed.js" data-widget-id="${id}" async></script>'>копировать</button><code>${code}</code></div>${warn}`;
}

function bindCopy() {
  document.querySelectorAll(".copy-btn").forEach((b) => {
    b.onclick = () => {
      navigator.clipboard.writeText(b.getAttribute("data-copy"));
      const t = b.textContent; b.textContent = "скопировано ✓";
      setTimeout(() => (b.textContent = t), 1500);
    };
  });
}

async function saveConfig(w) {
  const root = $("#cfgForm");
  const c = {};
  root.querySelectorAll("input, textarea, select").forEach((inp) => {
    if (!inp.name) return; // скрытый file-input без name
    if (inp.name === "items") {
      try { c.items = JSON.parse(inp.value || "[]"); } catch { alert("Ошибка в JSON отзывов"); throw new Error("json"); }
      return;
    }
    if (inp.name.startsWith("fields.")) {
      c.fields = c.fields || {};
      c.fields[inp.name.split(".")[1]] = inp.checked;
      return;
    }
    if (inp.type === "number") c[inp.name] = inp.value === "" ? null : Number(inp.value);
    else c[inp.name] = inp.value;
  });
  await api("/api/v1/widgets/" + w.id, { method: "PATCH", body: JSON.stringify({ config: c }) });
  const frame = $("#previewFrame");
  if (frame) frame.src = "/preview.html?id=" + w.id + "&t=" + Date.now();
  const note = $("#savedNote");
  note.classList.add("show");
  setTimeout(() => note.classList.remove("show"), 2500);
}

/* ---------------- Аналитика ---------------- */
async function renderAnalytics(panel, w) {
  panel.innerHTML = `<div class="section">Загрузка…</div>`;
  const a = await api("/api/v1/analytics/" + w.id + (analyticsDays ? "?days=" + analyticsDays : ""));
  const t = a.totals;

  const ranges = [[7, "7 дней"], [30, "30 дней"], [0, "Всё время"]];
  const rangeBar =
    `<div class="range-bar">` +
    ranges.map(([d, l]) => `<button class="range-btn ${analyticsDays === d ? "active" : ""}" data-days="${d}">${l}</button>`).join("") +
    `</div>`;

  const kpis =
    `<div class="kpis">` +
    kpi(t.impressions.toLocaleString("ru"), "Показы", "accent") +
    kpi(t.uniqueVisitors.toLocaleString("ru"), "Уник. посетители", "") +
    (w.type === "form"
      ? kpi(t.submits.toLocaleString("ru"), "Заявки", "ok") + kpi(t.conversion + "%", "Конверсия", "ok")
      : kpi(t.clicks.toLocaleString("ru"), "Клики", "") + kpi(t.ctr + "%", "CTR", "ok")) +
    `</div>`;

  // График по дням (показы)
  const days = a.byDay;
  const max = Math.max(1, ...days.map((d) => d.impression));
  const bars = days.map((d) => {
    const h = (d.impression / max) * 100;
    const lbl = d.day.slice(5);
    return `<div class="bar-col"><div class="bar" style="height:${h}%" title="${d.impression} показов"></div><div class="bar-lbl">${lbl}</div></div>`;
  }).join("");

  // По доменам
  const maxDom = Math.max(1, ...a.byDomain.map((d) => d.count));
  const domains = a.byDomain.length
    ? a.byDomain.map((d) =>
        `<div class="dom-row"><div class="dom-name">${escAttr(d.domain)}</div>` +
        `<div class="dom-track"><div class="dom-fill" style="width:${(d.count / maxDom) * 100}%"></div></div>` +
        `<div class="dom-val">${d.count}</div></div>`
      ).join("")
    : `<div class="hint" style="margin:0">Пока нет данных. Откройте демо-сайт, чтобы сгенерировать события.</div>`;

  panel.innerHTML =
    rangeBar +
    kpis +
    `<div class="section"><h4>Показы по дням</h4><div class="chart">${bars || "<div class='hint'>Нет данных</div>"}</div></div>` +
    `<div class="section"><h4>Где встроен виджет (по событиям)</h4>${domains}</div>`;

  panel.querySelectorAll(".range-btn").forEach((b) => {
    b.onclick = () => { analyticsDays = Number(b.getAttribute("data-days")); renderAnalytics(panel, w); };
  });
}

function kpi(val, lbl, cls) {
  return `<div class="kpi"><div class="val ${cls}">${val}</div><div class="lbl">${lbl}</div></div>`;
}

/* ---------------- Заявки ---------------- */
async function renderLeads(panel, w) {
  if (w.type !== "form") {
    panel.innerHTML = `<div class="section"><div class="hint" style="margin:0">Заявки есть только у виджетов-форм.</div></div>`;
    return;
  }
  const subs = await api("/api/v1/widgets/" + w.id + "/submissions");
  if (!subs.length) {
    panel.innerHTML = `<div class="section"><div class="hint" style="margin:0">Пока нет заявок. Отправьте форму на демо-сайте.</div></div>`;
    return;
  }
  const rows = subs.slice().reverse().map((s) => {
    const p = s.payload || {};
    const data = Object.entries(p).map(([k, v]) => `<b>${escAttr(k)}:</b> ${escAttr(v)}`).join("<br>");
    return `<tr><td>${new Date(s.ts).toLocaleString("ru")}</td><td>${data}</td><td>${escAttr(s.hostDomain)}</td></tr>`;
  }).join("");
  panel.innerHTML =
    `<div class="section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">` +
    `<h4 style="margin:0">Заявки (${subs.length})</h4>` +
    `<a class="btn" href="/api/v1/widgets/${w.id}/submissions.csv" download>Экспорт CSV</a></div>` +
    `<table class="tbl"><thead><tr><th>Когда</th><th>Данные</th><th>Домен</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ---------------- Создание / удаление ---------------- */
$("#newBtn").onclick = () => ($("#createModal").hidden = false);
$("#cancelCreate").onclick = () => ($("#createModal").hidden = true);
$("#createModal").onclick = (e) => { if (e.target.id === "createModal") $("#createModal").hidden = true; };
document.querySelectorAll(".type-card").forEach((card) => {
  card.onclick = async () => {
    const type = card.getAttribute("data-type");
    const name = $("#newName").value.trim() || card.querySelector("b").textContent;
    const w = await api("/api/v1/widgets", { method: "POST", body: JSON.stringify({ type, name, config: defaultConfig(type) }) });
    $("#createModal").hidden = true;
    $("#newName").value = "";
    activeTab = "build";
    await loadWidgets();
    selectWidget(w.id);
  };
});

function defaultConfig(type) {
  if (type === "form") return { title: "Свяжитесь с нами", subtitle: "Оставьте контакты", fields: { name: true, email: true, message: true }, buttonText: "Отправить", accent: "#4338CA", successText: "Спасибо! Заявка отправлена." };
  if (type === "popup") return { title: "Специальное предложение", text: "Скидка 10% по промокоду WELCOME.", buttonText: "Получить", buttonUrl: "#", trigger: "timer", delaySeconds: 3, position: "center", frequencyDays: 1, accent: "#0D9488" };
  if (type === "social") return { title: "Отзывы", layout: "grid", items: [{ author: "Клиент", rating: 5, text: "Отличный сервис!" }] };
  if (type === "video") return { videoUrl: "https://www.youtube.com/watch?v=l5aJQwK780c", position: "bottom-right", delaySeconds: 2, title: "Видео", caption: "Узнайте о нас за 30 секунд", ctaText: "", ctaUrl: "", accent: "#4338CA" };
  return { html: '<div style="padding:24px;text-align:center;font-family:sans-serif">\n  <h2 style="margin:0 0 8px">Привет из HTML-виджета 👋</h2>\n  <p style="color:#555">Сюда можно вставить любой HTML, CSS и JS.</p>\n</div>', height: 200 };
}

async function duplicateWidget(id) {
  const copy = await api("/api/v1/widgets/" + id + "/duplicate", { method: "POST" });
  activeTab = "build";
  await loadWidgets();
  selectWidget(copy.id);
}

async function deleteWidget(id) {
  if (!confirm("Удалить виджет? Его данные и аналитика будут стёрты.")) return;
  await api("/api/v1/widgets/" + id, { method: "DELETE" });
  if (activeId === id) activeId = null;
  await loadWidgets();
}

async function init() {
  try {
    const p = await api("/api/v1/platform");
    if (p && p.baseUrl) embedBase = p.baseUrl.replace(/\/$/, "");
  } catch (e) {}
  loadWidgets();
}

init();
