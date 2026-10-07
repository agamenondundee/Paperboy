(function () {
  "use strict";

  // ---- Façade illustrations -------------------------------------------
  // Simple SVG drawings, one per architectural style. Colours come from CSS.

  function windows(xs, y, w, h) {
    return xs.map((x) => `<rect class="win" x="${x}" y="${y}" width="${w}" height="${h}"/>`).join("");
  }

  function range(start, step, count) {
    return Array.from({ length: count }, (_, i) => start + i * step);
  }

  const FACADES = {
    elizabethan() {
      const towers = [60, 170, 280]
        .map((x) => `<rect class="wall" x="${x}" y="40" width="60" height="160"/>` +
          windows([x + 10, x + 34], 56, 16, 40) + windows([x + 10, x + 34], 112, 16, 40) +
          `<rect class="trim" x="${x - 4}" y="34" width="68" height="8"/>`)
        .join("");
      return `
        <rect class="wall" x="40" y="90" width="320" height="110"/>
        ${towers}
        ${windows([128, 238], 110, 24, 50)}
        <path class="door" d="M186 200v-34a14 14 0 0 1 28 0v34z"/>`;
    },

    baroque() {
      const cols = range(150, 22, 5).map((x) => `<rect class="trim" x="${x}" y="100" width="8" height="100"/>`).join("");
      return `
        <rect class="wall" x="30" y="110" width="340" height="90"/>
        <rect class="wall" x="130" y="80" width="140" height="120"/>
        <rect class="roof" x="182" y="40" width="36" height="20"/>
        <path class="roof" d="M170 80a30 30 0 0 1 60 0z"/>
        <rect class="roof" x="196" y="22" width="8" height="18"/>
        <path class="trim" d="M140 100 200 72 260 100z"/>
        ${cols}
        ${windows(range(44, 22, 4), 130, 12, 30)}
        ${windows(range(290, 22, 4), 130, 12, 30)}
        <rect class="trim" x="30" y="104" width="340" height="6"/>
        ${range(40, 30, 4).map((x) => `<circle class="trim" cx="${x}" cy="98" r="5"/>`).join("")}
        ${range(280, 30, 4).map((x) => `<circle class="trim" cx="${x}" cy="98" r="5"/>`).join("")}
        <path class="door" d="M190 200v-30a10 10 0 0 1 20 0v30z"/>`;
    },

    palladian() {
      const cols = range(160, 20, 5).map((x) => `<rect class="trim" x="${x}" y="110" width="7" height="80"/>`).join("");
      return `
        <rect class="wall" x="50" y="110" width="300" height="90"/>
        <rect class="wall" x="140" y="96" width="120" height="104"/>
        <path class="roof" d="M170 96a30 26 0 0 1 60 0z"/>
        <path class="trim" d="M150 110 200 82 250 110z"/>
        ${cols}
        <rect class="trim" x="146" y="190" width="108" height="10"/>
        ${windows(range(66, 22, 3), 128, 12, 26)}
        ${windows(range(290, 22, 3), 128, 12, 26)}
        ${windows(range(66, 22, 3), 166, 12, 22)}
        ${windows(range(290, 22, 3), 166, 12, 22)}
        <rect class="door" x="192" y="160" width="16" height="30"/>`;
    },

    gothic() {
      const battlements = (x, w, y) =>
        range(x, 12, Math.floor(w / 12)).map((bx) => `<rect class="wall" x="${bx}" y="${y - 8}" width="7" height="8"/>`).join("");
      const arch = (x, y) => `<path class="win" d="M${x} ${y + 34}v-24a8 8 0 0 1 16 0v24z"/>`;
      return `
        <rect class="wall" x="70" y="100" width="260" height="100"/>
        ${battlements(70, 260, 100)}
        <rect class="wall" x="40" y="60" width="50" height="140"/>
        ${battlements(40, 50, 60)}
        <rect class="wall" x="310" y="60" width="50" height="140"/>
        ${battlements(310, 50, 60)}
        <rect class="wall" x="176" y="40" width="48" height="160"/>
        <path class="roof" d="M172 40 200 6 228 40z"/>
        ${[50, 66, 320, 336].map((x) => arch(x, 80)).join("")}
        ${[50, 66, 320, 336].map((x) => arch(x, 140)).join("")}
        ${[100, 124, 148, 236, 260, 284].map((x) => arch(x, 120)).join("")}
        ${arch(192, 60)}
        <path class="door" d="M188 200v-30a12 14 0 0 1 24 0v30z"/>`;
    },

    modern() {
      return `
        <path class="rock" d="M60 200 90 150h80l20 50z"/>
        <rect class="wall" x="150" y="40" width="34" height="140"/>
        <rect class="trim" x="60" y="128" width="210" height="16"/>
        <rect class="win" x="90" y="144" width="140" height="18"/>
        <rect class="trim" x="130" y="82" width="200" height="14"/>
        <rect class="win" x="190" y="96" width="120" height="26"/>
        <rect class="trim" x="170" y="52" width="110" height="10"/>
        <rect class="win" x="186" y="62" width="80" height="20"/>
        <path class="water" d="M190 200h120v-6c-20 4-40-4-60 0s-40-4-60 0z"/>
        <rect class="water" x="230" y="162" width="20" height="38" opacity=".6"/>`;
    },
  };

  function facade(style) {
    const draw = FACADES[style] || FACADES.palladian;
    return `<svg viewBox="0 0 400 220" role="presentation" focusable="false">
      <rect class="ground" x="0" y="200" width="400" height="20"/>
      ${draw()}
    </svg>`;
  }

  // ---- Helpers ---------------------------------------------------------

  const $ = (sel) => document.querySelector(sel);
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const state = { region: "all", era: "all", query: "" };

  // ---- House grid ------------------------------------------------------

  function matches(house) {
    if (state.region !== "all" && house.region !== state.region) return false;
    if (state.era !== "all" && house.era !== state.era) return false;
    if (!state.query) return true;
    const haystack = [house.name, house.location, house.architect, house.builtFor, house.eraLabel]
      .join(" ")
      .toLowerCase();
    return haystack.includes(state.query);
  }

  function renderGrid() {
    const list = HOUSES.filter(matches).sort((a, b) => a.built - b.built);
    const grid = $("#house-grid");

    grid.innerHTML = list
      .map(
        (h) => `
        <li class="house-card" data-style="${h.style}">
          <button type="button" class="card-button" data-id="${h.id}" aria-haspopup="dialog">
            <div class="card-art" aria-hidden="true">${facade(h.style)}</div>
            <div class="card-body">
              <p class="card-meta">${escapeHtml(h.eraLabel)} · ${escapeHtml(String(h.built))}</p>
              <h3>${escapeHtml(h.name)}</h3>
              <p class="card-location">${escapeHtml(h.location)}</p>
              <p class="card-summary">${escapeHtml(h.summary)}</p>
              <span class="card-more">Read the story</span>
            </div>
          </button>
        </li>`
      )
      .join("");

    $("#result-count").textContent =
      list.length === HOUSES.length
        ? `Showing all ${list.length} houses`
        : list.length
          ? `Showing ${list.length} of ${HOUSES.length} houses`
          : "No houses match those filters. Try clearing the search.";
  }

  // ---- Timeline --------------------------------------------------------

  function renderTimeline() {
    const sorted = [...HOUSES].sort((a, b) => a.built - b.built);
    $("#timeline-list").innerHTML = sorted
      .map(
        (h) => `
        <li>
          <span class="tl-year">${h.built}</span>
          <button type="button" class="tl-link" data-id="${h.id}" aria-haspopup="dialog">${escapeHtml(h.name)}</button>
          <span class="tl-place">${escapeHtml(h.location)}</span>
        </li>`
      )
      .join("");
  }

  // ---- Dialog ----------------------------------------------------------

  const dialog = $("#house-dialog");
  let lastTrigger = null;

  function openHouse(id, trigger) {
    const h = HOUSES.find((x) => x.id === id);
    if (!h) return;
    lastTrigger = trigger || null;

    $("#dialog-art").innerHTML = facade(h.style);
    $("#dialog-art").dataset.style = h.style;
    $("#dialog-meta").textContent = `${h.eraLabel} · ${h.location}`;
    $("#dialog-title").textContent = h.name;
    $("#dialog-facts").innerHTML = [
      ["Built", h.dates],
      ["Architect", h.architect],
      ["Built for", h.builtFor],
    ]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`)
      .join("");
    $("#dialog-story").innerHTML = h.story.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
    $("#dialog-highlights").innerHTML = h.highlights.map((x) => `<li>${escapeHtml(x)}</li>`).join("");

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    history.replaceState(null, "", `#house-${h.id}`);
  }

  function closeHouse() {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener("close", () => {
    history.replaceState(null, "", location.pathname + location.search);
    if (lastTrigger) lastTrigger.focus();
  });
  dialog.querySelector(".dialog-close").addEventListener("click", closeHouse);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) closeHouse(); // click on the backdrop
  });

  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-id]");
    if (trigger) openHouse(trigger.dataset.id, trigger);
  });

  // ---- Filters ---------------------------------------------------------

  const eraSelect = $("#era-filter");
  ERAS.forEach((era) => {
    const opt = document.createElement("option");
    opt.value = era.id;
    opt.textContent = era.label;
    eraSelect.appendChild(opt);
  });
  eraSelect.addEventListener("change", () => {
    state.era = eraSelect.value;
    renderGrid();
  });

  $("#region-filter").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.region = chip.dataset.region;
    document.querySelectorAll("#region-filter .chip").forEach((c) => {
      c.setAttribute("aria-pressed", String(c === chip));
    });
    renderGrid();
  });

  $("#search").addEventListener("input", (e) => {
    state.query = e.target.value.trim().toLowerCase();
    renderGrid();
  });

  // ---- Theme toggle ----------------------------------------------------

  const root = document.documentElement;
  try {
    const saved = localStorage.getItem("theme");
    if (saved) root.dataset.theme = saved;
  } catch (_) {}

  $(".theme-toggle").addEventListener("click", () => {
    const dark =
      root.dataset.theme === "dark" ||
      (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    root.dataset.theme = dark ? "light" : "dark";
    try {
      localStorage.setItem("theme", root.dataset.theme);
    } catch (_) {}
  });

  // ---- Start -----------------------------------------------------------

  $(".hero-art").innerHTML = facade("palladian");
  renderGrid();
  renderTimeline();

  const deepLink = location.hash.match(/^#house-(.+)$/);
  if (deepLink) openHouse(deepLink[1]);
})();
