/* =========================================================
   TerraShield AI · Risk Engine
   - AI Score display (ring, factors, radar/trend charts)
   - Explainable "Why this alert?"
   - "What if?" scenario simulator
   ========================================================= */
(function (global) {
  "use strict";

  function classForScore(s) {
    if (s >= 80) return "CRITICAL";
    if (s >= 60) return "HIGH";
    if (s >= 40) return "MODERATE";
    return "LOW";
  }
  function pillClassFor(lvl) {
    return lvl === "CRITICAL" ? "pill-crit" :
           lvl === "HIGH"     ? "pill-high" :
           lvl === "MODERATE" ? "pill-mod"  : "pill-low";
  }

  function animateNumber(el, from, to, duration = 900) {
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (to - from) * eased;
      el.textContent = Math.round(v);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function animateStrokeDash(circleId, score, circ = 565.48) {
    const el = document.getElementById(circleId);
    if (!el) return;
    const target = Math.max(0, Math.min(1, score / 100));
    const offset = circ * (1 - target);
    el.style.transition = "stroke-dashoffset 1.1s cubic-bezier(.2,.7,.2,1)";
    el.style.strokeDashoffset = offset;
  }

  function drawFactorBars(containerId, factors) {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    cont.innerHTML = "";
    const meta = global.TerraData.factorMeta;
    meta.forEach((m) => {
      const v = factors[m.key];
      const row = document.createElement("div");
      row.className = "factor-bar-row";
      row.innerHTML =
        `<div class="factor-bar-label">${m.label}</div>` +
        `<div class="factor-bar-track"><div class="factor-bar-fill" style="width:${v}%;background:linear-gradient(90deg,${m.color},#fff3)"></div></div>` +
        `<div class="factor-bar-val">${v}%</div>`;
      cont.appendChild(row);
    });
  }

  function drawFactorRings(containerId, factors) {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    cont.innerHTML = "";
    const meta = global.TerraData.factorMeta;
    meta.forEach((m, idx) => {
      const v = factors[m.key];
      const circ = 2 * Math.PI * 28;
      const card = document.createElement("div");
      card.className = "ring-card";
      card.style.animation = `fadein .4s ease ${idx * 60}ms both`;
      card.innerHTML = `
        <svg viewBox="0 0 72 72">
          <circle cx="36" cy="36" r="28" stroke="rgba(255,255,255,0.06)" stroke-width="7" fill="none"/>
          <circle cx="36" cy="36" r="28" stroke="${m.color}" stroke-width="7" fill="none"
                  stroke-linecap="round" stroke-dasharray="${circ}"
                  stroke-dashoffset="${circ * (1 - v / 100)}"
                  transform="rotate(-90 36 36)" style="transition:stroke-dashoffset 1s cubic-bezier(.2,.7,.2,1)"/>
        </svg>
        <div class="ring-name">${m.label}</div>
        <div class="ring-val" style="color:${m.color}">${v}%</div>`;
      cont.appendChild(card);
    });
  }

  function drawWhyList(containerId, factors, explanation) {
    const ul = document.getElementById(containerId);
    if (!ul) return;
    ul.innerHTML = "";
    const sorted = Object.entries(factors).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const labels = {
      slope: "Slope steepness exceeds failure thresholds",
      rainfallAnomaly: "Rainfall is significantly above seasonal baseline",
      soilMoisture: "Near-saturated soil reduces effective cohesion",
      vegetationChange: "Vegetation loss reduces root binding strength",
      historicalSusceptibility: "This terrain has a documented landslide history",
      terrainInstability: "Active tectonic/erosion signals detected",
    };
    sorted.forEach(([k, v]) => {
      const li = document.createElement("li");
      li.innerHTML = `<b style="color:#fff">${v}%</b> · ${labels[k] || k}`;
      ul.appendChild(li);
    });
    const li = document.createElement("li");
    li.innerHTML = `<i style="color:#8aa4c7">${explanation || ""}</i>`;
    ul.appendChild(li);
  }

  /* ===== Radar / trend charts ===== */
  function drawRadar(canvasId, factors) {
    const el = document.getElementById(canvasId);
    if (!el || !global.Chart) return;
    if (el._terraChart) el._terraChart.destroy();
    const labels = global.TerraData.factorMeta.map((m) => m.label);
    const data = global.TerraData.factorMeta.map((m) => factors[m.key]);
    const colors = global.TerraData.factorMeta.map((m) => m.color);
    const chart = new Chart(el, {
      type: "radar",
      data: {
        labels,
        datasets: [
          {
            label: "Current",
            data,
            backgroundColor: "rgba(0,229,255,0.18)",
            borderColor: "rgba(0,229,255,0.9)",
            pointBackgroundColor: colors,
            pointBorderColor: "#ffffff",
            pointRadius: 4,
            borderWidth: 2,
          },
          {
            label: "Baseline",
            data: [30, 30, 35, 45, 35, 30],
            backgroundColor: "rgba(0,230,118,0.08)",
            borderColor: "rgba(0,230,118,0.4)",
            borderDash: [4, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: "#8aa4c7", font: { size: 11 } },
          },
        },
        scales: {
          r: {
            min: 0, max: 100,
            ticks: { display: false, stepSize: 20 },
            grid: { color: "rgba(255,255,255,0.06)" },
            angleLines: { color: "rgba(255,255,255,0.08)" },
            pointLabels: { color: "#8aa4c7", font: { size: 11 } },
          },
        },
      },
    });
    el._terraChart = chart;
    return chart;
  }

  function drawFactorTrend(canvasId, factors) {
    const el = document.getElementById(canvasId);
    if (!el || !global.Chart) return;
    if (el._terraChart) el._terraChart.destroy();
    const labels = ["D-6", "D-5", "D-4", "D-3", "D-2", "D-1", "Today"];
    const meta = global.TerraData.factorMeta;
    const baseSeed = Object.values(factors).reduce((a, b) => a + b, 0);
    const datasets = meta.map((m, idx) => {
      const base = factors[m.key];
      const series = global.TerraData.seedSeries(7, baseSeed + idx * 31, -15, 10);
      const data = series.map((s, i) =>
        Math.max(5, Math.min(100, Math.round(base + s * (i / 6 + 0.2))))
      );
      data[data.length - 1] = base;
      return {
        label: m.label,
        data,
        borderColor: m.color,
        backgroundColor: m.color + "22",
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 2.5,
        fill: false,
      };
    });
    const chart = new Chart(el, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: "#8aa4c7", font: { size: 10 }, boxWidth: 12 },
          },
        },
        scales: {
          x: { ticks: { color: "#59739a", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.04)" } },
          y: { min: 0, max: 100,
               ticks: { color: "#59739a", font: { size: 10 } },
               grid: { color: "rgba(255,255,255,0.06)" } },
        },
      },
    });
    el._terraChart = chart;
    return chart;
  }

  /* ===== Risk view controller ===== */
  const RiskView = {
    currentZoneId: null,

    init() {
      const sel = document.getElementById("riskZoneSelect");
      if (sel) {
        global.TerraData.zonesSortedByRisk().forEach((z) => {
          const o = document.createElement("option");
          o.value = z.id;
          o.textContent = `${z.properties.name} · ${z.properties.riskLevel} (${z.properties.riskScore})`;
          sel.appendChild(o);
        });
        const top = global.TerraData.zonesSortedByRisk()[0];
        if (top) {
          sel.value = top.id;
          this.renderZone(top.id);
        }
        sel.addEventListener("change", (e) => this.renderZone(e.target.value));
      }
    },

    renderZone(zoneId) {
      this.currentZoneId = zoneId;
      const zone = global.TerraData.getZoneById(zoneId);
      if (!zone) return;
      const p = zone.properties;

      const numEl = document.getElementById("engineScoreNum");
      const lvlEl = document.getElementById("engineLevel");
      const explEl = document.getElementById("engineExpl");
      if (numEl) {
        const cur = parseInt(numEl.textContent, 10) || 0;
        animateNumber(numEl, cur, p.riskScore, 900);
      }
      if (lvlEl) {
        lvlEl.textContent = p.riskLevel;
        lvlEl.className = "pill " + pillClassFor(p.riskLevel);
      }
      if (explEl) explEl.textContent = p.explanation;
      animateStrokeDash("engineRing", p.riskScore, 691.15);
      drawFactorRings("factorRings", p.factors);
      drawWhyList("whyList", p.factors, p.explanation);
      drawRadar("radarChart", p.factors);
      drawFactorTrend("factorChart", p.factors);
    },
  };

  /* ===== Scenario simulator ===== */
  const Simulator = {
    baseline: null,
    simMap: null,

    init() {
      const form = document.getElementById("simForm");
      if (!form) return;

      const bindSlider = (id, labelId, suffix = "%") => {
        const s = document.getElementById(id);
        const l = document.getElementById(labelId);
        if (!s || !l) return;
        const update = () => { l.textContent = s.value + suffix; };
        s.addEventListener("input", update);
        update();
      };
      bindSlider("simRain", "simRainVal", "%");
      bindSlider("simDur", "simDurVal", "h");
      bindSlider("simSoil", "simSoilVal", "%");
      bindSlider("simSlope", "simSlopeVal", "°");
      bindSlider("simVeg", "simVegVal", "%");

      document.getElementById("simRun").addEventListener("click", () => this.runSimulation());
      document.getElementById("simReset").addEventListener("click", () => this.reset());

      this.baseline = this.currentParams();
      this.drawSimKpis(null);
      this.drawSimChart();

      // Initialize sim map lazily on view entry (done in app.js when switching view)
    },

    currentParams() {
      return {
        rain: +document.getElementById("simRain").value,
        dur: +document.getElementById("simDur").value,
        soil: +document.getElementById("simSoil").value,
        slope: +document.getElementById("simSlope").value,
        veg: +document.getElementById("simVeg").value,
      };
    },

    reset() {
      if (!this.baseline) this.baseline = { rain: 100, dur: 24, soil: 60, slope: 30, veg: 65 };
      document.getElementById("simRain").value = this.baseline.rain;
      document.getElementById("simDur").value = this.baseline.dur;
      document.getElementById("simSoil").value = this.baseline.soil;
      document.getElementById("simSlope").value = this.baseline.slope;
      document.getElementById("simVeg").value = this.baseline.veg;
      ["simRainVal","simDurVal","simSoilVal","simSlopeVal","simVegVal"].forEach((id,i)=>{
        const el = document.getElementById(id);
        if (!el) return;
        const v = [this.baseline.rain,this.baseline.dur,this.baseline.soil,this.baseline.slope,this.baseline.veg][i];
        const sfx = ["%","h","%","°","%"][i];
        el.textContent = v + sfx;
      });
      this.runSimulation(true);
    },

    initSimMap() {
      if (this.simMap) return;
      this.simMap = new global.TerraMap("simMap", { center: [22.5, 78.9], zoom: 5 });
      this.simMap.init("terrain");
      this.refreshSimMap(null);
    },

    computeScores(params) {
      const zones = global.TerraData.zones();
      const rainFactor = (params.rain - 100) / 100; // -1..2
      const durFactor = (params.dur - 24) / 200;   // small
      const soilFactor = (params.soil - 60) / 100;
      const slopeFactor = (params.slope - 30) / 100;
      const vegPenalty = Math.max(0, (65 - params.veg) / 65);
      const w = global.TerraData.factorWeights;

      return zones.map((z) => {
        const f = z.properties.factors;
        const newFactors = {
          slope: Math.max(0, Math.min(100, f.slope + slopeFactor * f.slope)),
          rainfallAnomaly: Math.max(0, Math.min(100, f.rainfallAnomaly + rainFactor * 60)),
          soilMoisture: Math.max(0, Math.min(100, f.soilMoisture + soilFactor * f.soilMoisture)),
          vegetationChange: Math.max(0, Math.min(100, f.vegetationChange + vegPenalty * 50)),
          historicalSusceptibility: f.historicalSusceptibility,
          terrainInstability: Math.max(0, Math.min(100, f.terrainInstability + (rainFactor + durFactor) * 10)),
        };
        let s = 0;
        for (const k of Object.keys(newFactors)) s += newFactors[k] * w[k];
        s = Math.round(s * 1.15); // scaling
        s = Math.max(0, Math.min(100, s));
        return {
          zone: z,
          factors: newFactors,
          score: s,
          level: classForScore(s),
        };
      });
    },

    refreshSimMap(simulated) {
      if (!this.simMap) return;
      this.simMap.clearAllOverlays();
      const baseZones = simulated ? simulated.map((s) => ({
        ...s.zone,
        properties: { ...s.zone.properties, riskScore: s.score, riskLevel: s.level },
      })) : global.TerraData.zones();
      this.simMap.addRiskZones(baseZones, true);
      this.simMap.addHeatmap(baseZones, true);
    },

    runSimulation(isReset = false) {
      const params = this.currentParams();
      const simulated = this.computeScores(params);

      let totalPop = 0, highArea = 0, critCount = 0, highCount = 0;
      simulated.forEach((s) => {
        totalPop += s.zone.properties.populationExposed || 0;
        if (s.level === "CRITICAL" || s.level === "HIGH")
          highArea += s.zone.properties.areaSqKm || 0;
        if (s.level === "CRITICAL") critCount++;
        if (s.level === "HIGH") highCount++;
      });

      // Compare with baseline scores
      const baseline = this.computeScores(this.baseline || { rain:100,dur:24,soil:60,slope:30,veg:65 });
      let baseHighArea = 0, baseCrit = 0;
      baseline.forEach((s) => {
        if (s.level === "CRITICAL" || s.level === "HIGH")
          baseHighArea += s.zone.properties.areaSqKm || 0;
        if (s.level === "CRITICAL") baseCrit++;
      });
      const areaDelta = baseHighArea === 0 ? 0 : Math.round((highArea - baseHighArea) / baseHighArea * 100);
      const popDelta = areaDelta > 0 ? Math.round(areaDelta * 0.8) : Math.round(areaDelta * 0.7);
      const critDelta = critCount - baseCrit;

      this.drawSimKpis({
        params, simulated, totalPop, highArea, critCount, highCount,
        areaDelta, popDelta, critDelta,
      });

      // Update summary pill
      const summaryEl = document.getElementById("simSummary");
      if (summaryEl) {
        summaryEl.textContent = isReset
          ? "Baseline scenario applied"
          : `Scenario: +${params.rain - 100}% rain · ${highArea.toLocaleString()} km² high-risk area`;
      }

      // Update sim map and sensitivity chart
      this.refreshSimMap(simulated);
      this.drawSimChart(simulated);
    },

    drawSimKpis(res) {
      const el = document.getElementById("simKpis");
      if (!el) return;
      if (!res) {
        el.innerHTML = [
          ["High-Risk Area", "—", "km²", "Adjust parameters and Run"],
          ["Exposed Population", "—", "people", "Live estimate"],
          ["Critical Zones", "—", "zones", "Scored ≥80"],
          ["Overall Risk", "—", "/100", "Weighted avg"],
        ].map(([l, v, u, s]) => `
          <div class="sim-kpi">
            <div class="sim-kpi-label">${l}</div>
            <div class="sim-kpi-val">${v}<small style="font-size:12px;color:#59739a;font-weight:500;margin-left:4px">${u}</small></div>
            <div class="sim-kpi-sub">${s}</div>
          </div>`).join("");
        return;
      }
      const avg = Math.round(
        res.simulated.reduce((a, b) => a + b.score, 0) / res.simulated.length
      );
      const dArea = res.areaDelta;
      const dPop = res.popDelta;
      const dCrit = res.critDelta;

      const card = (label, val, unit, delta, suffix = "") => {
        const cls = delta === 0 ? "" : delta > 0 ? "delta-up" : "delta-down";
        const arrow = delta === 0 ? "" : delta > 0 ? "▲" : "▼";
        return `<div class="sim-kpi">
          <div class="sim-kpi-label">${label}</div>
          <div class="sim-kpi-val">${(val).toLocaleString()}<small style="font-size:12px;color:#59739a;font-weight:500;margin-left:4px">${unit}</small></div>
          <div class="sim-kpi-sub ${cls}">${arrow} ${Math.abs(delta)}${suffix} vs baseline</div>
        </div>`;
      };
      el.innerHTML =
        card("High-Risk Area", Math.round(res.highArea), "km²", dArea, "%") +
        card("Exposed Population", res.totalPop.toLocaleString(), "people", dPop, "%") +
        card("Critical Zones", res.critCount, "zones", dCrit, "") +
        card("Overall Risk Index", avg, "/100", Math.round(dArea * 0.6), "%");
    },

    drawSimChart(lastSim) {
      const el = document.getElementById("simChart");
      if (!el || !global.Chart) return;
      if (el._terraChart && !lastSim) return;
      if (el._terraChart) el._terraChart.destroy();

      // Sensitivity: vary rainfall from 0 to 300, keep other params current
      const curr = this.currentParams();
      const labels = [];
      const labels2 = [];
      const avgSeries = [], critSeries = [];
      for (let rain = 0; rain <= 300; rain += 25) {
        labels.push(rain + "%");
        const out = this.computeScores({ ...curr, rain });
        const avg = out.reduce((a, b) => a + b.score, 0) / out.length;
        const crit = out.filter((s) => s.level === "CRITICAL").length;
        avgSeries.push(Math.round(avg));
        critSeries.push(crit);
      }
      for (let soil = 0; soil <= 100; soil += 10) {
        labels2.push(soil + "% soil");
      }

      const chart = new Chart(el, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Avg Risk Index",
              data: avgSeries,
              borderColor: "#00E5FF",
              backgroundColor: "rgba(0,229,255,0.15)",
              tension: 0.4,
              fill: true,
              yAxisID: "y",
              borderWidth: 2,
              pointRadius: 3,
            },
            {
              label: "Critical Zones Count",
              data: critSeries,
              borderColor: "#FF1744",
              backgroundColor: "rgba(255,23,68,0.10)",
              tension: 0.4,
              fill: false,
              yAxisID: "y1",
              borderWidth: 2,
              pointRadius: 3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { labels: { color: "#8aa4c7", font: { size: 11 } } },
            title: { display: true, text: "Sensitivity to Rainfall Intensity (others fixed)",
                     color: "#59739a", font: { size: 11, weight: "500" } },
          },
          scales: {
            x: { ticks: { color: "#59739a", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.04)" } },
            y: { type: "linear", position: "left", min: 0, max: 100,
                 ticks: { color: "#00E5FF", font: { size: 10 } },
                 grid: { color: "rgba(255,255,255,0.06)" }, title: { display: true, text: "Index", color: "#00E5FF" } },
            y1: { type: "linear", position: "right", min: 0,
                  ticks: { color: "#FF1744", font: { size: 10 } },
                  grid: { drawOnChartArea: false }, title: { display: true, text: "Count", color: "#FF1744" } },
          },
        },
      });
      el._terraChart = chart;
    },
  };

  global.TerraRisk = {
    RiskView, Simulator,
    drawFactorBars, animateStrokeDash, animateNumber,
    classForScore, pillClassFor,
  };
})(window);
