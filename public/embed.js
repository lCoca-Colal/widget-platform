/* =====================================================================
   embed.js — loader платформы виджетов.
   Это ЕДИНСТВЕННЫЙ файл, который клиент вставляет на свой сайт:

     <script src="https://.../embed.js" data-widget-id="ID" async></script>
     или
     <div data-widget-id="ID"></div>
     <script src="https://.../embed.js" async></script>

   Что делает:
   1. Находит контейнеры по data-widget-id.
   2. Тянет конфиг с сервера.
   3. Рендерит виджет в изолированном Shadow DOM (чужой CSS не ломает виджет).
   4. Шлёт события аналитики (impression/click/submit/open/close).

   В проде рантаймы каждого типа грузятся отдельно (code-splitting) и
   рендерятся на Preact. Здесь для нулевой сборки — всё в одном файле на
   ванильном JS. Механика (Shadow DOM, конфиг, события) идентична бою.
   ===================================================================== */
(function () {
  "use strict";

  // Базовый URL сервера = origin этого скрипта.
  var SELF = document.currentScript || (function () {
    var s = document.getElementsByTagName("script");
    return s[s.length - 1];
  })();
  var API_BASE = new URL(SELF.src).origin;

  // Стабильный ID посетителя (для уникальных показов и дедупликации).
  function visitorId() {
    try {
      var k = "wgt_visitor";
      var v = localStorage.getItem(k);
      if (!v) {
        v = "v_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(k, v);
      }
      return v;
    } catch (e) {
      return "anon";
    }
  }

  // Отправка события — sendBeacon, чтобы не блокировать страницу.
  function track(widgetId, type, meta) {
    if (window.__WIDGET_NO_TRACK) return; // режим превью в админке — не засчитываем
    var body = JSON.stringify({
      events: [{
        widgetId: widgetId,
        type: type,
        visitorId: visitorId(),
        hostDomain: location.hostname,
        ts: new Date().toISOString(),
        meta: meta || {}
      }]
    });
    var url = API_BASE + "/api/v1/events";
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      } else {
        fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true });
      }
    } catch (e) {}
  }

  // Экранирование пользовательского контента (защита от XSS).
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------------- Рендереры виджетов ---------------- */

  function baseStyles() {
    return (
      ":host{all:initial}" +
      "*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}" +
      "button{cursor:pointer;border:0;font:inherit}" +
      "input,textarea{font:inherit;width:100%}"
    );
  }

  function renderForm(root, id, cfg) {
    var fields = cfg.fields || { name: true, email: true, message: true };
    var accent = cfg.accent || "#4338CA";
    var rows = "";
    if (fields.name) rows += '<input name="name" placeholder="' + esc(cfg.namePlaceholder || "Имя") + '" />';
    if (fields.email) rows += '<input name="email" type="email" placeholder="' + esc(cfg.emailPlaceholder || "Email") + '" required />';
    if (fields.phone) rows += '<input name="phone" placeholder="' + esc(cfg.phonePlaceholder || "Телефон") + '" />';
    if (fields.message) rows += '<textarea name="message" rows="3" placeholder="' + esc(cfg.messagePlaceholder || "Сообщение") + '"></textarea>';

    root.innerHTML =
      "<style>" + baseStyles() +
      ".wgt{max-width:420px;background:#fff;border:1px solid #e6e8ee;border-radius:14px;padding:22px;box-shadow:0 6px 24px rgba(20,24,31,.06)}" +
      ".wgt h3{font-size:18px;font-weight:700;color:#11151c;margin-bottom:4px}" +
      ".wgt p.sub{font-size:13px;color:#6b7280;margin-bottom:16px}" +
      ".wgt input,.wgt textarea{padding:11px 13px;border:1px solid #d8dce4;border-radius:9px;margin-bottom:10px;outline:none}" +
      ".wgt input:focus,.wgt textarea:focus{border-color:" + accent + ";box-shadow:0 0 0 3px " + accent + "22}" +
      ".wgt button{width:100%;padding:12px;border-radius:9px;background:" + accent + ";color:#fff;font-weight:600;font-size:15px}" +
      ".wgt button:hover{filter:brightness(.95)}" +
      ".wgt .ok{color:#0d9488;font-weight:600;text-align:center;padding:18px 0}" +
      "</style>" +
      '<div class="wgt">' +
      "<h3>" + esc(cfg.title || "Свяжитесь с нами") + "</h3>" +
      '<p class="sub">' + esc(cfg.subtitle || "Оставьте контакты — мы ответим") + "</p>" +
      '<div class="form">' + rows +
      '<button type="button" data-act="submit">' + esc(cfg.buttonText || "Отправить") + "</button>" +
      "</div></div>";

    root.querySelector('[data-act="submit"]').addEventListener("click", function () {
      var payload = {};
      root.querySelectorAll("input,textarea").forEach(function (el) { payload[el.name] = el.value; });
      if (fields.email && !payload.email) { alert("Укажите email"); return; }
      fetch(API_BASE + "/api/v1/public/widgets/" + id + "/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: payload, visitorId: visitorId() })
      }).then(function () {
        root.querySelector(".wgt").innerHTML =
          '<div class="ok">' + esc(cfg.successText || "Спасибо! Заявка отправлена.") + "</div>";
      }).catch(function () { alert("Ошибка отправки"); });
    });

    track(id, "impression");
  }

  function renderPopup(root, id, cfg) {
    var accent = cfg.accent || "#4338CA";
    var freqDays = cfg.frequencyDays != null ? cfg.frequencyDays : 1;
    var seenKey = "wgt_popup_" + id;
    // Частота показа
    try {
      var last = localStorage.getItem(seenKey);
      if (last && freqDays > 0) {
        var days = (Date.now() - +last) / 86400000;
        if (days < freqDays) { track(id, "impression", { suppressed: true }); return; }
      }
    } catch (e) {}

    var pos = cfg.position || "center"; // center | bottom-right | top-bar
    var posCss = pos === "bottom-right"
      ? "right:24px;bottom:24px"
      : pos === "top-bar"
      ? "left:0;right:0;top:0;border-radius:0;max-width:none"
      : "left:50%;top:50%;transform:translate(-50%,-50%)";

    function show() {
      root.innerHTML =
        "<style>" + baseStyles() +
        ".ov{position:fixed;inset:0;background:rgba(15,23,41," + (pos === "top-bar" ? "0" : ".5") + ");z-index:2147483000}" +
        ".box{position:fixed;" + posCss + ";background:#fff;border-radius:14px;padding:26px;max-width:420px;width:calc(100% - 32px);box-shadow:0 20px 60px rgba(0,0,0,.25);z-index:2147483001}" +
        ".box.top-bar{display:flex;align-items:center;gap:16px;justify-content:center;padding:14px 24px}" +
        ".box h3{font-size:20px;font-weight:700;color:#11151c;margin-bottom:8px}" +
        ".box p{font-size:14px;color:#4b5563;margin-bottom:18px;line-height:1.5}" +
        ".box.top-bar h3,.box.top-bar p{margin:0;font-size:15px}" +
        ".cta{display:inline-block;padding:11px 20px;border-radius:9px;background:" + accent + ";color:#fff;font-weight:600;text-decoration:none}" +
        ".cta:hover{filter:brightness(.95)}" +
        ".x{position:absolute;right:12px;top:10px;background:none;color:#9ca3af;font-size:22px;line-height:1;width:28px;height:28px;border-radius:6px}" +
        ".x:hover{background:#f3f4f6;color:#374151}" +
        ".top-bar .x{position:static}" +
        "</style>" +
        (pos === "top-bar" ? "" : '<div class="ov" data-act="close"></div>') +
        '<div class="box ' + pos + '">' +
        '<button class="x" data-act="close">&times;</button>' +
        "<div>" +
        (cfg.imageUrl ? '<img src="' + esc(cfg.imageUrl) + '" alt="" style="max-width:100%;border-radius:8px;margin-bottom:12px;display:block" />' : "") +
        "<h3>" + esc(cfg.title || "Специальное предложение") + "</h3>" +
        "<p>" + esc(cfg.text || "Скидка 10% на первый заказ по промокоду WELCOME.") + "</p>" +
        "</div>" +
        '<a class="cta" href="' + esc(cfg.buttonUrl || "#") + '" data-act="cta">' + esc(cfg.buttonText || "Получить скидку") + "</a>" +
        "</div>";

      root.querySelectorAll('[data-act="close"]').forEach(function (el) {
        el.addEventListener("click", function () { root.innerHTML = ""; track(id, "close"); });
      });
      root.querySelector('[data-act="cta"]').addEventListener("click", function () { track(id, "click"); });

      try { localStorage.setItem(seenKey, "" + Date.now()); } catch (e) {}
      track(id, "open");
      track(id, "impression");
    }

    var trigger = cfg.trigger || "timer";
    if (trigger === "timer") {
      setTimeout(show, (cfg.delaySeconds != null ? cfg.delaySeconds : 3) * 1000);
    } else if (trigger === "scroll") {
      var fired = false;
      window.addEventListener("scroll", function () {
        if (fired) return;
        var p = (window.scrollY + window.innerHeight) / document.body.scrollHeight;
        if (p > (cfg.scrollPercent || 50) / 100) { fired = true; show(); }
      });
    } else if (trigger === "exit") {
      var done = false;
      document.addEventListener("mouseout", function (e) {
        if (done || e.clientY > 0) return;
        done = true; show();
      });
    } else { show(); }
  }

  function renderSocial(root, id, cfg) {
    var items = cfg.items || [];
    var layout = cfg.layout || "grid"; // grid | list
    var cards = items.map(function (it) {
      var stars = "";
      if (it.rating) for (var i = 0; i < 5; i++) stars += i < it.rating ? "★" : "☆";
      return (
        '<div class="card">' +
        '<div class="hd">' +
        '<div class="av">' + esc((it.author || "?").slice(0, 1).toUpperCase()) + "</div>" +
        "<div><div class='name'>" + esc(it.author || "Аноним") + "</div>" +
        (stars ? "<div class='stars'>" + stars + "</div>" : "") + "</div>" +
        "</div>" +
        '<p class="txt">' + esc(it.text || "") + "</p>" +
        "</div>"
      );
    }).join("");

    root.innerHTML =
      "<style>" + baseStyles() +
      ".wrap h3{font-size:18px;font-weight:700;color:#11151c;margin-bottom:14px}" +
      ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}" +
      ".list{display:flex;flex-direction:column;gap:12px}" +
      ".card{background:#fff;border:1px solid #e6e8ee;border-radius:12px;padding:16px}" +
      ".hd{display:flex;align-items:center;gap:10px;margin-bottom:10px}" +
      ".av{width:38px;height:38px;border-radius:50%;background:#4338CA;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700}" +
      ".name{font-weight:600;font-size:14px;color:#11151c}" +
      ".stars{color:#f59e0b;font-size:13px;letter-spacing:1px}" +
      ".txt{font-size:14px;color:#4b5563;line-height:1.55}" +
      "</style>" +
      '<div class="wrap">' +
      (cfg.title ? "<h3>" + esc(cfg.title) + "</h3>" : "") +
      '<div class="' + (layout === "list" ? "list" : "grid") + '">' + cards + "</div>" +
      "</div>";

    track(id, "impression");
  }

  function renderHtml(root, id, cfg) {
    var height = cfg.height != null ? cfg.height : 300;
    var doc =
      "<!doctype html><html><head><meta charset='utf-8'>" +
      "<style>html,body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}</style>" +
      "</head><body>" + (cfg.html || "") + "</body></html>";
    var ifr = document.createElement("iframe");
    // sandbox: скрипты работают, но без allow-same-origin — нет доступа к host-сайту.
    ifr.setAttribute("sandbox", "allow-scripts allow-popups allow-forms");
    ifr.setAttribute("loading", "lazy");
    ifr.style.cssText = "width:100%;border:0;display:block;height:" + height + "px";
    ifr.srcdoc = doc;
    root.appendChild(ifr);
    track(id, "impression");
  }

  // Разбор ссылки на видео: YouTube / Vimeo / прямой файл.
  function parseVideo(url) {
    url = String(url || "");
    var yt = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/.exec(url);
    if (yt) return { kind: "youtube", id: yt[1] };
    var vm = /vimeo\.com\/(?:video\/)?(\d+)/.exec(url);
    if (vm) return { kind: "vimeo", id: vm[1] };
    return { kind: "file", url: url };
  }

  function videoThumbHtml(v) {
    if (v.kind === "youtube") {
      var s = "https://www.youtube.com/embed/" + v.id + "?autoplay=1&mute=1&loop=1&playlist=" + v.id + "&controls=0&modestbranding=1&playsinline=1&rel=0&showinfo=0";
      return '<iframe class="thumb-media" src="' + s + '" frameborder="0" allow="autoplay" tabindex="-1"></iframe>';
    }
    if (v.kind === "vimeo") {
      var sv = "https://player.vimeo.com/video/" + v.id + "?background=1&autoplay=1&muted=1&loop=1";
      return '<iframe class="thumb-media" src="' + sv + '" frameborder="0" allow="autoplay" tabindex="-1"></iframe>';
    }
    return '<video class="thumb-media" src="' + esc(v.url) + '" autoplay muted loop playsinline></video>';
  }

  function videoModalHtml(v) {
    if (v.kind === "youtube") {
      var s = "https://www.youtube.com/embed/" + v.id + "?autoplay=1&loop=1&playlist=" + v.id + "&controls=1&rel=0&playsinline=1";
      return '<iframe src="' + s + '" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>';
    }
    if (v.kind === "vimeo") {
      var sv = "https://player.vimeo.com/video/" + v.id + "?autoplay=1&loop=1";
      return '<iframe src="' + sv + '" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>';
    }
    return '<video src="' + esc(v.url) + '" autoplay controls playsinline style="width:100%;height:100%;object-fit:contain;background:#000"></video>';
  }

  function renderVideo(root, id, cfg) {
    var v = parseVideo(cfg.videoUrl);
    var accent = cfg.accent || "#4338CA";
    var side = cfg.position === "bottom-left" ? "left:22px" : "right:22px";
    var seenKey = "wgt_video_closed_" + id;
    try { if (sessionStorage.getItem(seenKey)) { track(id, "impression", { suppressed: true }); return; } } catch (e) {}

    root.innerHTML =
      "<style>" + baseStyles() +
      ".vw{position:fixed;bottom:22px;" + side + ";z-index:2147483000;display:flex;align-items:center;gap:12px;opacity:0;transform:translateY(20px);transition:opacity .4s,transform .4s}" +
      ".vw.show{opacity:1;transform:none}" +
      (cfg.position === "bottom-left" ? "" : ".vw{flex-direction:row-reverse}") +
      ".circle{position:relative;width:86px;height:86px;border-radius:50%;overflow:hidden;cursor:pointer;flex:none;border:3px solid " + accent + ";box-shadow:0 8px 28px rgba(0,0,0,.28)}" +
      ".circle::after{content:'';position:absolute;inset:-3px;border-radius:50%;border:2px solid " + accent + ";animation:pulse 2s infinite}" +
      "@keyframes pulse{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.35);opacity:0}}" +
      ".thumb-media{position:absolute;top:50%;left:50%;width:177.78%;height:100%;transform:translate(-50%,-50%);pointer-events:none;object-fit:cover;border:0}" +
      ".play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;text-shadow:0 1px 4px rgba(0,0,0,.6);pointer-events:none}" +
      ".cap{background:#fff;border-radius:12px;padding:9px 13px;box-shadow:0 6px 24px rgba(0,0,0,.16);max-width:200px;cursor:pointer}" +
      ".cap .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:" + accent + ";font-weight:700}" +
      ".cap .ct{font-size:13px;color:#11151c;line-height:1.35;margin-top:2px}" +
      ".x{position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;background:#11151c;color:#fff;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center;z-index:2;box-shadow:0 2px 6px rgba(0,0,0,.3)}" +
      ".ov{position:fixed;inset:0;background:rgba(10,12,20,.8);z-index:2147483002;display:flex;align-items:center;justify-content:center;padding:20px}" +
      ".modal{position:relative;width:100%;max-width:760px}" +
      ".frame{position:relative;width:100%;padding-top:56.25%;background:#000;border-radius:14px;overflow:hidden}" +
      ".frame iframe,.frame video{position:absolute;inset:0;width:100%;height:100%}" +
      ".mx{position:absolute;top:-42px;right:0;background:none;color:#fff;font-size:30px;line-height:1;cursor:pointer}" +
      ".mcta{display:inline-block;margin-top:14px;padding:11px 22px;border-radius:9px;background:" + accent + ";color:#fff;font-weight:600;text-decoration:none}" +
      "</style>" +
      '<div class="vw">' +
      '<div class="circle" data-act="open"><button class="x" data-act="close">&times;</button>' + videoThumbHtml(v) + '<div class="play">▶</div></div>' +
      (cfg.caption || cfg.title
        ? '<div class="cap" data-act="open">' +
          (cfg.title ? '<div class="lbl">' + esc(cfg.title) + "</div>" : "") +
          (cfg.caption ? '<div class="ct">' + esc(cfg.caption) + "</div>" : "") +
          "</div>"
        : "") +
      "</div>";

    var vw = root.querySelector(".vw");

    function openModal() {
      var ov = document.createElement("div");
      ov.className = "ov";
      ov.innerHTML =
        '<div class="modal"><button class="mx" data-act="mclose">&times;</button>' +
        '<div class="frame">' + videoModalHtml(v) + "</div>" +
        (cfg.ctaText ? '<a class="mcta" href="' + esc(cfg.ctaUrl || "#") + '" data-act="mcta">' + esc(cfg.ctaText) + "</a>" : "") +
        "</div>";
      // модалка должна жить вне shadow контейнера виджета, чтобы быть строго поверх
      root.appendChild(ov);
      track(id, "click");
      ov.addEventListener("click", function (e) {
        if (e.target === ov || e.target.getAttribute("data-act") === "mclose") ov.remove();
        if (e.target.getAttribute("data-act") === "mcta") track(id, "click", { cta: true });
      });
    }

    root.querySelectorAll('[data-act="open"]').forEach(function (elx) {
      elx.addEventListener("click", function (e) {
        if (e.target.getAttribute("data-act") === "close") return;
        openModal();
      });
    });
    root.querySelector('[data-act="close"]').addEventListener("click", function (e) {
      e.stopPropagation();
      vw.style.display = "none";
      try { sessionStorage.setItem(seenKey, "1"); } catch (er) {}
      track(id, "close");
    });

    setTimeout(function () { vw.classList.add("show"); track(id, "open"); track(id, "impression"); }, (cfg.delaySeconds != null ? cfg.delaySeconds : 2) * 1000);
  }

  var RENDERERS = { form: renderForm, popup: renderPopup, social: renderSocial, html: renderHtml, video: renderVideo };

  /* ---------------- Загрузка одного виджета ---------------- */

  // Фиксированная обёртка для inline-виджета, закреплённого в углу экрана.
  // Позиционирование на обёртке (без shadow), изоляция — на внутреннем div (с shadow),
  // чтобы :host{all:initial} не сбрасывал position обёртки.
  function buildFloatWrapper(id, cfg) {
    var offsets = ({
      "bottom-right": "bottom:20px;right:20px",
      "bottom-left": "bottom:20px;left:20px",
      "top-right": "top:20px;right:20px",
      "top-left": "top:20px;left:20px",
    })[cfg.placement] || "bottom:20px;right:20px";
    var width = cfg.floatWidth ? Number(cfg.floatWidth) : 360;

    var wrapper = document.createElement("div");
    wrapper.style.cssText =
      "position:fixed !important;" +
      offsets.split(";").map(function (s) { return s + " !important"; }).join(";") + ";" +
      "width:" + width + "px;max-width:calc(100vw - 40px);z-index:2147483000 !important;";

    if (cfg.floatClosable !== false) {
      var x = document.createElement("button");
      x.textContent = "\u00D7";
      x.setAttribute("aria-label", "Закрыть");
      x.style.cssText =
        "position:absolute !important;top:-10px;right:-10px;width:26px;height:26px;padding:0;border:0;border-radius:50%;" +
        "background:#11151c !important;color:#fff !important;font:700 16px/1 sans-serif;cursor:pointer;z-index:1;box-shadow:0 2px 8px rgba(0,0,0,.3);";
      x.onclick = function () {
        wrapper.remove();
        try { sessionStorage.setItem("wgt_float_closed_" + id, "1"); } catch (e) {}
        track(id, "close");
      };
      wrapper.appendChild(x);
    }

    var inner = document.createElement("div");
    wrapper.appendChild(inner);
    return { wrapper: wrapper, inner: inner };
  }

  function mount(el, id) {
    if (el.__wgtMounted) return;
    el.__wgtMounted = true;

    fetch(API_BASE + "/api/v1/public/widgets/" + id + "/config", { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("config " + r.status);
        return r.json();
      })
      .then(function (data) {
        var renderer = RENDERERS[data.type];
        if (!renderer) throw new Error("Неизвестный тип: " + data.type);
        var cfg = data.config || {};
        var inlineTypes = data.type === "form" || data.type === "social" || data.type === "html";
        var floating = inlineTypes && cfg.placement && cfg.placement !== "inline";

        // Куда монтируем:
        // - popup/video: всегда поверх страницы (рендерер сам fixed);
        // - inline-виджет с placement-углом: в фиксированную обёртку поверх страницы;
        // - иначе: в контейнер на странице (в потоке).
        var shadowHost;
        if (data.type === "popup" || data.type === "video") {
          shadowHost = document.body.appendChild(document.createElement("div"));
        } else if (floating) {
          if (!window.__WIDGET_NO_TRACK) {
            try {
              if (sessionStorage.getItem("wgt_float_closed_" + id)) { track(id, "impression", { suppressed: true }); return; }
            } catch (e) {}
          }
          var wrap = buildFloatWrapper(id, cfg);
          document.body.appendChild(wrap.wrapper);
          shadowHost = wrap.inner;
        } else {
          shadowHost = el;
        }
        var shadow = shadowHost.attachShadow ? shadowHost.attachShadow({ mode: "open" }) : shadowHost;
        renderer(shadow, id, cfg);
      })
      .catch(function (err) {
        console.warn("[widget] не удалось загрузить " + id + ":", err.message);
      });
  }

  function init() {
    // 1) ID на самом теге <script>
    var selfId = SELF.getAttribute("data-widget-id");
    if (selfId) {
      var holder = document.createElement("div");
      SELF.parentNode.insertBefore(holder, SELF.nextSibling);
      mount(holder, selfId);
    }
    // 2) Контейнеры в DOM
    document.querySelectorAll("[data-widget-id]").forEach(function (el) {
      if (el === SELF) return;
      mount(el, el.getAttribute("data-widget-id"));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
