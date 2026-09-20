/* =========================================================
   TerraShield AI · Application Controller
   - Navigation / routing
   - KPI cards / charts / overview
   - Main GIS map wiring, layer toggles, risk panel
   - Copilot dialog + Q&A logic
   - Drawer, data source modal, clock, risk pulse
   ========================================================= */
(function (global) {
  "use strict";

  const App = {
    views: ["overview", "map", "risk", "alerts", "time", "sim", "impact", "data"],
    currentView: "overview",
    maps: {
      overview: null,
      main: null,
    },

    async boot() {
      try {
        await global.TerraData.loadAll();
      } catch (e) {
        console.warn("Data load partial; using fallbacks.", e);
      }
      this.buildKpis();
      this.initOverviewMap();
      this.initGlobalRisk();
      this.buildRanking();
      this.buildTrendChart();
      this.buildDistro();
      this.initNavigation();
      this.initMainMapView();
      this.initRiskPanel();
      global.TerraRisk.RiskView.init();
      global.TerraRisk.Simulator.init();
      global.TerraAlerts.init();
      global.TerraReport.TimeMachine.init();
      global.TerraReport.ImpactView.init();
      global.TerraReport.DataView.init();
      this.initCopilot();
      this.initDrawer();
      this.startClock();
      this.scheduleRiskPulses();

      // Size maps correctly (Leaflet needs display)
      setTimeout(() => {
        if (this.maps.overview) this.maps.overview.invalidateSize();
      }, 60);
    },

    /* ================== NAVIGATION ================== */
    initNavigation() {
      document.querySelectorAll(".nav-tab").forEach((t) => {
        t.addEventListener("click", () => this.switchView(t.dataset.view));
      });
    },
    switchView(name) {
      if (!this.views.includes(name)) return;
      this.currentView = name;
      document.querySelectorAll(".nav-tab").forEach((t) => {
        t.classList.toggle("active", t.dataset.view === name);
      });
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      const v = document.getElementById("view-" + name);
      if (v) v.classList.add("active");
      // Invalidate map sizes after tab visible
      requestAnimationFrame(() => {
        if (name === "overview" && this.maps.overview) this.maps.overview.invalidateSize();
        if (name === "map" && this.maps.main) this.maps.main.invalidateSize();
        if (name === "time" && global.TerraReport.TimeMachine.map)
          global.TerraReport.TimeMachine.map.invalidateSize();
        if (name === "sim") {
          global.TerraRisk.Simulator.initSimMap();
          setTimeout(() => {
            if (global.TerraRisk.Simulator.simMap)
              global.TerraRisk.Simulator.simMap.invalidateSize();
          }, 30);
        }
      });
    },

    /* ================== OVERVIEW ================== */
    buildKpis() {
      const agg = global.TerraData.globalAggregate();
      const container = document.getElementById("kpiRow");
      if (!container) return;

      const sparkline = (seed, color = "#00E5FF") => {
        const vals = global.TerraData.seedSeries(18, seed, 30, 95);
        const w = 70, h = 28;
        const min = Math.min(...vals), max = Math.max(...vals);
        const pt = (v, i) =>
          `${(i / (vals.length - 1)) * w},${h - ((v - min) / Math.max(1, max - min)) * h}`;
        const d = vals.map((v, i) => (i === 0 ? "M" : "L") + pt(v, i)).join(" ");
        return `<svg class="kpi-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
          <polyline points="${vals.map((v,i)=>(i/(vals.length-1))*w+","+(h-((v-min)/Math.max(1,max-min))*h)).join(" ")}"
            fill="none" stroke="${color}" stroke-width="1.6"/>
          <path d="${d} L${w},${h} L0,${h} Z" fill="${color}" opacity="0.12"/>
        </svg>`;
      };

      const cards = [
        { label: "Active Risk Zones", value: agg.activeZones, trend: "+12%", up: true, seed: 7, color: "#00E5FF" },
        { label: "Critical Alerts", value: agg.criticalZones, trend: "+2", up: true, seed: 13, color: "#FF1744" },
        { label: "High-Risk Area", value: agg.totalArea.toLocaleString(), unit: "km²", trend: "+8.6%", up: true, seed: 21, color: "#FFAB00" },
        { label: "Exposed Population", value: agg.totalPop.toLocaleString(), trend: "+5.2%", up: true, seed: 31, color: "#B388FF" },
        { label: "New Anomalies (24h)", value: 17, trend: "+4", up: true, seed: 43, color: "#FFD54F" },
        { label: "Regions Monitoring", value: 34, trend: "-1", up: false, seed: 57, color: "#00E676" },
      ];
      container.innerHTML = cards.map((c, i) => `
        <div class="kpi-card" style="animation:fadein .4s ease ${i * 60}ms both">
          <div class="kpi-label">${c.label}</div>
          <div class="kpi-value">${c.value}<small style="font-size:12px;color:#59739a;font-weight:500;margin-left:4px">${c.unit || ""}</small></div>
          <div class="kpi-sub">
            <span class="kpi-trend ${c.up ? "up" : "down"}">${c.trend}</span>
            ${sparkline(c.seed, c.color)}
          </div>
        </div>
      `).join("");
    },

    initOverviewMap() {
      this.maps.overview = new global.TerraMap("overviewMap", {
        center: [22.5, 78.9],
        zoom: 5,
        onZoneClick: (feat) => this.openRiskPanel(feat),
      });
      this.maps.overview.init("terrain");
      this.maps.overview.addRiskZones(global.TerraData.zones(), true);
      this.maps.overview.addHeatmap(global.TerraData.zones(), true);
      this.maps.overview.addHistorical(global.TerraData.landslides(), true);

      document.getElementById("overviewMapBasemap")?.addEventListener("change", (e) => {
        this.maps.overview.setBasemap(e.target.value);
      });
    },

    initGlobalRisk() {
      const agg = global.TerraData.globalAggregate();
      const scoreNum = document.getElementById("globalRiskScore");
      const lvlEl = document.getElementById("globalRiskLevel");
      if (scoreNum) {
        global.TerraRisk.animateNumber(scoreNum, 0, agg.avgScore, 1100);
      }
      if (lvlEl) {
        const lvl = global.TerraRisk.classForScore(agg.maxScore);
        lvlEl.textContent = lvl;
        lvlEl.className =
          "pill " +
          (lvl === "CRITICAL" ? "pill-crit" :
           lvl === "HIGH"     ? "pill-high" :
           lvl === "MODERATE" ? "pill-mod" : "pill-low");
      }
      global.TerraRisk.animateStrokeDash("riskRing", agg.avgScore, 565.48);
      const avgFactors = {};
      const meta = global.TerraData.factorMeta;
      meta.forEach((m) => (avgFactors[m.key] = 0));
      const zones = global.TerraData.zones();
      zones.forEach((z) => {
        meta.forEach((m) => (avgFactors[m.key] += z.properties.factors[m.key] || 0));
      });
      meta.forEach((m) => (avgFactors[m.key] = Math.round(avgFactors[m.key] / Math.max(1, zones.length))));
      global.TerraRisk.drawFactorBars("globalFactors", avgFactors);
    },

    buildRanking() {
      const list = document.getElementById("rankingList");
      if (!list) return;
      const zones = global.TerraData.zonesSortedByRisk().slice(0, 10);
      list.innerHTML = zones.map((z, idx) => {
        const p = z.properties;
        const change = ((idx + 1) % 3 === 0) ? "▼3" : ((idx + 1) % 2 === 0) ? "▲2" : "▲5";
        const up = change.startsWith("▲");
        const rankNumClass = idx === 0 ? "top1" : idx === 1 ? "top2" : idx === 2 ? "top3" : "";
        return `
          <div class="rank-row" data-zone-id="${z.id}" style="animation:fadein .4s ease ${idx * 50}ms both">
            <div class="rank-num ${rankNumClass}">${idx + 1}</div>
            <div>
              <div class="rank-region">${p.name}</div>
              <div class="rank-state">${p.region}</div>
              <div class="rank-trigger">${p.primaryTrigger}</div>
            </div>
            <div class="rank-score" style="color:${
              p.riskLevel === "CRITICAL" ? "#FF1744" :
              p.riskLevel === "HIGH" ? "#FFAB00" :
              p.riskLevel === "MODERATE" ? "#FFD54F" : "#00E676"
            }">${p.riskScore}</div>
            <div class="rank-change ${up ? "up" : "down"}">${change}</div>
          </div>`;
      }).join("");
      list.querySelectorAll(".rank-row").forEach((r) => {
        r.addEventListener("click", () => {
          const id = r.dataset.zoneId;
          this.showZoneOnMap(id);
          this.openRiskPanel(global.TerraData.getZoneById(id));
        });
      });
      document.getElementById("refreshRanking")?.addEventListener("click", () => {
        list.querySelectorAll(".rank-row").forEach((row, i) => {
          row.style.animation = "none";
          setTimeout(() => row.style.animation = `fadein .4s ease ${i * 50}ms both`, 10);
        });
      });
    },

    buildTrendChart() {
      const el = document.getElementById("trendChart");
      if (!el || !global.Chart) return;
      const labels = [];
      const riskSeries = [], rainSeries = [], critCount = [];
      const now = new Date();
      for (let i = 23; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 3600 * 1000);
        labels.push(d.getHours() + ":00");
      }
      const base = 58;
      let crit = 1;
      for (let i = 0; i < 24; i++) {
        const noise = Math.sin(i * 0.8) * 3 + (i > 18 ? 8 : 0);
        const risk = Math.round(base + noise + (i / 6));
        const rain = Math.max(0, Math.round(20 + Math.sin(i * 0.5) * 18 + (i > 16 ? 40 : 0)));
        if (i > 15 && i % 4 === 0) crit++;
        riskSeries.push(risk);
        rainSeries.push(rain);
        critCount.push(crit);
      }
      const chart = new Chart(el, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Avg Risk Index",
              data: riskSeries,
              borderColor: "#00E5FF",
              backgroundColor: "rgba(0,229,255,0.2)",
              tension: 0.45,
              fill: true,
              pointRadius: 0,
              borderWidth: 2,
              yAxisID: "y",
            },
            {
              label: "Rainfall (mm)",
              data: rainSeries,
              borderColor: "#B388FF",
              backgroundColor: "rgba(179,136,255,0.15)",
              tension: 0.4,
              fill: true,
              pointRadius: 0,
              borderWidth: 1.8,
              yAxisID: "y1",
            },
            {
              label: "Critical zones",
              data: critCount,
              borderColor: "#FF1744",
              backgroundColor: "rgba(255,23,68,0.10)",
              borderDash: [4, 4],
              tension: 0.2,
              fill: false,
              pointRadius: 2,
              borderWidth: 1.6,
              yAxisID: "y2",
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { labels: { color: "#8aa4c7", font: { size: 10 }, boxWidth: 12 } },
          },
          scales: {
            x: { ticks: { color: "#59739a", font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
                 grid: { color: "rgba(255,255,255,0.04)" } },
            y: { type: "linear", position: "left", min: 0, max: 100,
                 ticks: { color: "#00E5FF", font: { size: 10 } },
                 grid: { color: "rgba(255,255,255,0.06)" } },
            y1: { type: "linear", position: "right", min: 0,
                  ticks: { color: "#B388FF", font: { size: 10 } },
                  grid: { drawOnChartArea: false } },
            y2: { type: "linear", display: false, min: 0, max: 10 },
          },
        },
      });
      el._terraChart = chart;
    },

    buildDistro() {
      const el = document.getElementById("distroBars");
      if (!el) return;
      const agg = global.TerraData.globalAggregate();
      const lc = agg.levelCount;
      const total = Math.max(1, lc.CRITICAL + lc.HIGH + lc.MODERATE + lc.LOW);
      const row = (label, val, cls) => `
        <div class="distro-row">
          <div class="distro-label">${label}</div>
          <div class="distro-track"><div class="distro-fill ${cls}" style="width:${(val/total*100).toFixed(0)}%"></div></div>
          <div class="distro-val">${val}</div>
        </div>`;
      el.innerHTML =
        row("CRITICAL", lc.CRITICAL, "crit") +
        row("HIGH",     lc.HIGH,     "high") +
        row("MODERATE", lc.MODERATE, "mod")  +
        row("LOW",      lc.LOW,      "low");
    },

    /* ================== MAIN MAP ================== */
    initMainMapView() {
      this.maps.main = new global.TerraMap("mainMap", {
        center: [22.5, 78.9],
        zoom: 5,
        onZoneClick: (feat) => this.openRiskPanel(feat),
      });
      this.maps.main.init("terrain");
      this.maps.main.addRiskZones(global.TerraData.zones(), true);
      this.maps.main.addHeatmap(global.TerraData.zones(), true);
      this.maps.main.addHistorical(global.TerraData.landslides(), true);
      const infra = global.TerraData.infrastructure();
      if (infra) this.maps.main.addInfrastructure(infra, false);
      this.maps.main.addRainfallOverlay(global.TerraData.zones(), false);
      this.maps.main.addSoilOverlay(global.TerraData.zones(), false);
      this.maps.main.addSlopeOverlay(global.TerraData.zones(), false);
      this.maps.main.addAdminBoundaries(false);

      // Basemap radio
      document.querySelectorAll("input[name=basemap]").forEach((r) => {
        r.addEventListener("change", (e) => {
          if (e.target.checked) this.maps.main.setBasemap(e.target.value);
        });
      });

      // Layer toggles
      const bindToggle = (id, name, extraSetup) => {
        const c = document.getElementById(id);
        if (!c) return;
        c.addEventListener("change", () => {
          this.maps.main.toggleLayer(name, c.checked);
        });
      };
      bindToggle("layRisk", "risk");
      bindToggle("layHeat", "heat");
      bindToggle("layHistory", "historical");
      bindToggle("layRain", "rain");
      bindToggle("laySoil", "soil");
      bindToggle("laySlope", "slope");
      bindToggle("layRoads", "infra");
      bindToggle("layRivers", "infra"); // combined infra layer
      bindToggle("layPop", "infra");
      bindToggle("layBoundaries", "boundaries");

      // Combined logic: if any infra toggle checked -> ensure on, if all off -> ensure off
      ["layRoads","layRivers","layPop"].forEach((id) => {
        const c = document.getElementById(id);
        if (!c) return;
        c.addEventListener("change", () => {
          const any = ["layRoads","layRivers","layPop"].some(x => document.getElementById(x)?.checked);
          this.maps.main.toggleLayer("infra", any);
        });
      });

      // Opacity
      const slider = document.getElementById("opacitySlider");
      const lbl = document.getElementById("opacityLabel");
      if (slider && lbl) {
        slider.addEventListener("input", () => {
          const v = +slider.value;
          lbl.textContent = v + "%";
          this.maps.main.setOverlayOpacity(v / 100);
        });
      }

      // Search
      const search = document.getElementById("mapSearch");
      document.getElementById("goSearch")?.addEventListener("click", () => {
        const q = (search.value || "").trim().toLowerCase();
        if (!q) return;
        const zones = global.TerraData.zones();
        let match = zones.find(z => z.properties.name.toLowerCase().includes(q)
          || z.properties.region.toLowerCase().includes(q) || z.id.toLowerCase() === q);
        if (match) {
          this.maps.main.flyToZone(match.id);
          this.openRiskPanel(match);
          return;
        }
        // Coordinates input: "lat,lon"
        const parts = q.split(",").map(s => parseFloat(s.trim()));
        if (parts.length === 2 && parts.every(n => !isNaN(n))) {
          this.maps.main.flyToLatLng(parts[0], parts[1], 9);
        }
      });
      search?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") document.getElementById("goSearch")?.click();
      });
    },

    /* ================== RISK PANEL (map overlay) ================== */
    initRiskPanel() {
      document.getElementById("closeRiskPanel")?.addEventListener("click", () => {
        document.getElementById("riskPanel").hidden = true;
      });
      document.getElementById("rpFocusAlerts")?.addEventListener("click", () => this.switchView("alerts"));
      document.getElementById("rpFocusImpact")?.addEventListener("click", () => {
        const zid = this._panelZoneId;
        if (zid) {
          const sel = document.getElementById("impactZoneSelect");
          if (sel) sel.value = zid;
          global.TerraReport.ImpactView.render(zid);
        }
        this.switchView("impact");
      });
    },

    openRiskPanel(zone) {
      if (!zone) return;
      const p = zone.properties;
      this._panelZoneId = zone.id;
      const panel = document.getElementById("riskPanel");
      if (!panel) return;
      panel.hidden = false;
      document.getElementById("rpName").textContent = p.name;
      document.getElementById("rpRegion").textContent = `${p.region} · Last update ${p.lastUpdated || "N/A"}`;

      const wrap = document.getElementById("rpScoreWrap");
      wrap.hidden = false;
      const numEl = document.getElementById("rpScoreNum");
      global.TerraRisk.animateNumber(numEl, 0, p.riskScore, 700);
      const lvl = document.getElementById("rpLevel");
      lvl.textContent = p.riskLevel;
      lvl.className =
        "pill " +
        (p.riskLevel === "CRITICAL" ? "pill-crit" :
         p.riskLevel === "HIGH" ? "pill-high" :
         p.riskLevel === "MODERATE" ? "pill-mod" : "pill-low");
      const mark = panel.querySelector(".rp-mark");
      if (mark) {
        mark.style.background =
          p.riskLevel === "CRITICAL" ? "#FF1744" :
          p.riskLevel === "HIGH"     ? "#FFAB00" :
          p.riskLevel === "MODERATE" ? "#FFD54F" : "#00E676";
        mark.style.boxShadow = `0 0 12px ${mark.style.background}`;
      }
      document.getElementById("rpConf").textContent = (p.confidence || "--") + "%";
      global.TerraRisk.drawFactorBars("rpFactors", p.factors);
      document.getElementById("rpExpl").textContent = p.explanation;

      // Trigger risk pulse if critical
      if (p.riskLevel === "CRITICAL") this.fireRiskPulse();
    },

    showZoneOnMap(zoneId, altObj) {
      this.switchView("map");
      setTimeout(() => {
        if (this.maps.main) this.maps.main.flyToZone(zoneId);
        const zone = global.TerraData.getZoneById(zoneId);
        if (zone) this.openRiskPanel(zone);
      }, 120);
    },

    /* ================== RISK PULSE (wow moment) ================== */
    fireRiskPulse() {
      const pulse = document.getElementById("riskPulse");
      if (!pulse) return;
      pulse.hidden = false;
      pulse.style.animation = "none";
      requestAnimationFrame(() => {
        pulse.style.animation = "";
      });
      setTimeout(() => { pulse.hidden = true; }, 1300);
    },
    scheduleRiskPulses() {
      // Subtle risk pulse on the highest risk zone at intervals
      const critZones = global.TerraData.zonesByLevel("CRITICAL");
      if (critZones.length === 0) return;
      let i = 0;
      setInterval(() => {
        if (this.currentView !== "map") return;
        if (!this.maps.main) return;
        const z = critZones[i++ % critZones.length];
        // Highlight by briefly toggling zone style: reuse openRiskPanel pulse indirectly
        this.fireRiskPulse();
      }, 18000);
    },

    /* ================== COPILOT ================== */
    initCopilot() {
      const panel = document.getElementById("copilotPanel");
      const tog = document.getElementById("copilotToggle");
      const close = document.getElementById("copilotClose");
      tog?.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
        if (!panel.hidden) this.copilotWelcome();
      });
      close?.addEventListener("click", () => { panel.hidden = true; });

      document.querySelectorAll("[data-copilot]").forEach((b) => {
        b.addEventListener("click", () => this.answerCopilot(b.dataset.copilot));
      });
      document.getElementById("copilotForm")?.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = document.getElementById("copilotText");
        const q = (input.value || "").trim();
        input.value = "";
        if (q) this.answerCopilot(q);
      });
    },
    copilotWelcome() {
      const msgs = document.getElementById("copilotMsgs");
      if (!msgs || msgs.children.length > 0) return;
      this.pushBotMsg(
        `Hi, I'm <b>TerraShield Copilot</b>. Ask me about risk, regions, history, or infrastructure. I can also highlight relevant layers on the map.`
      );
    },
    pushUserMsg(text) {
      const msgs = document.getElementById("copilotMsgs");
      const el = document.createElement("div");
      el.className = "msg user";
      el.textContent = text;
      msgs.appendChild(el);
      msgs.scrollTop = msgs.scrollHeight;
    },
    pushBotMsg(html) {
      const msgs = document.getElementById("copilotMsgs");
      const el = document.createElement("div");
      el.className = "msg bot";
      el.innerHTML = html;
      msgs.appendChild(el);
      msgs.scrollTop = msgs.scrollHeight;
    },
    answerCopilot(keyOrQuery) {
      const q = (keyOrQuery || "").toString().toLowerCase();
      this.pushUserMsg(keyOrQuery);
      const top = global.TerraData.zonesSortedByRisk();
      const [z1, z2, z3] = top;
      const aggregate = global.TerraData.globalAggregate();

      setTimeout(() => {
        if (q.includes("highest") || keyOrQuery === "highest") {
          this.pushBotMsg(
            `Top 3 highest-risk regions today:<br>` +
            `1. <b>${z1.properties.name}</b> · ${z1.properties.riskLevel} (<b>${z1.properties.riskScore}</b>)<br>` +
            `2. <b>${z2.properties.name}</b> · ${z2.properties.riskLevel} (<b>${z2.properties.riskScore}</b>)<br>` +
            `3. <b>${z3.properties.name}</b> · ${z3.properties.riskLevel} (<b>${z3.properties.riskScore}</b>)<br><br>` +
            `In total, <b>${aggregate.criticalZones} CRITICAL</b> and ${aggregate.levelCount.HIGH} HIGH zones are active. I'll fly to #1 on the Live Map.`
          );
          this.showZoneOnMap(z1.id);
          return;
        }
        if (q.includes("why") || keyOrQuery === "why") {
          const z = z1;
          const f = z.properties.factors;
          this.pushBotMsg(
            `<b>${z.properties.name}</b> is <b>${z.properties.riskLevel}</b> (${z.properties.riskScore}/100) because:<br>` +
            `• Slope factor is <b>${f.slope}%</b> (extremely steep terrain)<br>` +
            `• Rainfall anomaly <b>${f.rainfallAnomaly}%</b> vs. 30-year norm<br>` +
            `• Soil moisture at <b>${f.soilMoisture}%</b> — near-saturated, losing cohesion<br>` +
            `• Historical susceptibility confirms past failures<br><br>` +
            `<i>"${z.properties.explanation}"</i>`
          );
          this.openRiskPanel(z);
          this.switchView("risk");
          const sel = document.getElementById("riskZoneSelect");
          if (sel) sel.value = z.id;
          global.TerraRisk.RiskView.renderZone(z.id);
          return;
        }
        if (q.includes("infrastructure") || q.includes("infra") || keyOrQuery === "infra") {
          const z = z1;
          const infra = global.TerraData.getInfraForZones([z.id]);
          const names = infra.critical.slice(0, 3).map((c) => `<b>${c.name}</b> (${c.riskExposure})`).join("<br>• ");
          this.pushBotMsg(
            `Closest critical-inventory to the highest-risk zone <b>${z.properties.name}</b>:<br>• ${names || "No CI in this polygon"}<br><br>` +
            `Roads at risk: <b>${infra.roads.length}</b> corridors · Settlements exposed: <b>${infra.settlements.length}</b>. I'll enable the roads+settlements+CI layer on the Live Map.`
          );
          this.switchView("map");
          setTimeout(() => {
            ["layRoads","layPop"].forEach(id => { const c = document.getElementById(id); if (c) c.checked = true; });
            // Fire change so layer state is applied
            document.getElementById("layRoads")?.dispatchEvent(new Event("change"));
            this.maps.main.flyToZone(z.id);
          }, 180);
          return;
        }
        if (q.includes("compare") || q.includes("historical") || keyOrQuery === "compare") {
          const hist = global.TerraData.landslides()
            .slice().sort((a,b) => b.properties.volume_m3 - a.properties.volume_m3).slice(0, 4);
          const list = hist.map((h,i) =>
            `${i+1}. <b>${h.properties.location}</b> (${h.properties.date}) · ${h.properties.magnitude} · ${(h.properties.volume_m3/1e6).toFixed(1)}M m³ · ${h.properties.fatalities} lives lost`
          ).join("<br>");
          this.pushBotMsg(
            `Largest historical events vs. today's projected envelope:<br>${list}<br><br>` +
            `<b>${z1.properties.name}</b> is tracking at <b>${z1.properties.riskScore}</b>, comparable to pre-event conditions for Chamoli 2021 in its severity. Switching to the Time Machine for evolution.`
          );
          this.switchView("time");
          return;
        }
        // Default: parse any mention of zone
        const match = top.find((z) =>
          q.includes(z.properties.name.toLowerCase().split(" ")[0]) ||
          (z.properties.region || "").toLowerCase().split(",").some(part => q.includes(part.trim()))
        );
        if (match) {
          this.pushBotMsg(
            `<b>${match.properties.name}</b> (${match.properties.region})<br>` +
            `Risk: <b>${match.properties.riskLevel}</b> · Score <b>${match.properties.riskScore}/100</b> · Confidence <b>${match.properties.confidence}%</b><br>` +
            `Primary trigger: <i>${match.properties.primaryTrigger}</i><br><br>` +
            `${match.properties.explanation}`
          );
          this.showZoneOnMap(match.id);
          return;
        }
        // Generic fallback
        this.pushBotMsg(
          `I'm following — try one of the quick prompts, or type a zone name like "Munnar" or "Sikkim". You can also ask for the <b>highest risk</b> regions, <b>why</b> a zone is flagged, <b>infrastructure</b> near risk, or a <b>historical</b> comparison.`
        );
      }, 380);
    },

    /* ================== DRAWER ================== */
    initDrawer() {
      const d = document.getElementById("dataDrawer");
      document.getElementById("openDataDrawer")?.addEventListener("click", () => { if (d) d.hidden = false; });
      document.getElementById("closeDrawer")?.addEventListener("click", () => { if (d) d.hidden = true; });
      d?.addEventListener("click", (e) => { if (e.target === d) d.hidden = true; });
    },

    /* ================== CLOCK ================== */
    startClock() {
      const el = document.getElementById("clockValue");
      const ccEl = document.getElementById("cc-date");
      const tick = () => {
        const now = new Date();
        const hh = String(now.getUTCHours()).padStart(2, "0");
        const mm = String(now.getUTCMinutes()).padStart(2, "0");
        const ss = String(now.getUTCSeconds()).padStart(2, "0");
        if (el) el.textContent = `${hh}:${mm}:${ss}`;
        if (ccEl) ccEl.textContent = now.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" }) + ` · ${hh}:${mm}Z`;
      };
      tick();
      setInterval(tick, 1000);
    },
  };

  global.TerraApp = App;
  document.addEventListener("DOMContentLoaded", () => App.boot());
})(window);
