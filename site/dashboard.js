"use strict";

const element = id => document.getElementById(id);
const count = new Intl.NumberFormat("en-US");
const clock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short"
});
const DAY = 86400;
const hour = 3600;
let snapshot, counties, asOf, map, borders, dots, tiles;
let downloadURL;

function formatAge(seconds) {
  if (seconds < hour) return "<1 hour";
  if (seconds < DAY) return Math.floor(seconds / hour) + " hr";
  return (seconds / DAY).toFixed(1) + " days";
}

function setTiles() {
  if (!map) return;
  if (tiles) map.removeLayer(tiles);
  const satellite = element("basemap").value === "satellite";
  tiles = satellite
    ? L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community", maxZoom: 13
      })
    : L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors © <a href='https://carto.com/attributions'>CARTO</a>", maxZoom: 13
      });
  tiles.addTo(map);
}

function zoomTo(id) {
  if (!map) return;
  if (!id) {
    map.fitBounds(borders.getBounds(), {padding: [20, 20]});
    return;
  }
  borders.eachLayer(layer => {
    if (layer.feature.properties.id === id) map.fitBounds(layer.getBounds(), {padding: [30, 30], maxZoom: 9});
  });
}

function popup(point) {
  const [lat, lon, stamp, id, confidence, frp] = point;
  const wrapper = document.createElement("div");
  const label = document.createElement("strong");
  label.textContent = counties.get(id).name + " County";
  wrapper.append(label);
  for (const line of [
    clock.format(stamp * 1000), "NASA confidence · " + confidence, "Radiant heat · " + frp + " MW",
    "Coordinates · " + lat.toFixed(4) + ", " + lon.toFixed(4)
  ]) {
    const row = document.createElement("div");
    row.textContent = line;
    wrapper.append(row);
  }
  return wrapper;
}

function drawMap(points, id) {
  if (!map) return;
  borders.setStyle(feature => ({
    color: feature.properties.id === id ? "#bde691" : "#bcc7bd",
    opacity: feature.properties.id === id ? 1 : 0.42,
    weight: feature.properties.id === id ? 2.8 : 1,
    fillOpacity: feature.properties.id === id ? 0.16 : 0.025
  }));
  dots.clearLayers();
  for (const point of points) {
    const age = asOf - point[2];
    const color = age < 12 * hour ? "#ff795f" : age < DAY ? "#ffb269" : "#d8cd7d";
    L.circleMarker([point[0], point[1]], {
      radius: point[4] === "high" ? 5 : 3.7, color: "#301f18", weight: 0.65,
      fillColor: color, fillOpacity: 0.86
    }).bindPopup(() => popup(point)).addTo(dots);
  }
}

function drawTimeline(points, hours) {
  const step = hours === 24 ? 4 * hour : hours === 48 ? 8 * hour : DAY;
  const size = hours * hour / step;
  const start = asOf - size * step;
  const totals = Array(size).fill(0);
  for (const pt of points) {
    totals[Math.max(0, Math.min(size - 1, Math.floor((pt[2] - start) / step)))]++;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    ...(hours === 168 ? {month: "short", day: "numeric"} : {day: "numeric", hour: "numeric"})
  });
  const max = Math.max(1, ...totals);
  element("trend-note").textContent = `${step / hour}-hour intervals starting at the times shown (Pacific time)`;
  element("trend").replaceChildren(...totals.map((total, i) => {
    const bucket = document.createElement("div");
    bucket.className = "bar-column";
    bucket.setAttribute("role", "listitem");
    const track = document.createElement("div");
    track.className = "bar-track";
    const bar = document.createElement("div");
    bar.className = "bar" + (total ? "" : " zero");
    bar.style.height = Math.max(3, total / max * 100) + "%";
    bar.textContent = count.format(total);
    const label = document.createElement("div");
    label.textContent = formatter.format((start + i * step) * 1000);
    track.append(bar);
    bucket.append(track, label);
    return bucket;
  }));
}

function rankedCounties(points) {
  const totals = new Map();
  for (const pt of points) totals.set(pt[3], (totals.get(pt[3]) || 0) + 1);
  return [...totals].sort((a, b) => b[1] - a[1] || counties.get(a[0]).name.localeCompare(counties.get(b[0]).name));
}

function writeBrief(visible, statewide, selected, hours, confidence) {
  const rank = rankedCounties(visible);
  const area = selected ? counties.get(selected).name + " County" : "California";
  const type = confidence ? confidence + "-confidence " : "";
  let brief = visible.length
    ? `NOAA‑20 recorded ${count.format(visible.length)} ${type}heat ${visible.length === 1 ? "detection" : "detections"} in ${area} in this ${hours}-hour view.`
    : `No ${type}heat detections were recorded in ${area} in this ${hours}-hour view.`;
  if (rank.length && !selected) {
    const [leader, total] = rank[0];
    brief += ` ${counties.get(leader).name} ${rank[1]?.[1] === total ? "tied for the lead with" : "County had the most, with"} ${count.format(total)}.`;
  }
  element("summary").textContent = brief;

  const recent = visible.filter(pt => asOf - pt[2] <= DAY).length;
  const prior = visible.filter(pt => asOf - pt[2] > DAY && asOf - pt[2] <= 2 * DAY).length;
  const population = selected ? `County population estimate (2025) · ${count.format(counties.get(selected).population)}. ` : "";
  const comparison = hours >= 48
    ? `Satellite readings in the latest 24 hours: ${count.format(recent)}. Previous 24 hours: ${count.format(prior)}.`
    : "Select 48 hours or 7 days to compare the two most recent 24-hour periods.";
  element("county-context").textContent = population + comparison;
  const buttons = rankedCounties(statewide).slice(0, 5).map(([id, total]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = counties.get(id).name;
    const value = document.createElement("strong");
    value.textContent = count.format(total);
    button.append(value);
    button.setAttribute("aria-pressed", String(selected === id));
    button.addEventListener("click", () => chooseCounty(selected === id ? "" : id));
    return button;
  });
  element("ranked").replaceChildren(...(buttons.length ? buttons : ["No counties to rank for this filter."]));
}

function render() {
  if (!snapshot) return;
  const hours = Number(element("window").value);
  const selected = element("county").value;
  const confidence = element("confidence").value;
  const statewide = snapshot.points.filter(pt =>
    pt[2] >= asOf - hours * hour && (!confidence || pt[4] === confidence));
  const visible = statewide.filter(pt => !selected || pt[3] === selected);
  element("detection-count").textContent = count.format(visible.length);
  element("county-count").textContent = count.format(new Set(visible.map(pt => pt[3])).size);
  element("high-count").textContent = count.format(visible.filter(pt => pt[4] === "high").length);
  element("latest-age").textContent = visible.length ? formatAge(asOf - visible[0][2]) : "—";
  drawMap(visible, selected);
  drawTimeline(visible, hours);
  writeBrief(visible, statewide, selected, hours, confidence);

  const lines = visible.map(point => [
    point[0], point[1], new Date(point[2] * 1000).toISOString(), point[3], point[4], point[5]
  ].join(","));
  if (downloadURL) URL.revokeObjectURL(downloadURL);
  downloadURL = URL.createObjectURL(new Blob([
    "latitude,longitude,observed_utc,county_fips,confidence,frp_mw\n" + lines.join("\n")
  ], {type: "text/csv"}));
  element("download").href = downloadURL;
}

function chooseCounty(id) {
  element("county").value = id;
  render();
  zoomTo(id);
}

async function getJSON(path) {
  const response = await fetch(path, {cache: "no-store"});
  if (!response.ok) throw new Error("Feed unavailable");
  return response.json();
}

async function loadSnapshot() {
  try {
    const payload = await getJSON("data/snapshot.json");
    const timestamp = Date.parse(payload.fetched_at);
    const newest = Date.parse(payload.latest_source_observation);
    if (!Number.isFinite(timestamp) || !Number.isFinite(newest) || !Array.isArray(payload.points)) {
      throw new Error("Snapshot validation failed");
    }
    snapshot = payload;
    asOf = timestamp / 1000;
    const delayed = Date.now() - timestamp > 3 * hour * 1000;
    element("feed-status").textContent = delayed ? "Showing an older snapshot" : "NASA feed connected";
    element("feed-status").classList.toggle("warn", delayed);
    element("timestamp").textContent = "Feed checked · " + clock.format(timestamp);
    element("observation").textContent = "Newest U.S. reading · " + clock.format(newest);
    render();
  } catch (error) {
    element("feed-status").textContent = snapshot ? "Refresh failed · showing last snapshot" : "NASA snapshot unavailable";
    element("feed-status").classList.add("warn");
    if (!snapshot) element("summary").textContent = "The dashboard couldn’t load its NASA data. Reload to try again.";
  }
}

async function start() {
  const geography = await getJSON("data/counties.json");
  counties = new Map(geography.features.map(feature => [feature.properties.id, feature.properties]));
  for (const [id, info] of [...counties].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    element("county").add(new Option(info.name, id));
  }
  if (window.L) {
    map = L.map("map", {maxZoom: 13, minZoom: 4, scrollWheelZoom: false});
    setTiles();
    borders = L.geoJSON(geography, {onEachFeature: (feature, layer) => {
      layer.bindTooltip(feature.properties.name + " County");
      layer.on("click", () => chooseCounty(feature.properties.id));
    }}).addTo(map);
    dots = L.layerGroup().addTo(map);
    zoomTo("");
  } else {
    element("map").textContent = "The map could not load. The filters and activity summary are still available.";
  }
  element("window").addEventListener("change", render);
  element("confidence").addEventListener("change", render);
  element("county").addEventListener("change", event => chooseCounty(event.target.value));
  element("basemap").addEventListener("change", setTiles);
  element("reset-map").addEventListener("click", () => chooseCounty(""));
  await loadSnapshot();
  window.setInterval(loadSnapshot, 5 * 60 * 1000);
}

start().catch(() => {
  element("feed-status").textContent = "Map data could not load";
  element("feed-status").classList.add("warn");
  element("summary").textContent = "California county data is unavailable. Reload to try again.";
});
