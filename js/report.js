/* =========================================================
   TerraShield AI · Report / Time / Impact / Data views
   - Time Machine (timeline, animated map)
   - Satellite Before / After change detection
   - Impact Assessment
   - Data sources & methodology
   ========================================================= */
(function (global) {
  "use strict";

  function classFor(s) {
    if (s >= 80) return "CRITICAL";
    if (s >= 60) return "HIGH";
    if (s >= 40) return "MODERATE";
    return "LOW";
  }

  /* ================================================================
     TIME MACHINE
     ================================================================ */
  const TimeMachine = {
    map: null,
    mode: "risk",
    slider: null,
    playing: false,
    playTimer: null,
    frameCount: 120,

    init() {
      const slider = document.getElementById("timelineRange");
      this.slider = slider;
      if (!slider) return;

      // Init map
      this.map = new global.TerraMap("timeMap", { center: [22.5, 78.9], zoom: 5 });
      this.map.init("terrain");
      this.map.addRiskZones(global.TerraData.zones(), true);
      this.map.addHeatmap(global.TerraData.zones(), true);

      // Timeline marks
      const marks = document.getElementById("timelineMarks");
      if (marks) {
        marks.innerHTML = ["Jul 24","Jul 31","Aug 07","Aug 14","Aug 21","Aug 25"]
          .map((d) => `<span>${d}</span>`).join("");
      }

      slider.addEventListener("input", () => this.renderFrame());
      document.getElementById("tmPlay").addEventListener("click", () => this.togglePlay());
      document.getElementById("tmBack").addEventListener("click", () => this.step(-1));
      document.getElementById("tmFwd").addEventListener("click", () => this.step(+1));

      document.querySelectorAll(".tm-modes .btn-chip").forEach((b) => {
        b.addEventListener("click", () => {
          document.querySelectorAll(".tm-modes .btn-chip").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          this.mode = b.dataset.tmMode || "risk";
          this.renderFrame();
        });
      });

      this.renderFrame();
      this.buildMiniTimeline();
      this.buildChangeSummary();
    },

    frameDate(i) {
      // 120 frames = ~8 weeks (Jul 01 -> Aug 25)
      const start = new Date("2026-07-01T00:00:00Z");
      const ms = start.getTime() + (i / (this.frameCount - 1)) * 56 * 24 * 3600 * 1000;
      return new Date(ms);
    },

    step(n) {
      if (!this.slider) return;
      const v = Math.max(0, Math.min(this.frameCount - 1, +this.slider.value + n));
      this.slider.value = v;
      this.renderFrame();
    },

    togglePlay() {
      this.playing = !this.playing;
      const btn = document.getElementById("tmPlay");
      btn.textContent = this.playing ? "⏸ Pause" : "▶ Play";
      if (this.playing) {
        if (+this.slider.value >= this.frameCount - 1) this.slider.value = 0;
        this.playTimer = setInterval(() => this.step(+1), 120);
      } else if (this.playTimer) {
        clearInterval(this.playTimer);
        this.playTimer = null;
      }
    },

    getZonesForFrame(frameIdx) {
      // Create non-linear evolution from ~20% to final score, with spikes near the end
      const zones = global.TerraData.zones();
      const t = frameIdx / (this.frameCount - 1); // 0..1
      // base ramp + sine wobble + late-stage spike
      const ramp = (x) => 0.2 + 0.8 * Math.pow(x, 1.6) + Math.sin(x * 9) * 0.03;
      const lateSpike = t > 0.82 ? ((t - 0.82) / 0.18) * 0.2 : 0;
      const mode = this.mode;
      return zones.map((z, idx) => {
        const seed = (idx * 13 + 7) % 97;
        const wobble = Math.sin(t * 12 + seed) * 0.04;
        let mult = ramp(t) + wobble + lateSpike;
        if (mode === "rain")
          mult = 0.1 + 0.9 * Math.pow(t, 1.2) + Math.sin(t * 11 + seed) * 0.1;
        else if (mode === "vegetation")
          mult = 1.0 - 0.4 * Math.pow(t, 0.7) + Math.sin(t * 6 + seed) * 0.05;
        else if (mode === "soil")
          mult = 0.3 + 0.7 * Math.pow(t, 1.4) + Math.cos(t * 8 + seed) * 0.07;
        mult = Math.max(0.1, Math.min(1.25, mult));

        const baseScore = z.properties.riskScore;
        const newScore = Math.max(5, Math.min(100, Math.round(baseScore * mult)));
        const factor = (k, base) => Math.max(5, Math.min(100, Math.round(base * mult)));
        return {
          ...z,
          properties: {
            ...z.properties,
            riskScore: newScore,
            riskLevel: classFor(newScore),
            factors: {
              slope: factor("slope", z.properties.factors.slope),
              rainfallAnomaly: factor("rain", z.properties.factors.rainfallAnomaly),
              soilMoisture: factor("soil", z.properties.factors.soilMoisture),
              vegetationChange: factor("veg", z.properties.factors.vegetationChange),
              historicalSusceptibility: z.properties.factors.historicalSusceptibility,
              terrainInstability: factor("terr", z.properties.factors.terrainInstability),
            },
          },
        };
      });
    },

    renderFrame() {
      if (!this.slider || !this.map) return;
      const i = +this.slider.value;
      const fillPct = (i / (this.frameCount - 1)) * 100;
      document.getElementById("timelineFill").style.setProperty("--tl-fill", fillPct + "%");
      const d = this.frameDate(i);
      const dateStr = d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
      const hr = String(Math.floor((i % 24))).padStart(2, "0");
      document.getElementById("timelineDate").textContent = `${dateStr} · ${hr}:00`;

      const zs = this.getZonesForFrame(i);
      this.map.clearAllOverlays();
      this.map.addRiskZones(zs, true);
      this.map.addHeatmap(zs, true);

      // Update dates on before/after panel
      const after = this.frameDate(this.frameCount - 1);
      const before = this.frameDate(0);
      const fmt = (x) => x.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
      const be = document.getElementById("beforeDate");
      const ae = document.getElementById("afterDate");
      if (be) be.textContent = fmt(before);
      if (ae) ae.textContent = fmt(after);
    },

    buildChangeSummary() {
      const el = document.getElementById("changeSummary");
      if (!el) return;
      el.innerHTML = `
        <li class="bad">Scar formation visible in Munnar sector NE quadrant — <b>1.2 km²</b> new bare-earth anomaly</li>
        <li class="bad">Road cut failure zone (SH-37) — surface displacement <b>+68%</b> vs pre-monsoon</li>
        <li class="bad">Drainage congestion: 3 tributary channels showing ponding upstream of slides</li>
        <li>Vegetation stress signal across 2 watersheds — NDVI <b>-19%</b></li>
        <li class="good">No new large-scale failures detected outside projected risk envelope</li>
      `;
    },

    buildMiniTimeline() {
      const el = document.getElementById("miniTimeline");
      if (!el) return;
      const events = global.TerraData.landslides()
        .slice()
        .sort((a, b) => b.properties.date.localeCompare(a.properties.date))
        .slice(0, 8);
      el.innerHTML = events.map((e, idx) => `
        <div class="mt-item" style="animation:fadein .35s ease ${idx * 50}ms both">
          <div class="mt-date">${e.properties.date.slice(2)}</div>
          <div>
            <div class="mt-title">${e.properties.magnitude} · ${e.properties.location}</div>
            <div class="mt-sub">${e.properties.trigger} · ${e.properties.fatalities} fatalities · ${(e.properties.volume_m3/1_000_000).toFixed(2)} M m³</div>
          </div>
        </div>
      `).join("");
    },
  };

  /* ================================================================
     IMPACT ASSESSMENT
     ================================================================ */
  const ImpactView = {
    currentZoneId: null,

    init() {
      const sel = document.getElementById("impactZoneSelect");
      if (!sel) return;
      global.TerraData.zonesSortedByRisk().forEach((z) => {
        const o = document.createElement("option");
        o.value = z.id;
        o.textContent = `${z.properties.name} · ${z.properties.riskLevel}`;
        sel.appendChild(o);
      });
      const top = global.TerraData.zonesSortedByRisk()[0];
      if (top) {
        sel.value = top.id;
        this.render(top.id);
      }
      sel.addEventListener("change", (e) => this.render(e.target.value));
    },

    render(zoneId) {
      this.currentZoneId = zoneId;
      const z = global.TerraData.getZoneById(zoneId);
      if (!z) return;
      const p = z.properties;
      const infra = global.TerraData.getInfraForZones([zoneId]);

      // Populations
      const totalPop = (infra.settlements || []).reduce((a, b) => a + (b.population || 0), 0);
      const kpiEl = document.getElementById("impactKpis");
      if (kpiEl) {
        const expoScore = Math.round(
          (p.populationExposed ? p.populationExposed : totalPop) / 1000
        );
        kpiEl.innerHTML = `
          <div class="impact-kpi">
            <div class="impact-kpi-label">Population Exposed</div>
            <div class="impact-kpi-val">${(p.populationExposed || totalPop).toLocaleString()}</div>
            <div class="impact-kpi-sub">Across ${infra.settlements.length} settlements</div>
          </div>
          <div class="impact-kpi">
            <div class="impact-kpi-label">Area at Risk</div>
            <div class="impact-kpi-val">${p.areaSqKm.toLocaleString()} <small style="font-size:14px;color:#59739a">km²</small></div>
            <div class="impact-kpi-sub">Risk score ${p.riskScore} · ${p.riskLevel}</div>
          </div>
          <div class="impact-kpi">
            <div class="impact-kpi-label">Critical Infrastructure</div>
            <div class="impact-kpi-val">${infra.critical.length}</div>
            <div class="impact-kpi-sub">${infra.roads.length} roads · ${infra.rivers.length} river basins</div>
          </div>`;
      }

      this.renderChart(p, infra);
      this.renderExposures(infra, p);
    },

    renderChart(p, infra) {
      const el = document.getElementById("impactChart");
      if (!el || !global.Chart) return;
      if (el._terraChart) el._terraChart.destroy();
      const pop = (infra.settlements || []).reduce((a, b) => a + (b.population || 0), 0) || 50000;
      const roadsKm = (infra.roads || []).reduce((a, b) => a + (b.lengthKm || 0), 0) || 300;
      const buildings = Math.round(pop / 4.5);
      const agri = Math.round(p.areaSqKm * 0.22 * 100) / 100;
      const chart = new Chart(el, {
        type: "bar",
        data: {
          labels: ["Population", "Road km", "Buildings", "Critical Infra", "Agricultural km²", "River basins"],
          datasets: [{
            label: "Exposed assets (estimate)",
            data: [pop, roadsKm, buildings, infra.critical.length * 50, agri, infra.rivers.length * 120],
            backgroundColor: [
              "rgba(0,229,255,0.65)",
              "rgba(255,171,0,0.65)",
              "rgba(179,136,255,0.65)",
              "rgba(255,23,68,0.65)",
              "rgba(0,230,118,0.65)",
              "rgba(66,165,245,0.65)",
            ],
            borderColor: [
              "#00E5FF","#FFAB00","#B388FF","#FF1744","#00E676","#42A5F5"
            ],
            borderWidth: 1.5,
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => " " + ctx.parsed.y.toLocaleString() } },
          },
          scales: {
            x: { ticks: { color: "#8aa4c7", font: { size: 10 } }, grid: { display: false } },
            y: { type: "logarithmic",
                 ticks: { color: "#59739a", font: { size: 10 }, callback: (v) => Number(v).toLocaleString() },
                 grid: { color: "rgba(255,255,255,0.06)" } },
          },
        },
      });
      el._terraChart = chart;
    },

    renderExposures(infra, p) {
      const row = (name, sub, lvl, extraLvl) => `
        <div class="exp-item">
          <div>
            <div class="exp-name">${name}</div>
            <div class="exp-sub">${sub}</div>
          </div>
          <span class="exp-ris ${extraLvl || lvl}">${lvl}</span>
        </div>`;

      const s1 = document.getElementById("expSettlements");
      if (s1) {
        s1.innerHTML = infra.settlements.length
          ? infra.settlements.map((s) =>
              row(s.name, `Pop. ${(s.population || 0).toLocaleString()} · ${s.elevationM}m`,
                  p.riskLevel, s.proximityRisk > 0.85 ? "CRITICAL" : s.proximityRisk > 0.7 ? "HIGH" : "MODERATE")
            ).join("")
          : `<div style="color:#59739a;padding:14px;text-align:center">No settlement overlap in this zone.</div>`;
      }

      const s2 = document.getElementById("expInfra");
      if (s2) {
        s2.innerHTML = infra.critical.length
          ? infra.critical.map((c) =>
              row(c.name, `${c.type} · ${c.riskExposure}`, c.riskExposure)
            ).join("")
          : `<div style="color:#59739a;padding:14px;text-align:center">No critical infrastructure tagged.</div>`;
      }

      const s3 = document.getElementById("expRoads");
      if (s3) {
        s3.innerHTML = infra.roads.length
          ? infra.roads.map((r) =>
              row(r.name, `${r.type} · ${r.lengthKm} km · ${r.lanes} lanes`,
                  r.vulnerability > 0.85 ? "CRITICAL" : r.vulnerability > 0.7 ? "HIGH" : "MODERATE")
            ).join("")
          : `<div style="color:#59739a;padding:14px;text-align:center">No major road corridors.</div>`;
      }
    },
  };

  /* ================================================================
     DATA SOURCES & METHODOLOGY
     ================================================================ */
  const DataView = {
    sources: [
      { name: "NASA Earthdata (GES DISC)", type: "Rainfall / Environmental", status: "SIMULATED", note: "GPM IMERG — API endpoint ready; demo uses statistically representative patterns." },
      { name: "NASA Global Landslide Catalog", type: "Historical events", status: "SIMULATED", note: "Event magnitude/location structure modeled after GLC format." },
      { name: "USGS SRTM 30m DEM", type: "Terrain / Elevation", status: "DERIVED", note: "Slope, aspect, roughness computed via standard GIS pipeline." },
      { name: "ESA Sentinel-1 / -2", type: "InSAR / Vegetation", status: "SIMULATED", note: "Subsidence creep and NDVI change proxies." },
      { name: "OpenStreetMap", type: "Roads / Settlements", status: "PARTIAL", note: "Referenced via Overpass; sample subsets embedded." },
      { name: "IMD / NOAA GFS", type: "Weather forecast", status: "SIMULATED", note: "Rainfall anomaly and accumulation fields." },
      { name: "TerraShield Risk Engine v1.0", type: "AI Model / Scoring", status: "LIVE", note: "Weighted factor model with explainable decomposition." },
    ],

    init() {
      const tbl = document.getElementById("dataSourcesTable");
      if (tbl) {
        tbl.innerHTML = `
          <thead><tr>
            <th>Data Source</th><th>Category</th><th>Status</th><th>Notes</th>
          </tr></thead>
          <tbody>
            ${this.sources.map((s) => `
              <tr>
                <td style="color:#fff;font-weight:600">${s.name}</td>
                <td>${s.type}</td>
                <td class="status-${s.status.toLowerCase()}">${s.status}</td>
                <td>${s.note}</td>
              </tr>`).join("")}
          </tbody>`;
      }

      const method = document.getElementById("methodText");
      if (method) {
        method.innerHTML = `
          <p>The TerraShield <b>Risk Score S ∈ [0, 100]</b> is computed as a weighted combination of six environmental factors:</p>
          <ul>
            <li><code>S = 1.15 × Σ wᵢ · fᵢ</code>, clipped to [0, 100]</li>
            <li><code>w_slope = 0.22</code>, <code>w_rain = 0.24</code>, <code>w_soil = 0.18</code></li>
            <li><code>w_veg = 0.10</code>, <code>w_hist = 0.14</code>, <code>w_instab = 0.12</code></li>
          </ul>
          <h4>Classification</h4>
          <ul>
            <li><b style="color:#00E676">LOW</b>: 0–39 · Monitor</li>
            <li><b style="color:#FFD54F">MODERATE</b>: 40–59 · Watch</li>
            <li><b style="color:#FFAB00">HIGH</b>: 60–79 · Alert</li>
            <li><b style="color:#FF1744">CRITICAL</b>: 80–100 · Warn</li>
          </ul>
          <h4>Confidence</h4>
          <p>Confidence is derived from data-source coverage, agreement between satellite and ground signals, and recency of the last observation. Confidence <code>≥ 85%</code> triggers escalation.</p>
          <h4>Simulator</h4>
          <p>What-if scenarios apply first-order perturbations to the factor values above, with vegetation providing a non-linear stabilizing term (<code>~ (veg/65)^0.4</code>).</p>
        `;
      }

      const drawer = document.getElementById("drawerBody");
      if (drawer) {
        drawer.innerHTML = `
          <h4>Where the data comes from</h4>
          <p>TerraShield AI is architected to accept pluggable live APIs from NASA Earthdata, USGS, ESA Sentinel Hub, IMD/GFS, and OSM/Overpass. In this demo build, all layers are driven by realistic reference datasets matched to published hazard patterns.</p>
          <h4>Layers & Provenance</h4>
          <ul>
            <li><b style="color:#FF1744">Risk Zones</b> · TerraShield Risk Engine output (weighted model)</li>
            <li><b>Heatmap</b> · Kernel-density estimate of zone score × population density</li>
            <li><b>Historical Landslides</b> · NASA GLC-format sample</li>
            <li><b>Roads / Rivers / Settlements</b> · OSM-style extracts</li>
            <li><b>Rainfall / Soil / Slope Overlays</b> · Factor projections as circular buffers</li>
          </ul>
          <h4>Methodology</h4>
          <p>The risk score S = 1.15 × Σ wᵢ·fᵢ (clamped [0,100]). Thresholds for LOW/MODERATE/HIGH/CRITICAL are 0–39, 40–59, 60–79, 80–100.</p>
          <h4>Integrity</h4>
          <p>All simulated data is explicitly flagged. Do not use this demo build for operational or life-safety decisions. In a real emergency, defer to official NDMA / IMD / district administration advisories.</p>
        `;
      }
    },
  };

  global.TerraReport = { TimeMachine, ImpactView, DataView };
})(window);
