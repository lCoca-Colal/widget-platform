// Создаёт по одному демо-виджету каждого типа с фиксированными ID
// и немного событий, чтобы аналитика сразу была не пустой.
const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "data", "db.json");
const now = new Date();
const iso = (d) => d.toISOString();

function daysAgo(n) {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return d;
}

const widgets = [
  {
    id: "demo-form",
    type: "form",
    name: "Форма подписки",
    status: "published",
    domains: [],
    version: 1,
    config: {
      title: "Подпишитесь на рассылку",
      subtitle: "Новые статьи раз в неделю, без спама",
      fields: { name: true, email: true, message: false },
      buttonText: "Подписаться",
      successText: "Готово! Проверьте почту.",
      accent: "#4338CA",
    },
    createdAt: iso(daysAgo(7)),
    updatedAt: iso(daysAgo(1)),
  },
  {
    id: "demo-popup",
    type: "popup",
    name: "Промо поп-ап",
    status: "published",
    domains: [],
    version: 1,
    config: {
      title: "−15% на первый заказ",
      text: "Введите промокод WELCOME при оформлении и получите скидку.",
      buttonText: "Получить скидку",
      buttonUrl: "#",
      trigger: "timer",
      delaySeconds: 2,
      position: "center",
      frequencyDays: 0,
      accent: "#0D9488",
    },
    createdAt: iso(daysAgo(5)),
    updatedAt: iso(daysAgo(1)),
  },
  {
    id: "demo-social",
    type: "social",
    name: "Лента отзывов",
    status: "published",
    domains: [],
    version: 1,
    config: {
      title: "Что говорят клиенты",
      layout: "grid",
      items: [
        { author: "Анна К.", rating: 5, text: "Очень удобный сервис, виджет поставился за пару минут." },
        { author: "Игорь П.", rating: 5, text: "Аналитика наглядная, сразу видно откуда трафик." },
        { author: "Мария С.", rating: 4, text: "Нравится, что не нужно ничего программировать." },
        { author: "Дмитрий Л.", rating: 5, text: "Поставил форму на Tilda — всё работает из коробки." },
      ],
    },
    createdAt: iso(daysAgo(6)),
    updatedAt: iso(daysAgo(2)),
  },
  {
    id: "demo-html",
    type: "html",
    name: "HTML-виджет (счётчик)",
    status: "published",
    domains: [],
    version: 1,
    config: {
      height: 220,
      html:
        '<div style="font-family:sans-serif;text-align:center;padding:24px;background:#0f1729;color:#fff;border-radius:12px">' +
        '<h2 style="margin:0 0 6px">Произвольный HTML + JS</h2>' +
        '<p style="margin:0 0 16px;color:#9fb3c8">Скрипт ниже работает внутри изолированного iframe</p>' +
        '<button id="b" style="padding:10px 18px;border:0;border-radius:8px;background:#4338CA;color:#fff;font-size:15px;cursor:pointer">Нажато: 0</button>' +
        '<script>var n=0,b=document.getElementById("b");b.onclick=function(){b.textContent="Нажато: "+(++n)}<\\/script>' +
        "</div>",
    },
    createdAt: iso(daysAgo(3)),
    updatedAt: iso(daysAgo(1)),
  },
  {
    id: "demo-video",
    type: "video",
    name: "Плавающее видео",
    status: "published",
    domains: [],
    version: 1,
    config: {
      videoUrl: "https://www.youtube.com/watch?v=l5aJQwK780c",
      position: "bottom-right",
      delaySeconds: 2,
      title: "Видео",
      caption: "Узнайте о нас за 30 секунд",
      ctaText: "Оставить заявку",
      ctaUrl: "#",
      accent: "#4338CA",
    },
    createdAt: iso(daysAgo(2)),
    updatedAt: iso(daysAgo(1)),
  },
];

// Немного событий за неделю
const events = [];
const domains = ["example.com", "myshop.ru", "blog.tilda.ws"];
let eid = 0;
function push(widgetId, type, day, domain) {
  events.push({
    id: "seed_" + eid++,
    widgetId,
    type,
    hostDomain: domain,
    visitorId: "seed_v" + Math.floor(Math.random() * 200),
    ts: iso(daysAgo(day)),
    meta: {},
  });
}
for (let d = 6; d >= 0; d--) {
  for (const dom of domains) {
    const imp = 20 + Math.floor(Math.random() * 40);
    for (let i = 0; i < imp; i++) push("demo-form", "impression", d, dom);
    for (let i = 0; i < Math.floor(imp * 0.18); i++) push("demo-form", "submit", d, dom);

    const pop = 30 + Math.floor(Math.random() * 50);
    for (let i = 0; i < pop; i++) push("demo-popup", "open", d, dom);
    for (let i = 0; i < pop; i++) push("demo-popup", "impression", d, dom);
    for (let i = 0; i < Math.floor(pop * 0.12); i++) push("demo-popup", "click", d, dom);

    const soc = 15 + Math.floor(Math.random() * 30);
    for (let i = 0; i < soc; i++) push("demo-social", "impression", d, dom);

    const htm = 10 + Math.floor(Math.random() * 25);
    for (let i = 0; i < htm; i++) push("demo-html", "impression", d, dom);

    const vid = 25 + Math.floor(Math.random() * 40);
    for (let i = 0; i < vid; i++) push("demo-video", "open", d, dom);
    for (let i = 0; i < vid; i++) push("demo-video", "impression", d, dom);
    for (let i = 0; i < Math.floor(vid * 0.22); i++) push("demo-video", "click", d, dom);
  }
}

if (!fs.existsSync(path.dirname(DB_FILE))) fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
fs.writeFileSync(DB_FILE, JSON.stringify({ widgets, events, submissions: [] }, null, 2));
console.log(`✓ Засеяно: ${widgets.length} виджета, ${events.length} событий.`);
console.log("  ID: demo-form, demo-popup, demo-social, demo-html, demo-video");
