window.addEventListener("DOMContentLoaded", () => {
  mapboxgl.accessToken =
    "pk.eyJ1IjoiMjk0NDg3MHciLCJhIjoiY21rY251N2FpMDJ3dTNrc2N2dGV2MmJ4ZiJ9.k7Y78Zo5d13WxwxqFB-aKQ";

  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/2944870w/cmlokdcq3004201r33ihlbq8z",
    center: [-3.189, 55.9521],
    zoom: 12
  });

  /* ---------- constants ---------- */
  const LAYER_ID = "edinburgh-hotel";
  const FIXED_RADIUS_M = 500;

  // Edinburgh bbox: [west, south, east, north]
  const CITY_BBOX = [-3.45, 55.86, -3.05, 56.02];

  const CIRCLE_SOURCE_ID = "dest-circle";
  const CIRCLE_FILL_LAYER_ID = "dest-circle-fill";
  const CIRCLE_LINE_LAYER_ID = "dest-circle-line";

  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter"
  ];

  /* ---------- DOM ---------- */
  const resultCountEl = document.querySelector(".result-count");
  const downloadBtn = document.querySelector(".download-btn");

  const typeBtn = document.querySelector(".type-btn");
  const typePanel = document.querySelector(".type-panel");

  const destBtn = document.querySelector(".dest-btn");
  const destPanel = document.querySelector(".dest-panel");
  const destSelect = document.querySelector(".dest-select");

  let selectedType = "all";
  let selectedPoi = null;

  let allHotels = [];
  let cacheReady = false;
  
  /* ---------- Collapsible info panel (Title panel) ---------- */
const panel = document.getElementById("title-panel");
const toggleBtn = document.getElementById("toggle-info");
const panelBody = document.getElementById("panel-body");

if (panel && toggleBtn && panelBody) {
  // 初始折叠（可选：如果你HTML里没写 hidden）
  panelBody.hidden = true;
  toggleBtn.setAttribute("aria-expanded", "false");

  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // 防止你外面的 document click 逻辑把面板“顺手关掉”
    const isOpen = toggleBtn.getAttribute("aria-expanded") === "true";
    toggleBtn.setAttribute("aria-expanded", String(!isOpen));
    panelBody.hidden = isOpen;
    panel.classList.toggle("is-open", !isOpen);
  });

  // 可选：点面板内部不要触发 document click
  panel.addEventListener("click", (e) => e.stopPropagation());
}

  
 /* ---------- LEGEND (fixed on map, icons from Mapbox sprite, no parsing icon-image)  ---------- */
  const LEGEND_ID = "map-legend-fixed";
  let spriteMeta = null;
  let spriteImg = null;
  let spriteLoading = null;
  function injectLegendCSSOnce() {
    if (document.getElementById("legend-css-fixed")) return;
    const css = document.createElement("style");
    css.id = "legend-css-fixed";
    css.textContent = `
      #${LEGEND_ID}{
        position:absolute;
        right:10px;
        bottom:20px;
        z-index:28;
        background:#fff;
        color:#000;
        border-radius:5px;
        padding:11px 11px;
        width:120px;
        box-shadow:0 10px 28px rgba(0,0,0,.18);
        font-family:Lato,sans-serif;
        opacity: 0.85;
      }
      #${LEGEND_ID} .legend-title{
        font-weight:800;
        font-size:15px;
        margin-bottom:12px;
      }
      #${LEGEND_ID} .legend-row{
        display:flex;
        align-items:center;
        gap:12px;
        font-size:12px;
        font-weight:600;
        margin:10px 0;
      }
      #${LEGEND_ID} img{
        width:28px;height:25px;flex:0 0 28px;display:block;
        background:rgba(255,255,255,0.08);
        border-radius:6px;
        object-fit:contain;
      }
    `;
    document.head.appendChild(css);
  }
  function removeOldLegendIfAny() {
    const old = document.getElementById(LEGEND_ID);
    if (old) old.remove();
  }
  function ensureLegendContainer() {
    removeOldLegendIfAny();
    injectLegendCSSOnce();
    const el = document.createElement("div");
    el.id = LEGEND_ID;
    el.innerHTML = `
      <div class="legend-title">Legend</div>
      <div class="legend-body"></div>
    `;
    map.getContainer().appendChild(el);
    return el;
  }

  // mapbox://sprites/user/styleId -> https://api.mapbox.com/styles/v1/user/styleId/sprite
  function spriteBaseToHttps(spriteBase) {
    if (!spriteBase) return null;
    if (spriteBase.startsWith("https://")) return spriteBase;
    if (!spriteBase.startsWith("mapbox://sprites/")) return null;
    const rest = spriteBase.replace("mapbox://sprites/", "");
    return `https://api.mapbox.com/styles/v1/${rest}/sprite`;
  }
  async function loadSpriteOnce() {
    if (spriteMeta && spriteImg) return;
    if (spriteLoading) return spriteLoading;
    spriteLoading = (async () => {
      const rawBase = map.getStyle().sprite;
      const httpsBase = spriteBaseToHttps(rawBase);
      if (!httpsBase) throw new Error("Cannot resolve sprite URL from style.");
      const use2x = (window.devicePixelRatio || 1) > 1.2;
      const suffix = use2x ? "@2x" : "";
      const jsonUrl = `${httpsBase}${suffix}.json?access_token=${mapboxgl.accessToken}`;
      const pngUrl = `${httpsBase}${suffix}.png?access_token=${mapboxgl.accessToken}`;
      const meta = await fetch(jsonUrl).then((r) => {
        if (!r.ok) throw new Error("Sprite JSON fetch failed");
        return r.json();
      });
      const blob = await fetch(pngUrl).then((r) => {
        if (!r.ok) throw new Error("Sprite PNG fetch failed");
        return r.blob();
      });
      const objUrl = URL.createObjectURL(blob);
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = objUrl;
      });
      spriteMeta = meta;
      spriteImg = img;
    })();

    return spriteLoading;
  }
  function normalizeIconKey(name) {
    return String(name)
      .toLowerCase()
      .trim()
      .replace(/\s*\(\d+\)\s*/g, "")     // remove (1)(2)...
      .replace(/[_\s]+/g, "-");          // unify _ and space -> -
  }
  function findExistingSpriteKey(candidates) {
    // 1) direct hit
    for (const c of candidates) {
      if (spriteMeta?.[c]) return c;
    }
    // 2) normalized fuzzy match: icon-hotel == icon-hotel (2) etc
    const want = candidates.map(normalizeIconKey);
    for (const k of Object.keys(spriteMeta || {})) {
      const nk = normalizeIconKey(k);
      if (want.includes(nk)) return k;
    }
    return null;
  }
  async function spriteIconToDataURL(iconKey) {
    await loadSpriteOnce();
    const entry = spriteMeta?.[iconKey];
    if (!entry) return null;
    const { x, y, width, height } = entry;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(spriteImg, x, y, width, height, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  }
  async function buildLegendFixed() {
    const legend = ensureLegendContainer();
    const body = legend.querySelector(".legend-body");
    body.innerHTML = "";
    await loadSpriteOnce();
    const items = [
      { label: "Hotel",       candidates: ["icon-hotel"] },
      { label: "Hostel",      candidates: ["icon-hostel"] },
      { label: "Guest_house", candidates: ["icon-guesthouse"] },
      { label: "Apartment",   candidates: ["icon-apartment"] }
    ];
    for (const it of items) {
      const key = findExistingSpriteKey(it.candidates);
      const row = document.createElement("div");
      row.className = "legend-row";
      const img = document.createElement("img");
      img.alt = it.label;
      if (key) {
        const dataUrl = await spriteIconToDataURL(key);
        if (dataUrl) img.src = dataUrl;
      } else {
        img.src =
          "data:image/svg+xml;charset=utf-8," +
          encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" rx="6" ry="6" fill="rgba(255,255,255,0.15)"/></svg>`);
      }
      const text = document.createElement("span");
      text.textContent = it.label;
      row.appendChild(img);
      row.appendChild(text);
      body.appendChild(row);
    }
  }

  /* ---------- controls ---------- */
  map.addControl(
    new MapboxGeocoder({
      accessToken: mapboxgl.accessToken,
      mapboxgl,
      marker: false,
      placeholder: "Search for places in Edinburgh",
      proximity: { longitude: -3.189, latitude: 55.9521 }
    }),
    "top-right"
  );
  map.addControl(new mapboxgl.NavigationControl(), "top-right");
  map.addControl(
    new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserHeading: true
    }),
    "top-right"
  );
  map.addControl(new mapboxgl.ScaleControl({ maxWidth: 150, unit: "metric" }), "bottom-right");

  /* ---------- popup on click ---------- */
  map.on("click", (event) => {
    const features = map.queryRenderedFeatures(event.point, { layers: [LAYER_ID] });
    if (!features.length) return;
    const feature = features[0];
    const addressParts = [
      feature.properties?.["addr:housenumber"],
      feature.properties?.["addr:street"],
      feature.properties?.["addr:city"]
    ].filter(Boolean);
    const address = addressParts.join(", ");
    const website = feature.properties?.website;
    const websiteHtml = website
      ? `<p>Website: <a href="${website}" target="_blank" rel="noopener noreferrer">${website}</a></p>`
      : "";
    const html = [
      `<h3>Hotel Name: ${feature.properties?.name ?? "Unknown"}</h3>`,
      feature.properties?.tourism ? `<p>Type: ${feature.properties.tourism}</p>` : "",
      address ? `<p>Address: ${address}</p>` : "",
      feature.properties?.["addr:postcode"] ? `<p>Postcode: ${feature.properties["addr:postcode"]}</p>` : "",
      feature.properties?.phone ? `<p>Phone: ${feature.properties.phone}</p>` : "",
      websiteHtml
    ].filter(Boolean).join("");
    new mapboxgl.Popup({ offset: [0, 15], className: "my-popup" })
      .setLngLat(feature.geometry.coordinates)
      .setHTML(html)
      .addTo(map);
  });
  map.on("mousemove", (e) => {
    const f = map.queryRenderedFeatures(e.point, { layers: [LAYER_ID] });
    map.getCanvas().style.cursor = f.length ? "pointer" : "";
  });

  /* ---------- helpers ---------- */
  function parseLngLat(value) {
    if (!value || value === "none") return null;
    const parts = value.split(",").map((v) => Number(v.trim()));
    if (parts.length !== 2 || parts.some(Number.isNaN)) return null;
    return [parts[0], parts[1]];
  }
  function normalizeTourism(val) {
    return String(val ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  }
  function buildTypeFilter() {
    if (selectedType === "all") return true;
    return ["==", ["get", "tourism"], selectedType];
  }
  function buildWithinFilter() {
    if (!selectedPoi) return true;
    const circle = turf.circle(selectedPoi, FIXED_RADIUS_M / 1000, { steps: 64, units: "kilometers" });
    return ["within", circle.geometry];
  }
  function applyCombinedFilter() {
    if (!map.getLayer(LAYER_ID)) return;
    map.setFilter(LAYER_ID, ["all", buildTypeFilter(), buildWithinFilter()]);
    updateResultCount();
  }

  /* ---------- destination circle ---------- */
  function setDestinationCircle(lngLat) {
    const src = map.getSource(CIRCLE_SOURCE_ID);
    if (!src) return;
    if (!lngLat) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const circle = turf.circle(lngLat, FIXED_RADIUS_M / 1000, { steps: 96, units: "kilometers" });
    src.setData(circle);
  }

  /* ---------- panel helpers ---------- */
  function setBtnText(btn, panel, baseText) {
    if (!btn || !panel) return;
    btn.textContent = panel.classList.contains("is-hidden") ? `${baseText} ▾` : `${baseText} ▴`;
  }
  function closePanel(btn, panel, baseText) {
    if (!btn || !panel) return;
    panel.classList.add("is-hidden");
    setBtnText(btn, panel, baseText);
  }
  function togglePanel(btn, panel, baseText) {
    if (!btn || !panel) return;
    panel.classList.toggle("is-hidden");
    setBtnText(btn, panel, baseText);
  }
  function closeAllPanels() {
    closePanel(typeBtn, typePanel, "Filter by accommodation type ");
    closePanel(destBtn, destPanel, "Filter by destination area ");
  }

  /* ---------- global-count logic (whole Edinburgh) ---------- */
  function featurePassesFilters(f) {
    if (selectedType !== "all") {
      const t = normalizeTourism(f.properties?.tourism);
      const sel = normalizeTourism(selectedType);
      if (t !== sel) return false;
    }
    if (selectedPoi) {
      const coords = f.geometry?.coordinates;
      if (!coords) return false;
      const dKm = turf.distance(turf.point(selectedPoi), turf.point(coords), { units: "kilometers" });
      if (dKm > FIXED_RADIUS_M / 1000) return false;
    }
    return true;
  }
  function updateResultCount() {
    if (!resultCountEl) return;
    if (!cacheReady) {
      resultCountEl.textContent = "Number of accommodations displayed : …";
      return;
    }
    const count = allHotels.reduce((acc, f) => acc + (featurePassesFilters(f) ? 1 : 0), 0);
    resultCountEl.textContent = `Number of accommodations displayed : ${count}`;
  }

  /* ---------- Overpass global cache (reliable) ---------- */
  async function fetchOverpass(endpoint, query) {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=UTF-8" },
      body: query
    });
    if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`);
    return resp.json();
  }
  function overpassToGeoJSONPoints(data) {
    const feats = (data.elements || [])
      .map((el) => {
        const lon = el.lon ?? el.center?.lon;
        const lat = el.lat ?? el.center?.lat;
        if (lon == null || lat == null) return null;

        return {
          type: "Feature",
          id: `${el.type}/${el.id}`,
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: { ...(el.tags || {}), _osm_type: el.type, _osm_id: el.id }
        };
      })
      .filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const f of feats) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push(f);
    }
    return out;
  }
  async function buildGlobalCacheOnce() {
    if (cacheReady) return;
    if (resultCountEl) resultCountEl.textContent = "Number of accommodations displayed : …";
    const [w, s, e, n] = CITY_BBOX;
    const query = `
[out:json][timeout:60];
(
  node["tourism"~"^(hotel|hostel|guest_house|apartment)$"](${s},${w},${n},${e});
  way["tourism"~"^(hotel|hostel|guest_house|apartment)$"](${s},${w},${n},${e});
  relation["tourism"~"^(hotel|hostel|guest_house|apartment)$"](${s},${w},${n},${e});
);
out center tags;
    `.trim();
    let lastErr = null;
    for (const ep of OVERPASS_ENDPOINTS) {
      try {
        const data = await fetchOverpass(ep, query);
        allHotels = overpassToGeoJSONPoints(data);
        cacheReady = true;
        updateResultCount();
        return;
      } catch (err) {
        console.warn("Overpass failed:", ep, err);
        lastErr = err;
      }
    }
    console.error("All Overpass endpoints failed:", lastErr);
    cacheReady = false;
    if (resultCountEl) resultCountEl.textContent = "Number of accommodations displayed : (failed to load)";
  }

  /* ---------- download (global filtered results) ---------- */
  function downloadGeoJSON(filename, geojsonObj) {
    const blob = new Blob([JSON.stringify(geojsonObj, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      if (!cacheReady) return;
      const filtered = allHotels.filter(featurePassesFilters);
      const fc = {
        type: "FeatureCollection",
        features: filtered.map((f) => ({
          type: "Feature",
          geometry: f.geometry,
          properties: f.properties || {}
        }))
      };
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadGeoJSON(`edinburgh-hotels-filtered-${dateStr}.geojson`, fc);
    });
  }

  /* ---------- UI events ---------- */
  if (typeBtn && typePanel) {
    setBtnText(typeBtn, typePanel, "Filter by accommodation type ");
    typeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closePanel(destBtn, destPanel, "Filter by destination area ");
      togglePanel(typeBtn, typePanel, "Filter by accommodation type ");
    });
    typePanel.addEventListener("click", (e) => e.stopPropagation());
    typePanel.addEventListener("change", (e) => {
      if (e.target && e.target.name === "hotelType") {
        selectedType = e.target.value;
        applyCombinedFilter();
      }
    });
  }

  if (destBtn && destPanel) {
    setBtnText(destBtn, destPanel, "Filter by destination area ");
    destBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closePanel(typeBtn, typePanel, "Filter by accommodation type ");
      togglePanel(destBtn, destPanel, "Filter by destination area ");
    });
    destPanel.addEventListener("click", (e) => e.stopPropagation());
  }
  document.addEventListener("click", () => closeAllPanels());
  if (destSelect) {
    destSelect.addEventListener("change", () => {
      selectedPoi = parseLngLat(destSelect.value);
      setDestinationCircle(selectedPoi);
      applyCombinedFilter();
      if (selectedPoi) {
        map.flyTo({ center: selectedPoi, zoom: 15.5, speed: 0.9, curve: 1.2, essential: true });
      } else {
        map.flyTo({ center: [-3.189, 55.9521], zoom: 12, speed: 0.9, curve: 1.2, essential: true });
      }
    });
  }

  /* ---------- load ---------- */
  map.on("load", async () => {
    if (!map.getLayer(LAYER_ID)) {
      console.warn("Layer not found:", LAYER_ID);
      return;
    }
    if (!map.getSource(CIRCLE_SOURCE_ID)) {
      map.addSource(CIRCLE_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
    }
    if (!map.getLayer(CIRCLE_FILL_LAYER_ID)) {
      map.addLayer(
        {
          id: CIRCLE_FILL_LAYER_ID,
          type: "fill",
          source: CIRCLE_SOURCE_ID,
          paint: { "fill-color": "#00bcd4", "fill-opacity": 0.18 }
        },
        LAYER_ID
      );
    }
    if (!map.getLayer(CIRCLE_LINE_LAYER_ID)) {
      map.addLayer(
        {
          id: CIRCLE_LINE_LAYER_ID,
          type: "line",
          source: CIRCLE_SOURCE_ID,
          paint: { "line-color": "#00bcd4", "line-width": 2.5 }
        },
        LAYER_ID
      );
    }
    selectedPoi = destSelect ? parseLngLat(destSelect.value) : null;
    setDestinationCircle(selectedPoi);
    applyCombinedFilter();
    buildGlobalCacheOnce();
    // legend: fixed on map, always visible
    try {
      await buildLegendFixed();
    } catch (e) {
      console.warn("Legend build failed:", e);
    }
  });
});