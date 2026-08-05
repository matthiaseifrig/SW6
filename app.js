/* Tourenplaner – Client-seitige App.
 * Geokodierung via OpenStreetMap Nominatim, Routing/Distanzmatrix via OSRM (project-osrm.org).
 * Läuft komplett im Browser des Nutzers, keine eigene Serverkomponente.
 */
(function () {
  "use strict";

  var NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
  var OSRM_TABLE_URL = "https://router.project-osrm.org/table/v1/driving/";
  var OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving/";
  var NOMINATIM_DELAY_MS = 1100; // Nominatim-Nutzungsrichtlinie: max. 1 Anfrage/Sekunde
  var MAX_MULTISTART_N = 120; // ab dieser Anzahl Adressen wird "beliebiger Start" nicht mehr durchprobiert
  var GOOGLE_MAPS_CHUNK = 10; // max. Orte (inkl. Start/Ziel) pro Google-Maps-Link

  var els = {};
  var map = null;
  var mapLayer = null;
  var byCity = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheEls();
    groupAddressesByCity();
    populateCitySelect();
    bindEvents();
  }

  function cacheEls() {
    els.citySelect = document.getElementById("city-select");
    els.startModeRadios = document.querySelectorAll('input[name="start-mode"]');
    els.startAddressSelect = document.getElementById("start-address-select");
    els.gpsStatus = document.getElementById("gps-status");
    els.returnToStart = document.getElementById("return-to-start");
    els.computeBtn = document.getElementById("compute-btn");
    els.progress = document.getElementById("progress");
    els.progressFill = document.getElementById("progress-fill");
    els.progressLabel = document.getElementById("progress-label");
    els.resultsPanel = document.getElementById("results-panel");
    els.resultsTitle = document.getElementById("results-title");
    els.mapsLinksToggle = document.getElementById("maps-links-toggle");
    els.mapsLinks = document.getElementById("maps-links");
    els.printBtn = document.getElementById("print-btn");
    els.mapDiv = document.getElementById("map");
    els.stopList = document.getElementById("stop-list");
    els.unresolved = document.getElementById("unresolved");
    els.unresolvedList = document.getElementById("unresolved-list");
  }

  function groupAddressesByCity() {
    var data = window.ADDRESS_DATA || [];
    data.forEach(function (a) {
      var city = a.ort || "(ohne Ort)";
      if (!byCity[city]) byCity[city] = [];
      byCity[city].push(a);
    });
  }

  function populateCitySelect() {
    var cities = Object.keys(byCity).sort(function (a, b) {
      return a.localeCompare(b, "de");
    });
    var frag = document.createDocumentFragment();
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "-- Ort wählen (" + cities.length + " Orte, " + (window.ADDRESS_DATA || []).length + " Adressen) --";
    frag.appendChild(placeholder);
    cities.forEach(function (city) {
      var opt = document.createElement("option");
      opt.value = city;
      var n = byCity[city].length;
      opt.textContent = city + " (" + n + (n === 1 ? " Adresse" : " Adressen") + ")";
      frag.appendChild(opt);
    });
    els.citySelect.innerHTML = "";
    els.citySelect.appendChild(frag);
  }

  function currentCity() {
    return els.citySelect.value;
  }

  function currentStartMode() {
    var checked = document.querySelector('input[name="start-mode"]:checked');
    return checked ? checked.value : "first";
  }

  function bindEvents() {
    els.citySelect.addEventListener("change", onCityChange);
    els.startModeRadios.forEach(function (r) {
      r.addEventListener("change", onStartModeChange);
    });
    els.computeBtn.addEventListener("click", onComputeClick);
    els.mapsLinksToggle.addEventListener("click", function () {
      els.mapsLinks.classList.toggle("hidden");
    });
    els.printBtn.addEventListener("click", function () {
      window.print();
    });
  }

  function onCityChange() {
    var city = currentCity();
    var addresses = (byCity[city] || []).filter(function (a) {
      return a.hasAddress;
    });
    var frag = document.createDocumentFragment();
    addresses.forEach(function (a) {
      var opt = document.createElement("option");
      opt.value = String(a.id);
      opt.textContent = a.unternehmen + " – " + a.strasse;
      frag.appendChild(opt);
    });
    els.startAddressSelect.innerHTML = "";
    els.startAddressSelect.appendChild(frag);
  }

  function onStartModeChange() {
    var mode = currentStartMode();
    els.startAddressSelect.classList.toggle("hidden", mode !== "address");
    els.gpsStatus.classList.toggle("hidden", mode !== "gps");
    if (mode === "gps") {
      requestGpsLocation();
    }
  }

  var gpsCoords = null;

  function requestGpsLocation() {
    els.gpsStatus.textContent = "Standort wird ermittelt …";
    if (!navigator.geolocation) {
      els.gpsStatus.textContent = "Geolocation wird von diesem Browser nicht unterstützt.";
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        gpsCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        els.gpsStatus.textContent =
          "Standort erkannt (Genauigkeit ±" + Math.round(pos.coords.accuracy) + " m).";
      },
      function (err) {
        gpsCoords = null;
        els.gpsStatus.textContent = "Standort konnte nicht ermittelt werden (" + err.message + ").";
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function normalizeCacheKey(query) {
    return "geocode:v1:" + query.trim().toLowerCase();
  }

  function readGeocodeCache(query) {
    var raw = localStorage.getItem(normalizeCacheKey(query));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return undefined;
    }
  }

  function writeGeocodeCache(query, value) {
    try {
      localStorage.setItem(normalizeCacheKey(query), JSON.stringify(value));
    } catch (e) {
      /* localStorage voll oder deaktiviert – Cache wird einfach übersprungen */
    }
  }

  function geocodeOne(query) {
    var cached = readGeocodeCache(query);
    if (cached !== undefined) {
      return Promise.resolve({ coords: cached, fromCache: true });
    }
    var url =
      NOMINATIM_URL +
      "?format=jsonv2&limit=1&countrycodes=de&q=" +
      encodeURIComponent(query);
    return fetch(url, { headers: { Accept: "application/json" } })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        var coords = null;
        if (json && json.length) {
          coords = { lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon) };
        }
        writeGeocodeCache(query, coords);
        return { coords: coords, fromCache: false };
      })
      .catch(function () {
        return { coords: null, fromCache: false, error: true };
      });
  }

  async function geocodeAll(addresses, onProgress) {
    var results = [];
    for (var i = 0; i < addresses.length; i++) {
      var addr = addresses[i];
      onProgress(i, addresses.length, addr);
      var r = await geocodeOne(addr.geocodeQuery);
      results.push({ addr: addr, coords: r.coords });
      if (!r.fromCache) {
        await sleep(NOMINATIM_DELAY_MS);
      }
    }
    return results;
  }

  function fetchDurationMatrix(points) {
    var coordStr = points
      .map(function (p) {
        return p.lon + "," + p.lat;
      })
      .join(";");
    var url = OSRM_TABLE_URL + coordStr + "?annotations=duration,distance";
    return fetch(url)
      .then(function (res) {
        return res.json();
      })
      .then(function (json) {
        if (json.code !== "Ok") throw new Error("OSRM table: " + json.code);
        return { durations: json.durations, distances: json.distances };
      });
  }

  function fetchRouteGeometry(pointsInOrder) {
    var coordStr = pointsInOrder
      .map(function (p) {
        return p.lon + "," + p.lat;
      })
      .join(";");
    var url = OSRM_ROUTE_URL + coordStr + "?overview=full&geometries=geojson";
    return fetch(url)
      .then(function (res) {
        return res.json();
      })
      .then(function (json) {
        if (json.code !== "Ok" || !json.routes || !json.routes.length) {
          throw new Error("OSRM route: " + json.code);
        }
        return json.routes[0];
      });
  }

  // --- TSP: nearest-neighbour Konstruktion + 2-opt Verbesserung ---
  // cost: n x n Matrix, tour[0] ist immer der fixierte Startpunkt.
  function nearestNeighborTour(cost, n, start) {
    var visited = new Array(n).fill(false);
    var tour = [start];
    visited[start] = true;
    for (var step = 1; step < n; step++) {
      var last = tour[tour.length - 1];
      var best = -1;
      var bestCost = Infinity;
      for (var j = 0; j < n; j++) {
        if (!visited[j] && cost[last][j] < bestCost) {
          bestCost = cost[last][j];
          best = j;
        }
      }
      tour.push(best);
      visited[best] = true;
    }
    return tour;
  }

  function tourCost(cost, tour, closed) {
    var total = 0;
    for (var i = 0; i < tour.length - 1; i++) total += cost[tour[i]][tour[i + 1]];
    if (closed) total += cost[tour[tour.length - 1]][tour[0]];
    return total;
  }

  function twoOptImprove(cost, tour, closed) {
    var n = tour.length;
    if (n < 4) return tour;
    function next(idx) {
      return (idx + 1) % n;
    }
    var improved = true;
    while (improved) {
      improved = false;
      var jMax = closed ? n - 1 : n - 2;
      for (var i = 1; i < n - 1; i++) {
        for (var j = i + 1; j <= jMax; j++) {
          var jn = closed ? next(j) : j + 1;
          if (jn === i) continue;
          var d0 = cost[tour[i - 1]][tour[i]] + cost[tour[j]][tour[jn]];
          var d1 = cost[tour[i - 1]][tour[j]] + cost[tour[i]][tour[jn]];
          if (d1 < d0 - 1e-6) {
            var lo = i,
              hi = j;
            while (lo < hi) {
              var tmp = tour[lo];
              tour[lo] = tour[hi];
              tour[hi] = tmp;
              lo++;
              hi--;
            }
            improved = true;
          }
        }
      }
    }
    return tour;
  }

  function solveTour(cost, n, fixedStart, closed) {
    var starts;
    if (fixedStart !== null) {
      starts = [fixedStart];
    } else if (n <= MAX_MULTISTART_N) {
      starts = [];
      for (var s = 0; s < n; s++) starts.push(s);
    } else {
      starts = [0];
    }
    var bestTour = null;
    var bestCost = Infinity;
    starts.forEach(function (s) {
      var tour = nearestNeighborTour(cost, n, s);
      tour = twoOptImprove(cost, tour, closed);
      var c = tourCost(cost, tour, closed);
      if (c < bestCost) {
        bestCost = c;
        bestTour = tour;
      }
    });
    return { tour: bestTour, cost: bestCost };
  }

  function formatDuration(seconds) {
    var min = Math.round(seconds / 60);
    if (min < 60) return min + " min";
    var h = Math.floor(min / 60);
    var m = min % 60;
    return h + " h " + (m ? m + " min" : "");
  }

  function formatDistance(meters) {
    return (meters / 1000).toFixed(1).replace(".", ",") + " km";
  }

  function setProgress(fraction, label) {
    els.progress.classList.remove("hidden");
    els.progressFill.style.width = Math.round(fraction * 100) + "%";
    els.progressLabel.textContent = label;
  }

  function hideProgress() {
    els.progress.classList.add("hidden");
  }

  async function onComputeClick() {
    var city = currentCity();
    if (!city) {
      alert("Bitte zuerst einen Ort auswählen.");
      return;
    }
    var mode = currentStartMode();
    if (mode === "gps" && !gpsCoords) {
      alert("Standort noch nicht verfügbar. Bitte GPS-Freigabe im Browser erlauben und erneut versuchen.");
      return;
    }

    els.computeBtn.disabled = true;
    els.resultsPanel.classList.add("hidden");

    try {
      var all = byCity[city] || [];
      var withAddress = all.filter(function (a) {
        return a.hasAddress;
      });
      var withoutAddress = all.filter(function (a) {
        return !a.hasAddress;
      });

      if (withAddress.length === 0) {
        hideProgress();
        renderNoRoute(city, withoutAddress);
        return;
      }

      setProgress(0, "Adressen werden geokodiert (0/" + withAddress.length + ") …");
      var geocoded = await geocodeAll(withAddress, function (i, total, addr) {
        setProgress(i / total, "Geokodiere " + (i + 1) + "/" + total + ": " + addr.unternehmen);
      });

      var resolved = geocoded.filter(function (g) {
        return g.coords;
      });
      var failed = geocoded
        .filter(function (g) {
          return !g.coords;
        })
        .map(function (g) {
          return g.addr;
        });

      if (resolved.length === 0) {
        hideProgress();
        renderNoRoute(city, withoutAddress.concat(failed));
        return;
      }

      setProgress(1, "Fahrzeiten werden berechnet …");

      // Punkte zusammenstellen: optional virtueller Startpunkt (Adresse oder GPS) an Index 0
      var points = [];
      var stopMeta = []; // parallel zu points; null = virtueller Start ohne eigenen Adress-Datensatz
      var fixedStartIndex = null;

      if (mode === "gps") {
        points.push(gpsCoords);
        stopMeta.push(null);
        fixedStartIndex = 0;
      } else if (mode === "address") {
        var chosenId = parseInt(els.startAddressSelect.value, 10);
        var chosenIdx = resolved.findIndex(function (g) {
          return g.addr.id === chosenId;
        });
        if (chosenIdx === -1) chosenIdx = 0;
        // gewählte Adresse an Index 0 der resolved-Liste verschieben
        var chosen = resolved.splice(chosenIdx, 1)[0];
        resolved.unshift(chosen);
        fixedStartIndex = 0;
      }
      // sonst: mode === "first" -> kein fixer Start, beste Reihenfolge wird ermittelt

      resolved.forEach(function (g) {
        points.push(g.coords);
        stopMeta.push(g.addr);
      });

      var n = points.length;
      var matrix = await fetchDurationMatrix(points);

      var closed = els.returnToStart.checked;
      var result = solveTour(matrix.durations, n, fixedStartIndex, closed);
      var orderIdx = result.tour;

      var orderedPoints = orderIdx.map(function (i) {
        return points[i];
      });
      var orderedMeta = orderIdx.map(function (i) {
        return stopMeta[i];
      });

      var legDurations = [];
      var legDistances = [];
      for (var k = 0; k < orderIdx.length - 1; k++) {
        legDurations.push(matrix.durations[orderIdx[k]][orderIdx[k + 1]]);
        legDistances.push(matrix.distances[orderIdx[k]][orderIdx[k + 1]]);
      }
      var totalDuration = legDurations.reduce(function (a, b) { return a + b; }, 0);
      var totalDistance = legDistances.reduce(function (a, b) { return a + b; }, 0);
      if (closed) {
        var lastIdx = orderIdx[orderIdx.length - 1];
        var firstIdx = orderIdx[0];
        totalDuration += matrix.durations[lastIdx][firstIdx];
        totalDistance += matrix.distances[lastIdx][firstIdx];
      }

      var routeGeometry = null;
      try {
        var routePoints = closed ? orderedPoints.concat([orderedPoints[0]]) : orderedPoints;
        var route = await fetchRouteGeometry(routePoints);
        routeGeometry = route.geometry;
      } catch (e) {
        routeGeometry = null; // Karte zeigt dann nur Marker + Luftlinie
      }

      hideProgress();
      renderResults({
        city: city,
        orderedPoints: orderedPoints,
        orderedMeta: orderedMeta,
        legDurations: legDurations,
        legDistances: legDistances,
        totalDuration: totalDuration,
        totalDistance: totalDistance,
        closed: closed,
        routeGeometry: routeGeometry,
        unresolved: withoutAddress.concat(failed),
        hasVirtualStart: mode === "gps",
      });
    } catch (err) {
      hideProgress();
      alert(
        "Bei der Berechnung ist ein Fehler aufgetreten: " +
          err.message +
          "\nBitte Internetverbindung prüfen und erneut versuchen."
      );
      console.error(err);
    } finally {
      els.computeBtn.disabled = false;
    }
  }

  function renderNoRoute(city, unresolved) {
    els.resultsPanel.classList.remove("hidden");
    els.resultsTitle.textContent = city + ": keine Route berechenbar";
    els.mapsLinks.classList.add("hidden");
    els.mapsLinksToggle.classList.add("hidden");
    els.mapDiv.classList.add("hidden");
    els.stopList.innerHTML = "";
    renderUnresolved(unresolved);
  }

  function renderUnresolved(list) {
    if (!list.length) {
      els.unresolved.classList.add("hidden");
      return;
    }
    els.unresolved.classList.remove("hidden");
    els.unresolvedList.innerHTML = "";
    list.forEach(function (a) {
      var li = document.createElement("li");
      var parts = [a.unternehmen];
      var addr = [a.strasse, [a.plz, a.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      if (addr) parts.push(addr);
      li.textContent = parts.join(" – ");
      els.unresolvedList.appendChild(li);
    });
  }

  function renderResults(r) {
    els.resultsPanel.classList.remove("hidden");
    els.mapDiv.classList.remove("hidden");
    els.mapsLinksToggle.classList.remove("hidden");

    var stopCount = r.orderedMeta.filter(Boolean).length;
    els.resultsTitle.textContent =
      r.city +
      ": " +
      stopCount +
      " Stopps – " +
      formatDistance(r.totalDistance) +
      " · " +
      formatDuration(r.totalDuration) +
      (r.closed ? " (Rundtour)" : "");

    renderMap(r);
    renderStopList(r);
    renderMapsLinks(r);
    renderUnresolved(r.unresolved);
  }

  function renderMap(r) {
    if (!map) {
      map = L.map(els.mapDiv);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap-Mitwirkende",
      }).addTo(map);
    }
    if (mapLayer) {
      map.removeLayer(mapLayer);
    }
    mapLayer = L.layerGroup().addTo(map);

    r.orderedPoints.forEach(function (p, i) {
      var meta = r.orderedMeta[i];
      var isStart = i === 0;
      var label = isStart ? "Start" : String(i);
      var color = isStart ? "#2c9e6b" : "#1a5fb4";
      var icon = L.divIcon({
        className: "",
        html:
          '<div style="background:' +
          color +
          ';color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);">' +
          label +
          "</div>",
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      var marker = L.marker([p.lat, p.lon], { icon: icon }).addTo(mapLayer);
      var popupText = meta ? "<strong>" + escapeHtml(meta.unternehmen) + "</strong><br>" + escapeHtml(meta.strasse) : "Mein Standort";
      marker.bindPopup(popupText);
    });

    if (r.routeGeometry) {
      var latlngs = r.routeGeometry.coordinates.map(function (c) {
        return [c[1], c[0]];
      });
      L.polyline(latlngs, { color: "#1a5fb4", weight: 4, opacity: 0.75 }).addTo(mapLayer);
    } else {
      var straight = r.orderedPoints.map(function (p) {
        return [p.lat, p.lon];
      });
      L.polyline(straight, { color: "#1a5fb4", weight: 3, opacity: 0.5, dashArray: "6 6" }).addTo(mapLayer);
    }

    var bounds = L.latLngBounds(
      r.orderedPoints.map(function (p) {
        return [p.lat, p.lon];
      })
    );
    map.fitBounds(bounds, { padding: [30, 30] });
    setTimeout(function () {
      map.invalidateSize();
    }, 50);
  }

  function renderStopList(r) {
    els.stopList.innerHTML = "";
    r.orderedMeta.forEach(function (meta, i) {
      var li = document.createElement("li");
      var isStart = i === 0;

      var idxSpan = document.createElement("span");
      idxSpan.className = "stop-index" + (isStart ? " start" : "");
      idxSpan.textContent = isStart ? "S" : String(i);
      li.appendChild(idxSpan);

      var body = document.createElement("div");
      body.className = "stop-body";

      if (!meta) {
        body.innerHTML = "<div class=\"company\">Mein Standort (Startpunkt)</div>";
      } else {
        var addrLine = [meta.strasse, [meta.plz, meta.ort].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", ");
        var html = "<div class=\"company\">" + escapeHtml(meta.unternehmen) + "</div>";
        html += "<div class=\"address\">" + escapeHtml(addrLine) + "</div>";
        var contactBits = [];
        if (meta.telefon) contactBits.push(escapeHtml(meta.telefon));
        if (meta.website) contactBits.push(escapeHtml(meta.website));
        if (contactBits.length) {
          html += "<div class=\"contact\">" + contactBits.join(" · ") + "</div>";
        }
        body.innerHTML = html;
      }

      if (i > 0) {
        var leg = document.createElement("div");
        leg.className = "leg";
        leg.textContent =
          "→ " + formatDistance(r.legDistances[i - 1]) + ", " + formatDuration(r.legDurations[i - 1]) + " ab vorherigem Stopp";
        body.appendChild(leg);
      }

      li.appendChild(body);
      els.stopList.appendChild(li);
    });

    if (r.closed) {
      var li = document.createElement("li");
      var idxSpan = document.createElement("span");
      idxSpan.className = "stop-index start";
      idxSpan.textContent = "S";
      li.appendChild(idxSpan);
      var body = document.createElement("div");
      body.className = "stop-body";
      body.innerHTML = "<div class=\"company\">Zurück zum Start</div>";
      li.appendChild(body);
      els.stopList.appendChild(li);
    }
  }

  function renderMapsLinks(r) {
    els.mapsLinks.innerHTML = "";
    els.mapsLinks.classList.add("hidden");

    var stops = r.orderedPoints.map(function (p, i) {
      var meta = r.orderedMeta[i];
      return {
        label: meta ? meta.unternehmen + ", " + meta.strasse + ", " + [meta.plz, meta.ort].filter(Boolean).join(" ") : "Mein Standort",
        lat: p.lat,
        lon: p.lon,
      };
    });
    if (r.closed) stops.push(stops[0]);

    var chunks = [];
    var i = 0;
    while (i < stops.length - 1) {
      var end = Math.min(i + GOOGLE_MAPS_CHUNK - 1, stops.length - 1);
      chunks.push(stops.slice(i, end + 1));
      i = end;
    }

    chunks.forEach(function (chunk, idx) {
      var origin = chunk[0];
      var destination = chunk[chunk.length - 1];
      var waypoints = chunk.slice(1, -1);
      var url =
        "https://www.google.com/maps/dir/?api=1&travelmode=driving" +
        "&origin=" +
        encodeURIComponent(origin.lat + "," + origin.lon) +
        "&destination=" +
        encodeURIComponent(destination.lat + "," + destination.lon);
      if (waypoints.length) {
        url +=
          "&waypoints=" +
          waypoints
            .map(function (w) {
              return encodeURIComponent(w.lat + "," + w.lon);
            })
            .join("|");
      }
      var a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent =
        chunks.length > 1
          ? "Teil " + (idx + 1) + " von " + chunks.length + " in Google Maps öffnen (" + chunk.length + " Orte)"
          : "Route in Google Maps öffnen (" + chunk.length + " Orte)";
      els.mapsLinks.appendChild(a);
    });

    if (chunks.length > 1) {
      var hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent =
        "Google Maps erlaubt nur " + GOOGLE_MAPS_CHUNK + " Orte pro Link – die Tour wurde daher in " + chunks.length + " aufeinanderfolgende Abschnitte aufgeteilt.";
      els.mapsLinks.appendChild(hint);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
})();
