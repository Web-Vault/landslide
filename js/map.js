/* =========================================================
   TerraShield AI · GIS / Map Module
   Builds Leaflet maps (overview, main, time, sim) with
   multiple basemaps, overlays, heatmap, risk zones,
   historical landslides, infrastructure, and interactions.
   ========================================================= */
(function (global) {
  "use strict";

  const TILES = {
    sat: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attr: "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
      maxZoom: 18,
    },
    terrain: {
      url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      attr: "Map data: &copy; <a href='https://www.openstreetmap.org/copyright'>OSM</a> contributors, <a href='http://viewfinderpanoramas.org'>SRTM</a> | Map style: &copy; <a href='https://opentopomap.org'>OpenTopoMap</a>",
      maxZoom: 17,
    },
    dark: {
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      attr: "&copy; <a href='https://www.openstreetmap.org/copyright'>OSM</a> &copy; <a href='https://carto.com/attributions'>CARTO</a>",
      maxZoom: 20,
    },
    labels: {
      url: "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
      attr: "",
      maxZoom: 20,
    },
  };

  function riskToColor(level, alpha = 0.35) {
    switch (level) {
      case "CRITICAL": return `rgba(255, 23, 68, ${alpha})`;
      case "HIGH":     return `rgba(255, 171, 0, ${alpha})`;
      case "MODERATE": return `rgba(255, 213, 79, ${alpha})`;
      case "LOW":      return `rgba(0, 230, 118, ${alpha})`;
      default:         return `rgba(255,255,255,${alpha})`;
    }
  }
  function riskToStroke(level) {
    switch (level) {
      case "CRITICAL": return "#FF1744";
      case "HIGH":     return "#FFAB00";
      case "MODERATE": return "#FFD54F";
      case "LOW":      return "#00E676";
      default:         return "#ffffff";
    }
  }

  function scoreToColor(score, alpha = 0.6) {
    let r, g, b;
    if (score < 40)      { r = 0;   g = 230; b = 118; }
    else if (score < 60) { r = 255; g = 213; b = 79; }
    else if (score < 80) { r = 255; g = 171; b = 0; }
    else                 { r = 255; g = 23;  b = 68; }
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function getLatLngForZone(zone) {
    if (zone.center) return L.latLng(zone.center[0], zone.center[1]);
    if (zone.geometry && zone.geometry.type === "Polygon") {
      const coords = zone.geometry.coordinates[0];
      let lat = 0, lon = 0;
      coords.forEach((c) => { lon += c[0]; lat += c[1]; });
      return L.latLng(lat / coords.length, lon / coords.length);
    }
    return L.latLng(20.5937, 78.9629);
  }

  class TerraMap {
    constructor(elId, opts = {}) {
      this.id = elId;
      this.opts = opts;
      this.map = null;
      this.basemapLayer = null;
      this.labelLayer = null;
      this.layers = {};
      this.onZoneClick = opts.onZoneClick || null;
      this._lastOpacity = 0.8;
    }

    init(initialBasemap = "terrain") {
      const el = document.getElementById(this.id);
      if (!el) return null;
      this.map = L.map(el, {
        zoomControl: true,
        attributionControl: true,
        worldCopyJump: true,
        preferCanvas: true,
        minZoom: 3,
        maxZoom: 16,
      }).setView(this.opts.center || [22.5, 78.9], this.opts.zoom || 5);

      this.setBasemap(initialBasemap);
      L.control.scale({ imperial: false, position: "bottomleft" }).addTo(this.map);

      // Update HUD if elements exist
      if (document.getElementById("hudLat")) {
        this.map.on("mousemove", (e) => {
          document.getElementById("hudLat").textContent =
            "LAT " + e.latlng.lat.toFixed(3);
          document.getElementById("hudLon").textContent =
            "LON " + e.latlng.lng.toFixed(3);
        });
        this.map.on("zoomend", () => {
          document.getElementById("hudZoom").textContent =
            "ZOOM " + this.map.getZoom();
        });
        document.getElementById("hudZoom").textContent = "ZOOM " + this.map.getZoom();
      }

      return this.map;
    }

    setBasemap(kind) {
      if (!this.map) return;
      if (this.basemapLayer) this.map.removeLayer(this.basemapLayer);
      if (this.labelLayer) this.map.removeLayer(this.labelLayer);
      const cfg = TILES[kind] || TILES.terrain;
      this.basemapLayer = L.tileLayer(cfg.url, {
        attribution: cfg.attr,
        maxZoom: cfg.maxZoom,
      }).addTo(this.map);
      if (kind === "sat") {
        const lc = TILES.labels;
        this.labelLayer = L.tileLayer(lc.url, { maxZoom: lc.maxZoom }).addTo(this.map);
      }
    }

    clearAllOverlays() {
      Object.values(this.layers).forEach((layer) => {
        if (this.map.hasLayer(layer)) this.map.removeLayer(layer);
      });
      this.layers = {};
    }

    /* ----- Risk zone polygons ----- */
    addRiskZones(zones, show = true) {
      if (!this.map) return;
      const geojson = L.geoJSON(
        { type: "FeatureCollection", features: zones },
        {
          style: (feat) => {
            const lvl = feat.properties.riskLevel || "MODERATE";
            return {
              fillColor: riskToColor(lvl, 0.45 * this._lastOpacity),
              weight: 2,
              opacity: 0.95,
              color: riskToStroke(lvl),
              dashArray: "4 2",
              fillOpacity: 0.45 * this._lastOpacity,
            };
          },
          onEachFeature: (feat, layer) => {
            layer.bindTooltip(
              `<b>${feat.properties.name}</b><br>` +
                `<span style="color:${riskToStroke(feat.properties.riskLevel)};font-weight:700">${feat.properties.riskLevel}</span> · Score ${feat.properties.riskScore}`,
              { direction: "top", opacity: 0.95, className: "rp-tooltip" }
            );
            layer.on("click", (e) => {
              L.DomEvent.stopPropagation(e);
              if (this.onZoneClick) this.onZoneClick(feat, layer);
              // pulse
              this.pulseLayer(layer, feat.properties.riskLevel);
            });
          },
        }
      );
      this.layers.risk = geojson;
      if (show) this.map.addLayer(geojson);
      return geojson;
    }

    setOverlayOpacity(opacity) {
      this._lastOpacity = opacity;
      if (this.layers.risk) {
        this.layers.risk.setStyle((feat) => {
          const lvl = feat.properties.riskLevel || "MODERATE";
          return {
            fillColor: riskToColor(lvl, 0.45 * opacity),
            fillOpacity: 0.45 * opacity,
            opacity: Math.min(1, 0.7 + opacity * 0.3),
          };
        });
      }
      if (this.layers.heat) this.layers.heat.setOptions({ opacity: 0.7 * opacity });
    }

    pulseLayer(layer, level) {
      const original = layer.options;
      const baseColor = riskToStroke(level);
      let count = 0;
      const interval = setInterval(() => {
        count++;
        const mult = count % 2 === 0 ? 1 : 3;
        layer.setStyle({ weight: original.weight * mult, color: baseColor });
        if (count > 3) {
          clearInterval(interval);
          layer.setStyle({ weight: original.weight, color: baseColor });
        }
      }, 120);
    }

    /* ----- Heatmap points around zones ----- */
    addHeatmap(zones, show = true) {
      if (!this.map) return;
      const pts = [];
      zones.forEach((z) => {
        const center = getLatLngForZone(z);
        const score = z.properties.riskScore;
        const spread = 0.35 + (score / 100) * 0.3;
        const n = 30 + Math.floor((score / 100) * 70);
        const seed = z.id ? z.id.charCodeAt(z.id.length - 1) : 1;
        let s = seed;
        for (let i = 0; i < n; i++) {
          s = (s * 9301 + 49297) % 233280;
          const u1 = s / 233280;
          s = (s * 9301 + 49297) % 233280;
          const u2 = s / 233280;
          const r = Math.sqrt(-2 * Math.log(u1)) * spread * 0.3;
          const theta = 2 * Math.PI * u2;
          const lat = center.lat + r * Math.cos(theta);
          const lon = center.lng + r * Math.sin(theta);
          pts.push([lat, lon, score / 100]);
        }
      });
      if (!global.L || !L.heatLayer) {
        // fallback: circleMarkers (no dependency)
        const group = L.layerGroup();
        pts.forEach((p) => {
          L.circleMarker([p[0], p[1]], {
            radius: 2,
            weight: 0,
            fillColor: scoreToColor(Math.round(p[2] * 100), 0.6),
            fillOpacity: 0.55 * this._lastOpacity,
          }).addTo(group);
        });
        this.layers.heat = group;
      } else {
        this.layers.heat = L.heatLayer(pts, {
          radius: 18,
          blur: 22,
          maxZoom: 10,
          opacity: 0.7 * this._lastOpacity,
          gradient: {
            0.2: "rgba(0,230,118,0.4)",
            0.4: "rgba(255,213,79,0.55)",
            0.6: "rgba(255,171,0,0.7)",
            0.8: "rgba(255,23,68,0.85)",
            1.0: "rgba(255,23,68,1)",
          },
        });
      }
      if (show) this.map.addLayer(this.layers.heat);
    }

    /* ----- Historical landslide markers ----- */
    addHistorical(landslides, show = true) {
      if (!this.map) return;
      const cluster = L.markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
      });
      landslides.forEach((f) => {
        if (!f.geometry) return;
        const [lon, lat] = f.geometry.coordinates;
        const p = f.properties;
        const mag = p.magnitude || "Moderate";
        const r =
          mag === "Catastrophic" ? 11 :
          mag === "Severe" ? 9 :
          mag === "Major" ? 7 :
          mag === "Moderate" ? 5 : 4;
        const color =
          mag === "Catastrophic" ? "#FF1744" :
          mag === "Severe" ? "#D50000" :
          mag === "Major" ? "#FF6E40" :
          mag === "Moderate" ? "#FFB300" : "#FFD54F";
        const m = L.circleMarker([lat, lon], {
          radius: r,
          fillColor: color,
          color: "#ffffff",
          weight: 1.5,
          fillOpacity: 0.85,
        });
        m.bindPopup(
          `<b>${p.id}</b> · ${p.date}<br>` +
            `<b>${p.location}</b><br>` +
            `Magnitude: <b>${p.magnitude}</b><br>` +
            `Trigger: ${p.trigger}<br>` +
            `Fatalities: ${p.fatalities} · Casualties: ${p.casualties}<br>` +
            `Volume: ${(p.volume_m3 / 1_000_000).toFixed(2)} M m³`
        );
        cluster.addLayer(m);
      });
      this.layers.historical = cluster;
      if (show) this.map.addLayer(cluster);
    }

    /* ----- Infrastructure lines / points ----- */
    addInfrastructure(infra, show = true) {
      if (!this.map) return;
      const group = L.layerGroup();

      // Rivers -> dashed line between zone centers (simulated)
      (infra.rivers || []).forEach((riv) => {
        const zoneIds = riv.zoneIds || [];
        const zs = zoneIds
          .map((id) => global.TerraData.getZoneById(id))
          .filter(Boolean)
          .map(getLatLngForZone);
        if (zs.length >= 2) {
          L.polyline(zs, {
            color: "#4FC3F7",
            weight: 2.5,
            opacity: 0.75,
            dashArray: "6 5",
          }).addTo(group).bindTooltip(`🌊 ${riv.name}`);
        }
      });

      // Roads
      (infra.roads || []).forEach((rd) => {
        const zs = (rd.zoneIds || [])
          .map((id) => global.TerraData.getZoneById(id))
          .filter(Boolean)
          .map(getLatLngForZone);
        if (zs.length >= 2) {
          L.polyline(zs, {
            color: rd.vulnerability > 0.8 ? "#FF6E40" :
                   rd.vulnerability > 0.6 ? "#FFB300" : "#8BC34A",
            weight: 2,
            opacity: 0.85,
          }).addTo(group).bindTooltip(`🛣 ${rd.name}`);
        }
      });

      // Settlements
      (infra.settlements || []).forEach((setl) => {
        const z = global.TerraData.getZoneById((setl.zoneIds || [])[0]);
        if (!z) return;
        const c = getLatLngForZone(z);
        // Jitter
        const lat = c.lat + (((setl.id.charCodeAt(3) || 5) % 20) - 10) / 50;
        const lon = c.lng + (((setl.id.charCodeAt(5) || 7) % 20) - 10) / 50;
        L.circleMarker([lat, lon], {
          radius: 3 + Math.min(8, Math.log10(setl.population || 100) * 1.5),
          fillColor: "#00E5FF",
          color: "#ffffff",
          weight: 1,
          fillOpacity: 0.8,
        }).addTo(group).bindTooltip(
          `🏠 <b>${setl.name}</b><br>Pop: ${(setl.population).toLocaleString()}<br>Elev: ${setl.elevationM}m`
        );
      });

      // Critical infrastructure -> star markers
      const critIcon = L.divIcon({
        className: "crit-icon",
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#B388FF;box-shadow:0 0 10px #B388FF;border:1.5px solid #fff;"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      (infra.criticalInfrastructure || []).forEach((c) => {
        const z = global.TerraData.getZoneById((c.zoneIds || [])[0]);
        if (!z) return;
        const cnt = getLatLngForZone(z);
        const lat = cnt.lat + (((c.id.charCodeAt(2) || 3) % 20) - 10) / 45;
        const lon = cnt.lng + (((c.id.charCodeAt(4) || 9) % 20) - 10) / 45;
        L.marker([lat, lon], { icon: critIcon })
          .addTo(group)
          .bindTooltip(
            `⚡ <b>${c.name}</b><br>Type: ${c.type}<br>Exposure: ${c.riskExposure}`
          );
      });

      this.layers.infra = group;
      if (show) this.map.addLayer(group);
    }

    /* ----- Special overlays (simulated) ----- */
    addRainfallOverlay(zones, show = true) {
      if (!this.map) return;
      const group = L.layerGroup();
      zones.forEach((z) => {
        const c = getLatLngForZone(z);
        const rain = z.properties.factors.rainfallAnomaly || 50;
        const radiusMeters = (30 + rain / 2) * 1000;
        L.circle(c, {
          radius: radiusMeters,
          color: "#42A5F5",
          weight: 1,
          opacity: 0.7,
          fillColor: "#42A5F5",
          fillOpacity: 0.18 + (rain / 100) * 0.25,
          dashArray: "3 5",
        }).addTo(group).bindTooltip(`🌧 Rainfall anomaly: ${rain}%`);
      });
      this.layers.rain = group;
      if (show) this.map.addLayer(group);
    }

    addSoilOverlay(zones, show = true) {
      if (!this.map) return;
      const group = L.layerGroup();
      zones.forEach((z) => {
        const c = getLatLngForZone(z);
        const soil = z.properties.factors.soilMoisture || 50;
        const r = (20 + soil / 3) * 1000;
        L.circle(c, {
          radius: r,
          color: "#8D6E63",
          weight: 1,
          opacity: 0.7,
          fillColor: "#6D4C41",
          fillOpacity: 0.15 + (soil / 100) * 0.3,
        }).addTo(group).bindTooltip(`🟫 Soil moisture: ${soil}%`);
      });
      this.layers.soil = group;
      if (show) this.map.addLayer(group);
    }

    addSlopeOverlay(zones, show = true) {
      if (!this.map) return;
      const group = L.layerGroup();
      zones.forEach((z) => {
        const c = getLatLngForZone(z);
        const slope = z.properties.factors.slope || 50;
        const r = (18 + slope / 3) * 1000;
        L.circle(c, {
          radius: r,
          color: "#EF5350",
          weight: 1.2,
          opacity: 0.6,
          fillColor: "#EF5350",
          fillOpacity: 0.08 + (slope / 100) * 0.22,
          dashArray: "10 8",
        }).addTo(group).bindTooltip(`⛰ Slope factor: ${slope}%`);
      });
      this.layers.slope = group;
      if (show) this.map.addLayer(group);
    }

    addAdminBoundaries(show = true) {
      if (!this.map) return;
      if (this.layers.boundaries) {
        if (show) this.map.addLayer(this.layers.boundaries);
        return;
      }
      const group = L.layerGroup();
      // Simulated India state-level polygon approximation (outline box as demo)
      L.rectangle(
        [[6.75, 68.12], [35.5, 97.4]],
        { color: "rgba(0,229,255,0.4)", weight: 1, fill: false, dashArray: "5 8" }
      ).addTo(group);
      this.layers.boundaries = group;
      if (show) this.map.addLayer(group);
    }

    toggleLayer(name, on) {
      if (!this.map || !this.layers[name]) return;
      const has = this.map.hasLayer(this.layers[name]);
      if (on === undefined) on = !has;
      if (on && !has) this.map.addLayer(this.layers[name]);
      else if (!on && has) this.map.removeLayer(this.layers[name]);
    }

    hasLayer(name) {
      return !!(this.layers[name] && this.map.hasLayer(this.layers[name]));
    }

    flyToZone(zoneId) {
      const z = global.TerraData.getZoneById(zoneId);
      if (!z || !this.map) return false;
      const c = getLatLngForZone(z);
      this.map.flyTo(c, 10, { duration: 1.1 });
      return true;
    }

    flyToLatLng(lat, lng, zoom = 10) {
      if (!this.map) return;
      this.map.flyTo([lat, lng], zoom, { duration: 1 });
    }

    invalidateSize() {
      if (this.map) this.map.invalidateSize();
    }
  }

  global.TerraMap = TerraMap;
  global.TerraMapUtil = { riskToColor, riskToStroke, scoreToColor, getLatLngForZone };
})(window);
