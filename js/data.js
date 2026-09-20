/* =========================================================
   TerraShield AI · Data Layer
   Loads JSON data and provides API-ready accessors with
   caching, fallbacks to embedded simulated data, and
   helpers for derived computations.
   ========================================================= */
(function (global) {
  "use strict";

  const Data = {
    _cache: { zones: null, landslides: null, infrastructure: null },
    _loaded: false,

    async loadAll() {
      const [zones, landslides, infra] = await Promise.all([
        this.fetchJSON("data/zones.json", this._fallbackZones),
        this.fetchJSON("data/landslides.json", this._fallbackLandslides),
        this.fetchJSON("data/infrastructure.json", this._fallbackInfrastructure),
      ]);
      this._cache.zones = zones;
      this._cache.landslides = landslides;
      this._cache.infrastructure = infra;
      this._loaded = true;
      return this._cache;
    },

    async fetchJSON(url, fallbackFactory) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Non-OK");
        return await res.json();
      } catch (e) {
        return fallbackFactory();
      }
    },

    zones() { return this._cache.zones ? this._cache.zones.features : []; },
    zonesRaw() { return this._cache.zones; },
    landslides() { return this._cache.landslides ? this._cache.landslides.features : []; },
    infrastructure() { return this._cache.infrastructure; },

    getZoneById(id) {
      return this.zones().find((z) => z.id === id) || null;
    },

    zonesSortedByRisk(desc = true) {
      return [...this.zones()].sort(
        (a, b) =>
          (desc ? 1 : -1) *
          (a.properties.riskScore - b.properties.riskScore)
      );
    },

    zonesByLevel(level) {
      return this.zones().filter((z) => z.properties.riskLevel === level);
    },

    getInfraForZones(zoneIds) {
      const infra = this.infrastructure();
      if (!infra) return { roads: [], settlements: [], critical: [], rivers: [] };
      const inList = (arr) =>
        arr.filter((x) => x.zoneIds && x.zoneIds.some((zid) => zoneIds.includes(zid)));
      return {
        roads: inList(infra.roads),
        settlements: inList(infra.settlements),
        critical: inList(infra.criticalInfrastructure),
        rivers: inList(infra.rivers),
      };
    },

    globalAggregate() {
      const z = this.zones();
      const levelCount = { CRITICAL: 0, HIGH: 0, MODERATE: 0, LOW: 0 };
      let totalPop = 0,
        totalArea = 0,
        sumScore = 0,
        maxScore = 0;
      z.forEach((zone) => {
        const p = zone.properties;
        levelCount[p.riskLevel] = (levelCount[p.riskLevel] || 0) + 1;
        totalPop += p.populationExposed || 0;
        totalArea += p.areaSqKm || 0;
        sumScore += p.riskScore;
        if (p.riskScore > maxScore) maxScore = p.riskScore;
      });
      return {
        levelCount,
        totalPop,
        totalArea,
        avgScore: z.length ? Math.round(sumScore / z.length) : 0,
        maxScore,
        activeZones: z.filter((x) => x.properties.riskLevel !== "LOW").length,
        criticalZones: levelCount.CRITICAL,
      };
    },

    historicalTimeSeries() {
      const ls = this.landslides();
      const byYear = {};
      ls.forEach((e) => {
        const y = (e.properties.date || "").slice(0, 4);
        if (!y) return;
        if (!byYear[y])
          byYear[y] = { year: y, count: 0, fatalities: 0, volume: 0 };
        byYear[y].count += 1;
        byYear[y].fatalities += e.properties.fatalities || 0;
        byYear[y].volume += e.properties.volume_m3 || 0;
      });
      return Object.values(byYear).sort((a, b) => a.year.localeCompare(b.year));
    },

    /* ===== Deterministic pseudo-random series helpers ===== */
    seedSeries(n, seed = 1, min = 0, max = 1) {
      let s = seed;
      const out = [];
      for (let i = 0; i < n; i++) {
        s = (s * 9301 + 49297) % 233280;
        const r = s / 233280;
        out.push(min + r * (max - min));
      }
      return out;
    },

    factorWeights: {
      slope: 0.22,
      rainfallAnomaly: 0.24,
      soilMoisture: 0.18,
      vegetationChange: 0.1,
      historicalSusceptibility: 0.14,
      terrainInstability: 0.12,
    },

    factorMeta: [
      { key: "slope", label: "Slope", color: "#EF5350" },
      { key: "rainfallAnomaly", label: "Rainfall Anomaly", color: "#42A5F5" },
      { key: "soilMoisture", label: "Soil Moisture", color: "#8D6E63" },
      { key: "vegetationChange", label: "Vegetation Change", color: "#66BB6A" },
      { key: "historicalSusceptibility", label: "Historical Susceptibility", color: "#AB47BC" },
      { key: "terrainInstability", label: "Terrain Instability", color: "#FFA726" },
    ],

    _fallbackZones() {
      return { type: "FeatureCollection", features: [] };
    },
    _fallbackLandslides() {
      return { type: "FeatureCollection", features: [] };
    },
    _fallbackInfrastructure() {
      return { roads: [], settlements: [], criticalInfrastructure: [], rivers: [] };
    },
  };

  global.TerraData = Data;
})(window);
