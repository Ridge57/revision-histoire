(function () {
  "use strict";

  const THEMES = window.THEMES;
  const ALL_THEMES = [...THEMES, { id: "melange", titre: "Grande chronologie", periode: "Toutes périodes" }];
  const QUESTIONS = window.QUESTIONS;
  const TYPES = [
    ["date", "Dates"], ["personnage", "Personnages"], ["lieu", "Lieux"],
    ["contexte", "Contexte"], ["chrono", "Chronologie"],
  ];
  const themeName = (id) => (ALL_THEMES.find((t) => t.id === id) || {}).titre || id;
  // Une couleur par période, de l'Antiquité à 1914.
  const COLORS = {
    grece: "#2b7fd4", macedoine: "#8b5cf6", "rome-orient": "#e0475b", "fin-rome": "#64748b",
    francs: "#0f9f87", capetiens: "#3554d1", "cent-ans": "#ea6a3f", renaissance: "#c2418f",
    absolutisme: "#2f9e44", revolution: "#0e8ab0", melange: "#475569",
  };
  const tc = (id) => `--tc:${COLORS[id] || "#3554d1"}`;
  const $app = document.getElementById("app");

  // ── Stockage local (progression) ──────────────────────────────
  const KEY = "revision-histoire:v1";
  const store = {
    load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
    save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* stockage indisponible */ } },
  };
  let data = store.load();
  data.stats = data.stats || {};       // id → { ok, ko, last }
  data.setup = data.setup || { themes: [], types: [], count: 10 };

  const record = (id, good) => {
    const s = data.stats[id] || { ok: 0, ko: 0, last: null };
    good ? s.ok++ : s.ko++;
    s.last = good;
    data.stats[id] = s;
    store.save(data);
  };
  const isMissed = (q) => data.stats[q.id] && data.stats[q.id].last === false;

  // ── Utilitaires ───────────────────────────────────────────────
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const h = (html) => { $app.innerHTML = html; window.scrollTo(0, 0); };

  // ── Navigation ────────────────────────────────────────────────
  let tab = "quiz";
  const tabs = document.querySelectorAll("nav.tabs button");
  tabs.forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));
  function go(t) {
    tab = t;
    tabs.forEach((b) => (b.dataset.tab === t ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    ({ quiz: renderSetup, fiches: renderFiches, progres: renderProgres })[t]();
  }
  document.getElementById("sub").textContent = `${QUESTIONS.length} questions · ${THEMES.length} thèmes`;

  // ── Écran de choix ────────────────────────────────────────────
  function pool(setup, onlyMissed) {
    return QUESTIONS.filter((q) =>
      (setup.themes.length === 0 || setup.themes.includes(q.t)) &&
      (setup.types.length === 0 || setup.types.includes(q.type)) &&
      (!onlyMissed || isMissed(q)));
  }

  function renderSetup() {
    const s = data.setup;
    const p = pool(s, false);
    const missed = pool(s, true).length;
    const allMissed = QUESTIONS.filter(isMissed).length;
    const chip = (group, id, label, extra = "") =>
      `<button class="chip" data-group="${group}" data-id="${id}" aria-pressed="${(group === "count" ? s.count === id : s[group].includes(id))}">${esc(label)}${extra}</button>`;

    h(`
      <div class="section-title">Thèmes <small style="text-transform:none;letter-spacing:0">(aucun = tous)</small></div>
      <div class="chips">${ALL_THEMES.map((t) => chip("themes", t.id, t.titre, `<small>${QUESTIONS.filter((q) => q.t === t.id).length}</small>`)
        .replace('class="chip"', `class="chip theme" style="${tc(t.id)}"`).replace(">" + esc(t.titre), `><span class="tc-dot"></span>${esc(t.titre)}`)).join("")}</div>

      <div class="section-title">Types de questions <small style="text-transform:none;letter-spacing:0">(aucun = tous)</small></div>
      <div class="chips">${TYPES.map(([id, l]) => chip("types", id, l)).join("")}</div>

      <div class="section-title">Nombre de questions</div>
      <div class="chips">${[10, 20, 40, 0].map((n) => chip("count", n, n === 0 ? "Toutes" : String(n))).join("")}</div>

      <div style="margin-top:24px;display:grid;gap:10px">
        <button class="btn" id="start" ${p.length ? "" : "disabled"}>Commencer · ${s.count && s.count < p.length ? s.count : p.length} questions</button>
        <button class="btn secondary" id="missed" ${missed ? "" : "disabled"}>Revoir mes erreurs${missed ? ` · ${missed}` : ""}</button>
      </div>
      <p class="hint">${p.length} questions correspondent à ta sélection.${allMissed ? ` ${allMissed} question${allMissed > 1 ? "s" : ""} ratée${allMissed > 1 ? "s" : ""} à revoir au total.` : ""}</p>
    `);

    $app.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
      const g = b.dataset.group;
      if (g === "count") s.count = Number(b.dataset.id);
      else { const id = b.dataset.id; s[g] = s[g].includes(id) ? s[g].filter((x) => x !== id) : [...s[g], id]; }
      store.save(data); renderSetup();
    }));
    $app.querySelector("#start").addEventListener("click", () => startQuiz(pool(s, false), s.count));
    $app.querySelector("#missed").addEventListener("click", () => startQuiz(pool(s, true), 0));
  }

  // ── Quiz ──────────────────────────────────────────────────────
  let run = null;

  function startQuiz(list, count) {
    // Les questions jamais vues ou ratées passent en priorité.
    const weight = (q) => { const st = data.stats[q.id]; if (!st) return 1; return st.last === false ? 0 : 2 + st.ok - st.ko; };
    let ordered = shuffle(list).sort((a, b) => weight(a) - weight(b));
    if (count) ordered = ordered.slice(0, count);
    run = { list: shuffle(ordered), i: 0, good: 0, missed: [] };
    renderQuestion();
  }

  function header() {
    const q = run.list[run.i];
    return `
      <div class="q-meta"><span><span class="badge">${esc(TYPES.find((t) => t[0] === q.type)[1])}</span> &nbsp;${esc(themeName(q.t))}</span><span>${run.i + 1} / ${run.list.length}</span></div>
      <div class="progress"><i style="width:${(run.i / run.list.length) * 100}%"></i></div>
      <div class="question">${esc(q.q)}</div>`;
  }

  function renderQuestion() {
    const q = run.list[run.i];
    if (q.type === "chrono") return renderChrono(q);
    const choices = shuffle([q.ok, ...q.bad]);
    h(`<div class="card themed" style="${tc(q.t)}">${header()}
      <div class="answers">${choices.map((c, k) => `<button class="answer" data-v="${esc(c)}"><span class="k">${"ABCD"[k]}</span><span>${esc(c)}</span></button>`).join("")}</div>
      <div id="fb"></div></div>`);
    $app.querySelectorAll(".answer").forEach((b) => b.addEventListener("click", () => {
      const good = b.dataset.v === q.ok;
      $app.querySelectorAll(".answer").forEach((x) => {
        x.disabled = true;
        if (x.dataset.v === q.ok) x.classList.add("ok");
        else if (x === b) x.classList.add("ko");
        else x.classList.add("dim");
      });
      finish(q, good, good ? "" : `Bonne réponse : ${q.ok}`);
    }));
  }

  function renderChrono(q) {
    const items = shuffle(q.order);
    const picked = [];
    h(`<div class="card themed" style="${tc(q.t)}">${header()}
      <div class="chrono-picked" id="picked"></div>
      <div class="chrono-pool" id="pool"></div>
      <div class="row" style="margin-top:14px"><button class="btn secondary" id="undo">Annuler</button><button class="btn" id="check" disabled>Valider</button></div>
      <div id="fb"></div></div>`);
    const $picked = $app.querySelector("#picked"), $pool = $app.querySelector("#pool");
    const draw = () => {
      $picked.innerHTML = picked.map((it, k) => `<div class="chrono-item"><span class="n">${k + 1}</span>${esc(it)}</div>`).join("");
      $pool.innerHTML = items.filter((it) => !picked.includes(it)).map((it) => `<button class="chrono-item" data-v="${esc(it)}">${esc(it)}</button>`).join("");
      $pool.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { picked.push(b.dataset.v); draw(); }));
      $app.querySelector("#check").disabled = picked.length !== items.length;
      $app.querySelector("#undo").disabled = picked.length === 0;
    };
    draw();
    $app.querySelector("#undo").addEventListener("click", () => { picked.pop(); draw(); });
    $app.querySelector("#check").addEventListener("click", () => {
      const good = picked.every((it, k) => it === q.order[k]);
      $picked.innerHTML = picked.map((it, k) => `<div class="chrono-item ${it === q.order[k] ? "ok" : "ko"}"><span class="n">${k + 1}</span>${esc(it)}</div>`).join("");
      $app.querySelector(".row").remove();
      finish(q, good, good ? "" : `Bon ordre : ${q.order.join(" → ")}`);
    });
  }

  function finish(q, good, correction) {
    record(q.id, good);
    if (good) run.good++; else run.missed.push(q);
    const last = run.i === run.list.length - 1;
    $app.querySelector("#fb").innerHTML = `
      <div class="feedback ${good ? "ok" : "ko"}">
        <strong>${good ? "Bonne réponse !" : "Pas tout à fait."}</strong>
        ${correction ? `<div style="margin-bottom:6px">${esc(correction)}</div>` : ""}
        <div>${esc(q.ex)}</div>
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn secondary" id="stop">Arrêter</button>
        <button class="btn" id="next">${last ? "Voir le résultat" : "Suivante"}</button>
      </div>`;
    const next = $app.querySelector("#next");
    next.focus({ preventScroll: true });
    next.scrollIntoView({ behavior: "smooth", block: "nearest" });
    next.addEventListener("click", () => { if (last) renderResult(); else { run.i++; renderQuestion(); } });
    $app.querySelector("#stop").addEventListener("click", () => { run.list = run.list.slice(0, run.i + 1); renderResult(); });
  }

  function renderResult() {
    const n = run.list.length, pct = Math.round((run.good / n) * 100);
    const msg = pct === 100 ? "Parfait !" : pct >= 80 ? "Très bien !" : pct >= 50 ? "Pas mal, continue !" : "Courage, on y retourne !";
    h(`
      <div class="card score"><div class="big">${run.good} / ${n}</div><div>${msg}</div></div>
      <div style="margin-top:14px;display:grid;gap:10px">
        ${run.missed.length ? `<button class="btn" id="redo">Refaire mes ${run.missed.length} erreur${run.missed.length > 1 ? "s" : ""}</button>` : ""}
        <button class="btn secondary" id="home">Nouvelle série</button>
      </div>
      ${run.missed.length ? `<div class="section-title">À revoir</div><div class="missed">${run.missed.map((q) => `
        <div class="card"><div class="q">${esc(q.q)}</div><div class="a">${esc(q.type === "chrono" ? q.order.join(" → ") : q.ok)}</div><p class="hint">${esc(q.ex)}</p></div>`).join("")}</div>` : ""}
    `);
    const redo = $app.querySelector("#redo");
    if (redo) redo.addEventListener("click", () => startQuiz(run.missed, 0));
    $app.querySelector("#home").addEventListener("click", renderSetup);
  }

  // ── Fiches ────────────────────────────────────────────────────
  function renderFiches() {
    h(`
      <p class="hint" style="margin-top:16px">Tes notes, remises au propre et classées par période.</p>
      <div style="margin-top:12px">${THEMES.map((t) => `
        <details class="fiche card" style="${tc(t.id)}">
          <summary><h3><span class="tc-dot"></span>${esc(t.titre)}</h3><span class="per">${esc(t.periode)}</span></summary>
          ${t.fiche.map(([d, txt]) => `<div class="entry"><div class="d">${esc(d)}</div><p>${esc(txt)}</p></div>`).join("")}
          <button class="btn secondary" style="margin-top:12px" data-quiz="${t.id}">Réviser ce thème</button>
        </details>`).join("")}</div>
    `);
    $app.querySelectorAll("[data-quiz]").forEach((b) => b.addEventListener("click", () => {
      data.setup.themes = [b.dataset.quiz]; data.setup.types = []; store.save(data); go("quiz");
    }));
  }

  // ── Progrès ───────────────────────────────────────────────────
  function renderProgres() {
    const seen = QUESTIONS.filter((q) => data.stats[q.id]);
    if (!seen.length) {
      h(`<div class="card empty" style="margin-top:16px">Aucune question encore faite.<br />Ta progression s'affichera ici.<br /><br /><button class="btn" id="go" style="width:auto">Commencer à réviser</button></div>`);
      $app.querySelector("#go").addEventListener("click", () => go("quiz"));
      return;
    }
    const row = (label, list) => {
      const ok = list.filter((q) => data.stats[q.id] && data.stats[q.id].last === true).length;
      const ko = list.filter(isMissed).length;
      const n = list.length;
      return `<div class="stat"><div class="lbl">${esc(label)}<span>${ok} sue${ok > 1 ? "s" : ""} · ${ko} à revoir · ${n - ok - ko} jamais vue${n - ok - ko > 1 ? "s" : ""}</span></div>
        <div class="bar"><div class="g" style="width:${(ok / n) * 100}%"></div><div class="r" style="width:${(ko / n) * 100}%"></div></div></div>`;
    };
    h(`
      <div class="card" style="margin-top:16px">
        ${row("Toutes les questions", QUESTIONS)}
        <div class="legend"><span><i style="background:var(--ok)"></i>Sue (dernière réponse juste)</span><span><i style="background:var(--ko)"></i>À revoir</span></div>
      </div>
      <div class="section-title">Par thème</div>
      <div class="card">${ALL_THEMES.map((t) => row(t.titre, QUESTIONS.filter((q) => q.t === t.id))).join("")}</div>
      <p class="hint" style="text-align:center;margin-top:18px">La progression est enregistrée sur cet appareil. <button class="link" id="reset">Tout remettre à zéro</button></p>
    `);
    $app.querySelector("#reset").addEventListener("click", () => {
      if (confirm("Effacer toute ta progression sur cet appareil ?")) { data.stats = {}; store.save(data); renderProgres(); }
    });
  }

  go("quiz");
})();
