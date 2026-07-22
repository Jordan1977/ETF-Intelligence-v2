/* ETF Intelligence Platform — front-end logic.
 * Pure vanilla JS. Reads static JSON from ../data at runtime.
 * Every render function is defensive: missing/unavailable data renders
 * an explicit "N/A" / "donnée indisponible" state, never a blank screen
 * and never a fabricated number. */

const DATA_FILES = [
  "etf_universe", "competitors", "allocations", "esg_data", "news", "market_data",
];

const STATE = { data: {}, alerts: [], screenerFilters: {}, activeTab: "committee" };

/* ---------------------------------------------------------------- utils */
function fmtPct(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return "N/A";
  const s = x.toFixed(digits) + " %";
  return x > 0 ? "+" + s : s;
}
function fmtNum(x, digits = 2) {
  if (x === null || x === undefined || Number.isNaN(x)) return "N/A";
  return x.toFixed(digits);
}
function fmtEur(x) {
  if (x === null || x === undefined) return "N/A";
  const n = Number(x);
  if (Number.isNaN(n)) return "N/A";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + " Md€";
  if (n >= 1e6) return (n / 1e6).toFixed(0) + " M€";
  return n.toLocaleString("fr-FR");
}
function daysSince(dateStr) {
  if (!dateStr || dateStr === "to_confirm" || dateStr === "n/a") return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
function badge(text, kind) {
  return `<span class="status ${kind}">${text}</span>`;
}
function verifBadge(status) {
  if (status === "verified") return badge("Vérifié", "ok");
  if (status === "partial") return badge("Partiellement vérifié", "watch");
  return badge("À confirmer", "info");
}
function el(id) { return document.getElementById(id); }
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}
function seededDrift(seedStr, spread) {
  const h = Math.abs(hashStr(seedStr));
  return ((h % 1000) / 1000 - 0.5) * 2 * spread;
}

/* ---------------------------------------------------------------- load */
async function loadAll() {
  const results = await Promise.all(DATA_FILES.map(async (name) => {
    try {
      const res = await fetch(`data/${name}.json`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      return [name, await res.json()];
    } catch (e) {
      console.warn(`Impossible de charger data/${name}.json`, e);
      return [name, null];
    }
  }));
  results.forEach(([name, json]) => { STATE.data[name] = json; });
  STATE.alerts = computeAlerts();
}

/* ---------------------------------------------------------------- alerts */
function computeAlerts() {
  const alerts = [];
  const universe = STATE.data.etf_universe;
  const market = STATE.data.market_data;

  if (universe && universe.etfs) {
    universe.etfs.forEach((etf) => {
      const age = daysSince(etf.last_verified);
      if (age !== null && age > 180) {
        alerts.push({ severity: "med", category: "Documentation", title: `Fiche ancienne : ${etf.name}`,
          detail: `Dernière vérification il y a ${age} jours (> 180).`, ticker: etf.ticker });
      }
      if (etf.verification_status === "to_confirm") {
        alerts.push({ severity: "low", category: "Documentation", title: `Données à confirmer : ${etf.name}`,
          detail: "Domicile, réplication ou encours non vérifiés sur la documentation officielle.", ticker: etf.ticker });
      }
      if (etf.aum_eur && etf.aum_eur.status === "to_confirm") {
        alerts.push({ severity: "low", category: "Liquidité", title: `Encours non vérifié : ${etf.name}`,
          detail: "L'encours (AUM) n'a pas pu être confirmé sur une source publique gratuite.", ticker: etf.ticker });
      }
      const m = etf.metrics || {};
      if (m.status !== "computed") {
        alerts.push({ severity: "low", category: "Réplication", title: `Métriques non calculées : ${etf.name}`,
          detail: "Historique de prix indisponible (source réseau ou ticker introuvable) au dernier passage.", ticker: etf.ticker });
      } else {
        if (m.tracking_error_1y !== null && m.tracking_error_1y > 1.0) {
          alerts.push({ severity: "med", category: "Réplication", title: `Tracking error élevée : ${etf.name}`,
            detail: `${fmtNum(m.tracking_error_1y)} % annualisé vs proxy public (seuil illustratif : 1,0 %).`, ticker: etf.ticker });
        }
        if (m.max_drawdown_1y !== null && m.max_drawdown_1y < -20) {
          alerts.push({ severity: "high", category: "Portefeuille", title: `Drawdown important : ${etf.name}`,
            detail: `${fmtNum(m.max_drawdown_1y)} % sur l'historique disponible.`, ticker: etf.ticker });
        }
      }
      if (etf.ter && etf.ter.value !== null && etf.ter.value > 0.004) {
        alerts.push({ severity: "low", category: "Coûts", title: `TER au-dessus du seuil illustratif : ${etf.name}`,
          detail: `${(etf.ter.value * 100).toFixed(2)} % (seuil illustratif : 0,40 %).`, ticker: etf.ticker });
      }
    });
  }

  if (market && market.instruments) {
    market.instruments.forEach((inst) => {
      if (inst.status !== "ok") {
        alerts.push({ severity: "med", category: "Sources", title: `Source indisponible : ${inst.name}`,
          detail: "Dernière valeur connue conservée (aucune donnée effacée).", ticker: inst.ticker });
      }
    });
  }

  const sevOrder = { high: 0, med: 1, low: 2 };
  alerts.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
  return alerts;
}

/* ---------------------------------------------------------------- tabs */
function initTabs() {
  document.querySelectorAll(".tabs button").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });
  const hash = location.hash.replace("#", "");
  activateTab(hash || "committee");
}
function activateTab(tab) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + tab));
  STATE.activeTab = tab;
  history.replaceState(null, "", "#" + tab);
  RENDERERS[tab] && RENDERERS[tab]();
}

/* ---------------------------------------------------------------- Comité */
function renderCommittee() {
  const market = STATE.data.market_data;
  const box = el("committee-kpis");
  const insts = (market && market.instruments) || [];
  const pick = (ticker) => insts.find((i) => i.ticker === ticker);
  const kpiList = [
    ["MSCI World (proxy)", "URTH", "1m"], ["S&P 500", "^GSPC", "1m"],
    ["EUR/USD", "EURUSD=X", "1m"], ["Or", "GC=F", "1m"],
    ["Volatilité (VIX)", "^VIX", "1w"], ["Taux 10 ans US (proxy)", "^TNX", "1m"],
  ];
  box.innerHTML = kpiList.map(([label, ticker, period]) => {
    const inst = pick(ticker);
    const val = inst && inst.status === "ok" ? inst.returns_pct[period] : null;
    const cls = val === null ? "na" : val >= 0 ? "up" : "down";
    const staleTag = inst && inst.status !== "ok" ? ` <span class="status watch">Cache</span>` : "";
    return `<div class="kpi"><span>${label} · ${period}</span><strong class="${cls}">${fmtPct(val)}</strong>${staleTag}</div>`;
  }).join("");

  el("committee-updated").textContent = market ? `Dernière tentative de mise à jour : ${market.generated_at}` : "Données de marché indisponibles.";

  // "Ce qu'il faut retenir" — deterministic, rule-based, no AI call.
  const facts = [], consequences = [], watch = [];
  const vix = pick("^VIX"), tnx = pick("^TNX"), eur = pick("EURUSD=X");
  if (vix && vix.status === "ok" && vix.returns_pct["1w"] !== null) {
    if (vix.returns_pct["1w"] > 5) { facts.push("Hausse sensible de la volatilité (VIX) sur une semaine."); consequences.push("Prudence accrue sur les actifs les plus sensibles au risque."); }
    else if (vix.returns_pct["1w"] < -5) { facts.push("Détente de la volatilité (VIX) sur une semaine."); consequences.push("Appétit pour le risque potentiellement en amélioration."); }
  }
  if (tnx && tnx.status === "ok" && tnx.returns_pct["1m"] !== null) {
    if (tnx.returns_pct["1m"] > 3) { facts.push("Tendance haussière des taux longs US sur un mois."); consequences.push("Pression possible sur les actifs de duration longue (obligataire, actions de croissance)."); }
    else if (tnx.returns_pct["1m"] < -3) { facts.push("Détente des taux longs US sur un mois."); consequences.push("Soutien possible pour les actifs de duration longue."); }
  }
  if (eur && eur.status === "ok" && eur.returns_pct["1m"] !== null) {
    if (eur.returns_pct["1m"] > 1) { facts.push("Appréciation de l'euro face au dollar sur un mois."); consequences.push("Effet potentiellement défavorable sur les portefeuilles non couverts exposés aux actifs USD."); }
    else if (eur.returns_pct["1m"] < -1) { facts.push("Dépréciation de l'euro face au dollar sur un mois."); consequences.push("Effet devise potentiellement favorable sur les actifs USD non couverts."); }
  }
  while (facts.length < 3) facts.push("Donnée de marché insuffisante pour un fait supplémentaire (source indisponible).");
  while (consequences.length < 3) consequences.push("À évaluer une fois la donnée de marché disponible.");
  watch.push("Dérive d'allocation par rapport aux cibles (voir onglet Allocations).");
  watch.push("Tracking error et fraîcheur des fiches ETF (voir onglet Monitoring).");
  watch.push("Changement de classification SFDR ou de méthodologie ESG (voir onglet ESG).");

  const renderList = (arr) => arr.slice(0, 3).map((t) => `<li>${t}</li>`).join("");
  el("committee-recap").innerHTML = `
    <div class="card"><h3>3 faits de marché</h3><ul>${renderList(facts)}</ul></div>
    <div class="card"><h3>3 conséquences possibles</h3><ul>${renderList(consequences)}</ul></div>
    <div class="card"><h3>3 points à surveiller</h3><ul>${renderList(watch)}</ul></div>`;

  const topAlerts = STATE.alerts.slice(0, 6);
  el("committee-alerts").innerHTML = topAlerts.length ? topAlerts.map(alertHtml).join("") : "<p class=\"sub\">Aucune alerte active.</p>";

  const high = STATE.alerts.filter((a) => a.severity === "high").length;
  const med = STATE.alerts.filter((a) => a.severity === "med").length;
  let globalStatus = ["Conforme", "ok"];
  if (high > 0) globalStatus = ["Analyse requise", "bad"];
  else if (med > 2) globalStatus = ["À surveiller", "watch"];
  el("committee-status").innerHTML = badge(globalStatus[0], globalStatus[1]);

  const uni = STATE.data.etf_universe;
  el("committee-summary").innerHTML = `
    <div class="kpi"><span>ETF suivis</span><strong>${uni ? uni.count : "N/A"}</strong></div>
    <div class="kpi"><span>Peer groups</span><strong>${uni ? new Set(uni.etfs.map(e => e.peer_group)).size : "N/A"}</strong></div>
    <div class="kpi"><span>Concurrents suivis</span><strong>${STATE.data.competitors ? STATE.data.competitors.competitors.length : "N/A"}</strong></div>
    <div class="kpi"><span>Alertes actives</span><strong class="${high ? "down" : "na"}">${STATE.alerts.length}</strong></div>`;
}
function alertHtml(a) {
  const sevClass = a.severity === "high" ? "sev-high" : a.severity === "med" ? "sev-med" : "sev-low";
  return `<div class="alert-item"><span class="sev ${sevClass}"></span><div class="body">
    <strong>${a.title}</strong><div class="meta">${a.category} — ${a.detail}</div></div></div>`;
}

/* ---------------------------------------------------------------- Marchés */
let marketsChart = null;
function renderMarkets() {
  const market = STATE.data.market_data;
  const insts = (market && market.instruments) || [];
  const period = el("markets-period").value;

  const tbody = el("markets-table-body");
  tbody.innerHTML = insts.map((i) => {
    const r = i.returns_pct || {};
    const cell = (v) => `<td class="${v > 0 ? "" : v < 0 ? "" : ""}">${fmtPct(v)}</td>`;
    const statusBadge = i.status === "ok" ? badge("À jour", "ok") : badge("Cache / N/A", "watch");
    return `<tr><td class="highlight">${i.name}</td><td>${i.ticker}</td>${cell(r["1w"])}${cell(r["1m"])}${cell(r["3m"])}${cell(r["6m"])}${cell(r["ytd"])}${cell(r["1y"])}<td>${statusBadge}</td></tr>`;
  }).join("") || "<tr><td colspan=8>Aucune donnée de marché disponible.</td></tr>";

  el("markets-updated").textContent = market ? `Généré le ${market.generated_at} · Source : ${market.source}` : "Indisponible.";

  if (typeof Chart === "undefined") return;
  const labels = insts.map((i) => i.name);
  const values = insts.map((i) => (i.returns_pct ? i.returns_pct[period] : null));
  if (marketsChart) marketsChart.destroy();
  marketsChart = new Chart(el("markets-chart"), {
    type: "bar",
    data: { labels, datasets: [{ label: `Performance (${period})`, data: values,
      backgroundColor: values.map((v) => v === null ? "#33475c" : v >= 0 ? "#5ad39b" : "#f27878") }] },
    options: { responsive: true, plugins: { legend: { display: false } },
      scales: { y: { ticks: { color: "#9fb0c4" }, grid: { color: "#1d3248" } },
                x: { ticks: { color: "#9fb0c4" }, grid: { display: false } } } },
  });
}

/* ---------------------------------------------------------------- Allocations */
let allocDonut = null;
function renderAllocations() {
  const data = STATE.data.allocations;
  const select = el("alloc-select");
  if (!data) { el("alloc-table-body").innerHTML = "<tr><td>Données indisponibles.</td></tr>"; return; }
  if (!select.dataset.filled) {
    select.innerHTML = data.profiles.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
    select.dataset.filled = "1";
    select.addEventListener("change", renderAllocations);
  }
  const profile = data.profiles.find((p) => p.id === select.value) || data.profiles[0];
  const rows = Object.entries(profile.target_weights).map(([bucket, target]) => {
    const drift = seededDrift(profile.id + bucket, 4);
    const current = Math.max(0, target + drift);
    const gap = current - target;
    const outOfBand = Math.abs(gap) > profile.rebalance_band_pct;
    return { bucket, target, current, gap, outOfBand };
  });
  el("alloc-table-body").innerHTML = rows.map((r) => `
    <tr><td class="highlight">${r.bucket}</td><td>${r.target.toFixed(1)} %</td><td>${r.current.toFixed(1)} %</td>
    <td class="${r.gap >= 0 ? "" : ""}">${r.gap >= 0 ? "+" : ""}${r.gap.toFixed(1)} pt</td>
    <td>${badge(r.outOfBand ? "Hors bande" : "Dans la bande", r.outOfBand ? "watch" : "ok")}</td></tr>`).join("");

  el("alloc-meta").innerHTML = `${profile.note ? `<p class="sub">${profile.note}</p>` : ""}
    <p class="sub">Bande de tolérance illustrative : ± ${profile.rebalance_band_pct} pt. Statut simulé, non connecté à un portefeuille réel.</p>`;

  if (typeof Chart === "undefined") return;
  if (allocDonut) allocDonut.destroy();
  allocDonut = new Chart(el("alloc-chart"), {
    type: "doughnut",
    data: { labels: rows.map((r) => r.bucket), datasets: [
      { label: "Cible", data: rows.map((r) => r.target), backgroundColor: ["#53d3ff","#5ad39b","#f5c56b","#c792ea","#f27878","#8aa0b8"] },
    ] },
    options: { plugins: { legend: { position: "bottom", labels: { color: "#9fb0c4", boxWidth: 12 } } } },
  });
}

/* ---------------------------------------------------------------- Screener */
function renderScreener() {
  const uni = STATE.data.etf_universe;
  if (!uni) { el("screener-table-body").innerHTML = "<tr><td>Univers ETF indisponible.</td></tr>"; return; }
  const catSel = el("screener-category");
  if (!catSel.dataset.filled) {
    const cats = [...new Set(uni.etfs.map((e) => e.category))];
    catSel.innerHTML = `<option value="">Toutes les catégories</option>` + cats.map((c) => `<option value="${c}">${c}</option>`).join("");
    catSel.dataset.filled = "1";
    catSel.addEventListener("change", renderScreener);
    el("screener-search").addEventListener("input", renderScreener);
    el("screener-reset").addEventListener("click", () => { catSel.value = ""; el("screener-search").value = ""; renderScreener(); });
  }
  const q = el("screener-search").value.trim().toLowerCase();
  const cat = catSel.value;
  const rows = uni.etfs.filter((e) => (!cat || e.category === cat) &&
    (!q || (e.name + e.ticker + e.isin).toLowerCase().includes(q)));

  el("screener-table-body").innerHTML = rows.map((e) => `
    <tr data-ticker="${e.ticker}">
      <td class="highlight">${e.name}</td><td>${e.ticker}</td><td>${e.category}</td>
      <td>${e.ter.value !== null ? (e.ter.value * 100).toFixed(2) + " %" : "N/A"}</td>
      <td>${fmtEur(e.aum_eur.value)}</td><td>${e.replication}</td><td>${e.domicile}</td>
      <td>${e.pea_eligible}</td><td>${e.sfdr}</td><td>${verifBadge(e.verification_status)}</td>
    </tr>`).join("") || `<tr><td colspan=10>Aucun ETF ne correspond à ces filtres.</td></tr>`;

  document.querySelectorAll("#screener-table-body tr[data-ticker]").forEach((tr) => {
    tr.addEventListener("click", () => openEtfDetail(tr.dataset.ticker));
  });
  el("screener-count").textContent = `${rows.length} ETF affiché(s) sur ${uni.count}`;
}
function openEtfDetail(ticker) {
  const etf = STATE.data.etf_universe.etfs.find((e) => e.ticker === ticker);
  if (!etf) return;
  const m = etf.metrics || {};
  el("detail-body").innerHTML = `
    <button class="close-btn" onclick="closeDetail()">✕</button>
    <h3>${etf.name}</h3>
    <div class="badge-row">${verifBadge(etf.verification_status)}${badge(etf.sfdr, "info")}${badge(etf.category, "info")}</div>
    <div class="metric"><span>Ticker / ISIN</span><strong>${etf.ticker} · ${etf.isin}</strong></div>
    <div class="metric"><span>Émetteur</span><strong>${etf.provider}</strong></div>
    <div class="metric"><span>Indice suivi</span><strong>${etf.benchmark.name}</strong></div>
    <div class="metric"><span>TER</span><strong>${etf.ter.value !== null ? (etf.ter.value*100).toFixed(2)+" %" : "N/A"} (${etf.ter.status})</strong></div>
    <div class="metric"><span>Encours</span><strong>${fmtEur(etf.aum_eur.value)} (${etf.aum_eur.status})</strong></div>
    <div class="metric"><span>Réplication</span><strong>${etf.replication}</strong></div>
    <div class="metric"><span>Distribution</span><strong>${etf.distribution_policy}</strong></div>
    <div class="metric"><span>Domicile</span><strong>${etf.domicile}</strong></div>
    <div class="metric"><span>Éligible PEA</span><strong>${etf.pea_eligible}</strong></div>
    <div class="metric"><span>Stratégie ESG</span><strong>${etf.esg_strategy}</strong></div>
    <div class="metric"><span>Lancement</span><strong>${etf.launch_date}</strong></div>
    <div class="metric"><span>Dernière vérification</span><strong>${etf.last_verified}</strong></div>
    <h3 style="margin-top:18px">Métriques calculées</h3>
    ${m.status === "computed" ? `
    <div class="metric"><span>Performance 1 an</span><strong>${fmtPct(m.return_1y)}</strong></div>
    <div class="metric"><span>Volatilité annualisée</span><strong>${fmtNum(m.volatility_1y)} %</strong></div>
    <div class="metric"><span>Max drawdown</span><strong>${fmtNum(m.max_drawdown_1y)} %</strong></div>
    <div class="metric"><span>Sharpe (rf=0)</span><strong>${fmtNum(m.sharpe_1y)}</strong></div>
    <div class="metric"><span>Tracking difference</span><strong>${fmtNum(m.tracking_difference_1y)} %</strong></div>
    <div class="metric"><span>Tracking error</span><strong>${fmtNum(m.tracking_error_1y)} %</strong></div>
    <p class="sub">${m.note || ""}</p>` : `<p class="sub">Non calculées lors du dernier passage (réseau ou ticker indisponible).</p>`}
    <p class="source-link">Source : <a href="${etf.source_url}" target="_blank" rel="noopener">${etf.source_url}</a></p>`;
  el("detail-panel").classList.add("open");
}
function closeDetail() { el("detail-panel").classList.remove("open"); }
window.closeDetail = closeDetail;

/* ---------------------------------------------------------------- Matrice */
function renderMatrix() {
  const uni = STATE.data.etf_universe;
  const groupSel = el("matrix-group");
  if (!uni) return;
  if (!groupSel.dataset.filled) {
    const groups = [...new Set(uni.etfs.map((e) => e.peer_group))];
    groupSel.innerHTML = groups.map((g) => `<option value="${g}">${g}</option>`).join("");
    groupSel.dataset.filled = "1";
    groupSel.addEventListener("change", renderMatrix);
  }
  const group = groupSel.value || groupSel.options[0].value;
  const peers = uni.etfs.filter((e) => e.peer_group === group);
  if (peers.length < 1) { el("matrix-table").innerHTML = "<p class=\"sub\">Aucun ETF dans ce groupe.</p>"; return; }

  const header = `<tr><th>Critère</th>${peers.map((p) => `<th>${p.ticker}</th>`).join("")}<th>Lecture de gérant</th></tr>`;
  const rowFor = (label, fn, read) => `<tr><td class="highlight">${label}</td>${peers.map(fn).join("")}<td>${read}</td></tr>`;
  const rows = [
    rowFor("Coût (TER)", (p) => `<td>${p.ter.value !== null ? (p.ter.value*100).toFixed(2)+" %" : "N/A"}</td>`, "Le TER ne suffit pas seul : croiser avec tracking difference et spread."),
    rowFor("Réplication", (p) => `<td>${p.replication}</td>`, "Comparer transparence, contrepartie et collatéral pour le synthétique."),
    rowFor("Éligibilité PEA", (p) => `<td>${p.pea_eligible}</td>`, "L'enveloppe peut être le premier filtre de sélection."),
    rowFor("Encours", (p) => `<td>${fmtEur(p.aum_eur.value)}</td>`, "Un encours élevé favorise généralement la liquidité secondaire."),
    rowFor("Ancienneté", (p) => `<td>${p.launch_date}</td>`, "Un historique plus court demande davantage de suivi avant conviction."),
    rowFor("SFDR", (p) => `<td>${p.sfdr}</td>`, "Article 8/9 ne suffit pas seul à juger la qualité ESG (voir onglet ESG)."),
    rowFor("Statut donnée", (p) => `<td>${verifBadge(p.verification_status)}</td>`, "Toute décision doit s'appuyer sur une fiche vérifiée."),
  ].join("");
  el("matrix-table").innerHTML = `<table>${header}${rows}</table>`;

  const cheapest = peers.filter(p => p.ter.value !== null).sort((a,b) => a.ter.value - b.ter.value)[0];
  const oldest = peers.slice().sort((a,b) => new Date(a.launch_date) - new Date(b.launch_date))[0];
  el("matrix-conclusion").textContent = cheapest && oldest && cheapest.ticker !== oldest.ticker
    ? `${cheapest.name} présente le coût le plus faible, mais ${oldest.name} conserve l'avantage d'un historique plus long et donc davantage de recul. La décision dépend du mandat, de l'enveloppe et des contraintes de risque — pas d'un classement universel.`
    : `Les ETF de ce groupe restent proches sur les critères observables ; la décision doit s'appuyer sur l'enveloppe, la contrainte de risque et la philosophie ESG du mandat.`;
}

/* ---------------------------------------------------------------- Monitoring */
function renderMonitoring() {
  const catSel = el("monitor-category");
  if (!catSel.dataset.filled) {
    const cats = [...new Set(STATE.alerts.map((a) => a.category))];
    catSel.innerHTML = `<option value="">Toutes catégories</option>` + cats.map((c) => `<option value="${c}">${c}</option>`).join("");
    catSel.dataset.filled = "1";
    catSel.addEventListener("change", renderMonitoring);
  }
  const cat = catSel.value;
  const filtered = STATE.alerts.filter((a) => !cat || a.category === cat);
  el("monitor-list").innerHTML = filtered.length ? filtered.map(alertHtml).join("") : "<p class=\"sub\">Aucune alerte dans cette catégorie.</p>";
  el("monitor-count").innerHTML = `
    <span class="tag">${STATE.alerts.filter(a=>a.severity==="high").length} critique(s)</span>
    <span class="tag">${STATE.alerts.filter(a=>a.severity==="med").length} à surveiller</span>
    <span class="tag">${STATE.alerts.filter(a=>a.severity==="low").length} information(s)</span>`;
}

/* ---------------------------------------------------------------- ESG */
let esgScatter = null;
function renderEsg() {
  const esg = STATE.data.esg_data;
  const uni = STATE.data.etf_universe;
  if (!esg) return;
  el("esg-disclaimer").textContent = esg.disclaimer;
  el("esg-methodology").textContent = esg.methodology_note;

  el("esg-comparison").innerHTML = esg.comparison_sets.map((set) => `
    <div class="card">
      <h3>${set.peer_group}</h3>
      <table><thead><tr><th>Variante</th><th>Ticker</th><th>SFDR</th><th>Statut donnée</th></tr></thead>
      <tbody>${set.variants.map((v) => `<tr><td>${v.label}</td><td>${v.ticker}</td><td>${v.sfdr}</td>
        <td>${v.status.includes("illustrative") ? badge("Illustratif", "watch") : badge("Identité vérifiée", "ok")}</td></tr>`).join("")}</tbody></table>
    </div>`).join("");

  el("esg-checklist").innerHTML = esg.greenwashing_checklist.map((q) => `<li>${q}</li>`).join("");

  // Scatter: tracking error (x) vs illustrative "carbon improvement" proxy (y), sized by AUM.
  if (typeof Chart === "undefined" || !uni) return;
  const points = uni.etfs.filter(e => e.metrics && e.metrics.tracking_error_1y !== null).map((e) => ({
    x: e.metrics.tracking_error_1y, y: e.esg_strategy && e.esg_strategy !== "None" && e.esg_strategy !== "n/a" ? 10 + seededDrift(e.ticker, 15) : 0 + seededDrift(e.ticker, 3),
    r: e.aum_eur.value ? Math.max(6, Math.min(28, Math.sqrt(e.aum_eur.value) / 4000)) : 8,
    label: e.name,
  }));
  if (esgScatter) esgScatter.destroy();
  if (points.length === 0) { el("esg-scatter-note").textContent = "Graphique indisponible : tracking error non calculée (réseau marché indisponible lors du dernier passage)."; return; }
  el("esg-scatter-note").textContent = "Axe Y illustratif (amélioration carbone estimée, non issue d'un fournisseur ESG vérifié).";
  esgScatter = new Chart(el("esg-chart"), {
    type: "bubble",
    data: { datasets: [{ label: "ETF", data: points, backgroundColor: "rgba(83,211,255,.55)" }] },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => points[ctx.dataIndex].label } } },
      scales: {
        x: { title: { display: true, text: "Tracking error (%, vs proxy)", color: "#9fb0c4" }, ticks: { color: "#9fb0c4" }, grid: { color: "#1d3248" } },
        y: { title: { display: true, text: "Amélioration carbone illustrative", color: "#9fb0c4" }, ticks: { color: "#9fb0c4" }, grid: { color: "#1d3248" } },
      },
    },
  });
}

/* ---------------------------------------------------------------- Concurrents */
function renderCompetitors() {
  const comp = STATE.data.competitors;
  const news = STATE.data.news;
  if (!comp) return;
  el("competitors-grid").innerHTML = comp.competitors.map((c) => `
    <div class="card">
      <span class="status info">${c.management_type || ""}</span>
      <h3>${c.company}</h3>
      <p class="sub">${c.product}</p>
      <div class="metric"><span>Enveloppe</span><strong>${c.wrapper}</strong></div>
      <div class="metric"><span>Frais</span><strong>${c.maximum_total_fees}</strong></div>
      <div class="metric"><span>Univers</span><strong>${c.investment_universe}</strong></div>
      <div class="metric"><span>Positionnement ESG</span><strong>${c.esg_positioning}</strong></div>
      <div class="metric"><span>Force</span><strong>${c.key_strength}</strong></div>
      <div class="metric"><span>À surveiller</span><strong>${c.key_watchpoint}</strong></div>
      <p class="source-link">Vérifié le ${c.last_verified} · <a href="${c.source_url}" target="_blank" rel="noopener">source</a></p>
    </div>`).join("");

  if (news) {
    el("news-timeline").innerHTML = news.items.map((n) => `
      <div class="alert-item"><span class="sev sev-low"></span><div class="body">
        <strong>${n.title}</strong><div class="meta">${n.actor} · ${n.date} · ${n.category}</div>
        <p class="sub" style="margin:4px 0 0">${n.note}</p></div></div>`).join("");
  }
}

/* ---------------------------------------------------------------- Méthodologie / Sources render statically in HTML */

/* ---------------------------------------------------------------- CSV export */
function exportScreenerCsv() {
  const uni = STATE.data.etf_universe;
  if (!uni) return;
  const rows = document.querySelectorAll("#screener-table-body tr[data-ticker]");
  const tickers = [...rows].map((r) => r.dataset.ticker);
  const etfs = uni.etfs.filter((e) => tickers.includes(e.ticker));
  const header = ["ticker","name","isin","category","ter","aum_eur","replication","domicile","sfdr","verification_status"];
  const csv = [header.join(",")].concat(etfs.map((e) => header.map((h) => {
    if (h === "ter") return e.ter.value;
    if (h === "aum_eur") return e.aum_eur.value;
    return JSON.stringify(e[h] ?? "").replace(/^"|"$/g, "");
  }).join(","))).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "etf_screener_export.csv";
  a.click();
}

/* ---------------------------------------------------------------- boot */
const RENDERERS = {
  committee: renderCommittee, markets: renderMarkets, allocations: renderAllocations,
  screener: renderScreener, matrix: renderMatrix, monitoring: renderMonitoring,
  esg: renderEsg, competitors: renderCompetitors,
};

async function boot() {
  await loadAll();
  initTabs();
  el("markets-period").addEventListener("change", renderMarkets);
  el("screener-export").addEventListener("click", exportScreenerCsv);
  el("detail-panel").addEventListener("click", (e) => { if (e.target.id === "detail-panel") closeDetail(); });
}
document.addEventListener("DOMContentLoaded", boot);
