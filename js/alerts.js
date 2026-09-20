/* =========================================================
   TerraShield AI · Alerts Module
   - Active alert cards with filter
   - Real-time anomaly stream
   - Environmental signals dashboard
   ========================================================= */
(function (global) {
  "use strict";

  const AlertsView = {
    filter: "all",
    anomalyTimer: null,

    init() {
      this.renderAlerts();
      this.attachFilter();
      this.renderAnomaliesInitial();
      this.renderEnvSignals();
      this.startAnomalyStream();
    },

    buildAlerts() {
      const zones = global.TerraData.zonesSortedByRisk();
      const actions = {
        CRITICAL: "Initiate evacuation protocols; deploy ground sensors; notify NDMA / local authorities immediately.",
        HIGH:     "Escalate monitoring frequency; prepare emergency response teams; alert district administration.",
        MODERATE: "Continue enhanced surveillance; brief local communities; pre-position relief supplies.",
        LOW:      "Maintain routine monitoring; no public advisory at this time.",
      };
      const now = Date.now();
      return zones.map((z, idx) => {
        const p = z.properties;
        const minutesAgo = Math.floor(((idx * 37 + 13) % 360));
        const t = new Date(now - minutesAgo * 60 * 1000);
        return {
          id: "ALT-" + z.id,
          zoneId: z.id,
          location: p.name,
          region: p.region,
          level: p.riskLevel,
          score: p.riskScore,
          confidence: p.confidence,
          trigger: p.primaryTrigger,
          explanation: p.explanation,
          action: actions[p.riskLevel] || actions.MODERATE,
          time: t,
          isNew: idx < 2,
        };
      });
    },

    attachFilter() {
      const btns = document.querySelectorAll(".alert-filter .btn-chip");
      btns.forEach((btn) => {
        btn.addEventListener("click", () => {
          btns.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          this.filter = btn.dataset.filter || "all";
          this.renderAlerts();
        });
      });
    },

    renderAlerts() {
      const listEl = document.getElementById("alertList");
      if (!listEl) return;
      const alerts = this.buildAlerts().filter((a) =>
        this.filter === "all" ? true : a.level === this.filter
      );
      listEl.innerHTML = "";
      const order = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3 };
      alerts.sort((a, b) => order[a.level] - order[b.level] || b.score - a.score);

      alerts.forEach((a, idx) => {
        const card = document.createElement("div");
        card.className = `alert-card ${a.level}`;
        card.style.animation = `fadein .35s ease ${idx * 50}ms both`;
        card.dataset.zoneId = a.zoneId;
        const timeStr = a.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const rel = minutesRelative(a.time);
        card.innerHTML = `
          <div class="alert-lvl">${a.level}</div>
          <div>
            ${a.isNew ? `<span class="alert-new-pill">NEW</span>` : ""}
            <div class="alert-title">${a.location}</div>
            <div class="alert-meta">
              <span>📍 ${a.region}</span>
              <span>🎯 Confidence <b>${a.confidence}%</b></span>
              <span>⏱ ${rel}</span>
            </div>
            <div class="alert-trigger"><b>Trigger:</b> ${a.trigger}</div>
            <div class="alert-action"><b>Action:</b> ${a.action}</div>
          </div>
          <div class="alert-right">
            <div class="alert-score-box">
              <div class="alert-score-num">${a.score}</div>
              <div class="alert-score-lbl">Risk Score</div>
            </div>
            <div class="alert-time">${timeStr} ZULU</div>
          </div>`;
        card.addEventListener("click", () => {
          if (global.TerraApp) global.TerraApp.showZoneOnMap(a.zoneId, a);
        });
        listEl.appendChild(card);
      });

      if (alerts.length === 0) {
        listEl.innerHTML = `<div style="color:#59739a;padding:30px;text-align:center">No alerts match this filter.</div>`;
      }
    },

    renderAnomaliesInitial() {
      const el = document.getElementById("anomalyStream");
      if (!el) return;
      const samples = [
        { t: "rain", text: "Western Ghats rainfall <b>+32%</b> vs 30-yr avg", delta: 32, mins: 3 },
        { t: "soil", text: "Sikkim Teesta basin soil saturation reaches <b>91%</b>", delta: 12, mins: 7 },
        { t: "slope", text: "Munnar sector InSAR detects <b>2.1cm</b> creep", delta: 8, mins: 12 },
        { t: "veg",  text: "Uttarakhand vegetation loss anomaly <b>-18%</b>", delta: 18, mins: 18 },
        { t: "seis", text: "Sikkim M3.2 aftershock near critical infrastructure", delta: 0, mins: 22 },
        { t: "rain", text: "Konkan coast 24h rain <b>380mm</b> exceeds threshold", delta: 27, mins: 31 },
        { t: "soil", text: "Darjeeling hills soil moisture <b>88%</b>", delta: 9, mins: 42 },
      ];
      el.innerHTML = samples.map((s) => anomHTML(s)).join("");
    },

    startAnomalyStream() {
      if (this.anomalyTimer) clearInterval(this.anomalyTimer);
      const pool = [
        { t: "rain",  textF: (z) => `<b>${z.properties.name.split(" - ")[0]}</b> 1h rain intensity <b>+${10 + rand(20)}%</b> vs baseline` },
        { t: "soil",  textF: (z) => `Soil moisture rising in <b>${z.properties.name.split(" - ")[0]}</b>: <b>${70 + rand(20)}%</b>` },
        { t: "slope", textF: (z) => `Slope stability model: <b>${z.properties.name.split(" - ")[0]}</b> factor of safety dropped <b>-${3 + rand(7)}%</b>` },
        { t: "veg",   textF: (z) => `NDVI down in <b>${z.properties.name.split(" - ")[0]}</b> — possible <b>deforestation signal</b>` },
        { t: "seis",  textF: (z) => `Seismic tremor near <b>${z.properties.name.split(" - ")[0]}</b> (M${(2 + rand(20) / 10).toFixed(1)})` },
      ];
      this.anomalyTimer = setInterval(() => {
        const el = document.getElementById("anomalyStream");
        if (!el) return;
        const zones = global.TerraData.zones();
        const z = zones[rand(zones.length)];
        const p = pool[rand(pool.length)];
        const row = document.createElement("div");
        row.className = "anom-item";
        row.innerHTML = timeMarkFragment() + `
          <div class="anom-dot ${p.t}"></div>
          <div class="anom-text">${p.textF(z)}</div>
          <div class="anom-time">now</div>`;
        el.insertBefore(row, el.firstChild);
        while (el.children.length > 24) el.removeChild(el.lastChild);
      }, 5200);
    },

    renderEnvSignals() {
      const el = document.getElementById("envSignals");
      if (!el) return;
      const agg = global.TerraData.globalAggregate();
      const signals = [
        { name: "Avg Rainfall (24h)", val: "184 mm", pct: 72, high: false, sub: "+26% vs baseline" },
        { name: "Soil Moisture (avg)", val: "71%",    pct: 71, high: true,  sub: "6 of 10 zones saturated" },
        { name: "Avg Risk Index", val: String(agg.avgScore), pct: agg.avgScore, high: agg.avgScore >= 60, sub: `${agg.activeZones} active risk zones` },
        { name: "Seismic Activity", val: "M2.8",  pct: 48, high: false, sub: "24 events / 24h" },
        { name: "River Discharge",  val: "High",  pct: 78, high: true,  sub: "3 basins above alert" },
        { name: "Cloudburst Alerts", val: `${agg.criticalZones} zones`, pct: Math.min(100, agg.criticalZones * 25), high: true, sub: "Doppler confirmed" },
      ];
      el.innerHTML = signals.map((s) => `
        <div class="env-card">
          <div class="env-name">${s.name}</div>
          <div class="env-val">${s.val}</div>
          <div class="env-bar"><div class="env-fill ${s.high ? "high" : ""}" style="width:${s.pct}%"></div></div>
          <div class="env-sub">${s.sub}</div>
        </div>`).join("");
    },
  };

  function rand(n) { return Math.floor(Math.random() * n); }

  function minutesRelative(d) {
    const diff = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (diff < 1) return "just now";
    if (diff < 60) return `${diff} min ago`;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return m ? `${h}h ${m}m ago` : `${h}h ago`;
  }

  function timeMarkFragment() { return ""; }

  function anomHTML(s) {
    const date = new Date(Date.now() - s.mins * 60 * 1000);
    const t = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `
      <div class="anom-item">
        <div class="anom-dot ${s.t}"></div>
        <div class="anom-text">${s.text}</div>
        <div class="anom-time">${t}</div>
      </div>`;
  }

  global.TerraAlerts = AlertsView;
})(window);
