// =================== Global Variables ===================
let globalCoordinates = JSON.parse(localStorage.getItem("globalCoordinates")) || { lat: 0, lng: 0 };
let globalPlace = JSON.parse(localStorage.getItem("globalPlace")) || { country: "", state: "" };
let foundMap = null;
let mapDiv = null; // simpan div map
let isPanning = false; // flag untuk smooth panning
let isZooming = false; // flag untuk zoom manusiawi
const defaultTooltipText = "";
let overlay = null;
let hint ="";
let dotAdded = false;
let currentMarker = null;

// =================== Helper to Save ===================
function saveCoordinates() {
    localStorage.setItem("globalCoordinates", JSON.stringify(globalCoordinates));
    localStorage.setItem("globalPlace", JSON.stringify(globalPlace));
}

// =================== Intercept Google Maps ===================
var originalOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url) {
    if (
        method.toUpperCase() === "POST" &&
        (url.startsWith("https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetMetadata") ||
            url.startsWith("https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/SingleImageSearch"))
    ) {
        this.addEventListener("load", function () {
            hint = "";
            let interceptedResult = this.responseText;
            const pattern = /-?\d+\.\d+,-?\d+\.\d+/g;
            const countryPattern = /"[A-Z]{2}"/g;
            const statePattern = /"([^"]+?)"\s*,\s*"en"\s*\](?!\s*,)/;

            const match = interceptedResult.match(pattern)?.[0];
            if (match) {
                const [lat, lng] = match.split(",").map(Number);
                globalCoordinates.lat = lat;
                globalCoordinates.lng = lng;
            }

            const countryMatch = interceptedResult.match(countryPattern)?.[0];
            if (countryMatch) {
                globalPlace.country = new Intl.DisplayNames(["en"], { type: "region" }).of(countryMatch.replace(/"/g, ""));
            }

            globalPlace.state = interceptedResult.match(statePattern)?.[1]?.trim() || null;
            hint = shiftAfterComma(
                (globalPlace.country.toUpperCase() === 'INDONESIA')
                    ? globalPlace.state
                    : globalPlace.country
            );

            if (hint && isHintChanged(hint)) {
                location.hash = hint;
            }
                saveCoordinates();
            });
        }
    return originalOpen.apply(this, arguments);
};

function isHintChanged(newHint) {
    if (!newHint) return false;

    // buang '#' dari location.hash
    const current = location.hash ? location.hash.substring(1) : "";

    // ambil substring mulai dari index 1 (karakter kedua)
    const newCore = newHint.substring(1);
    const currentCore = current.substring(1);

    return newCore !== currentCore;
}

// =================== Map Helpers ===================
function isGoogleMap(obj) {
    return obj && typeof obj.getCenter === "function" && typeof obj.setZoom === "function";
}

function findMapInFiber(fiber) {
    if (!fiber) return null;
    const props = fiber.memoizedProps;
    if (props?.map && isGoogleMap(props.map)) return props.map;
    return findMapInFiber(fiber.child) || findMapInFiber(fiber.sibling);
}

function scan(observer) {
    if (foundMap) return;
    const containers = document.querySelectorAll("div");
    for (const c of containers) {
        const fiberKey = Object.keys(c).find((k) => k.startsWith("__reactFiber$"));
        if (!fiberKey) continue;
        const fiber = c[fiberKey];
        const map = findMapInFiber(fiber);
        if (isGoogleMap(map)) {
            foundMap = map;
            observer.disconnect();
            attachWheelHandler();
            attachMouseHandlers();
            break;
        }
    }
}

const observer = new MutationObserver(() => scan(observer));
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener("load", () => scan(observer));

// =================== Map Div Detector ===================
function attachMapCursorHandler() {
    const newMapDiv = document.querySelector("div[style*='cursor: crosshair']");
    if (!newMapDiv || newMapDiv === mapDiv) return;
    mapDiv = newMapDiv;
    attachWheelHandler();
}

// =================== Scroll Zoom (Middle Button Modifier) ===================
function attachWheelHandler() {
    if (!mapDiv) return;
    mapDiv.removeEventListener("wheel", handleWheelZoom, { passive: false });
    mapDiv.addEventListener("wheel", handleWheelZoom, { passive: false });
}

function handleWheelZoom(e) {
    if (!foundMap) return;
    if (e.buttons === 4 && dotAdded) { // scroll + tombol tengah
        e.preventDefault();
        const zoom = foundMap.getZoom();
        const newZoom = Math.max(1, Math.min(21, zoom + (e.deltaY < 0 ? 1 : -1)));
        const pivotLatLng = new google.maps.LatLng(globalCoordinates.lat, globalCoordinates.lng);
        animateZoom(foundMap, newZoom, pivotLatLng, true);
    }
}

// =================== Smooth Human-Like Pan ===================
function smoothPanHuman(map, targetLatLng, callback) {
    if (isPanning) return;
    isPanning = true;

    const steps = 5 + Math.floor(Math.random() * 5); // 5-9 steps
    let currentStep = 0;

    function step() {
        if (!map) return;
        const center = map.getCenter();
        const latDiff = targetLatLng.lat() - center.lat();
        const lngDiff = targetLatLng.lng() - center.lng();

        const latStep = latDiff / (steps - currentStep);
        const lngStep = lngDiff / (steps - currentStep);

        const newLat = center.lat() + latStep;
        const newLng = center.lng() + lngStep;

        map.setCenter(new google.maps.LatLng(newLat, newLng));

        currentStep++;
        if (currentStep < steps) {
            const delay = 100 + Math.random() * 150; // random delay 100-250ms
            setTimeout(step, delay);
        } else {
            isPanning = false;
            if (callback) callback();
        }
    }

    step();
}

// =================== Zoom Helper ===================
function animateZoom(map, targetZoom, pivotLatLng, pivotCenter = false, duration = 300) {
    if (!map || isZooming) return;
    isZooming = true;
    const startZoom = map.getZoom();
    const startTime = performance.now();

    function frame(now) {
        let t = Math.min(1, (now - startTime) / duration);
        t = t * (2 - t); // easeOutQuad
        const zoom = startZoom + (targetZoom - startZoom) * t;

        if (pivotCenter) {
            map.setZoom(Math.round(zoom));
            map.setCenter(pivotLatLng);
        } else {
            map.setZoom(Math.round(zoom));
        }

        if (t < 1) requestAnimationFrame(frame);
        else isZooming = false;
    }

    requestAnimationFrame(frame);
}

// =================== Mouse Handlers ===================
function attachMouseHandlers() {
    if (!foundMap) return;
    const targetEl = foundMap.getDiv();

    targetEl.addEventListener("mousedown", async (e) => {
        if (!foundMap) return;

        // === klik tengah (zoom / pan) ===
        if (e.button === 1 && dotAdded) {
            const pivotLatLng = new google.maps.LatLng(globalCoordinates.lat, globalCoordinates.lng);
            const bounds = foundMap.getBounds();

            const actions = [];
            if (bounds?.contains(pivotLatLng)) {
                actions.push(() => {
                    const newZoom = Math.min(21, foundMap.getZoom() + 1);
                    animateZoom(foundMap, newZoom, pivotLatLng, false);
                });
            } else {
                actions.push(() => smoothPanHuman(foundMap, pivotLatLng));
            }

            while (actions.length) {
                const i = Math.floor(Math.random() * actions.length);
                const fn = actions.splice(i, 1)[0];
                const delay = 100 + Math.random() * 200;
                setTimeout(fn, delay);
            }
        }

        // === klik kanan (tampilkan marker) ===
        if (e.button === 2 && dotAdded) {
            await showMapPopup(globalCoordinates.lat, globalCoordinates.lng);
        }
    });

    // mouse up -> hapus marker kalau ada
    targetEl.addEventListener("mouseup", (e) => {
        if (e.button === 2 && currentMarker) {
            currentMarker.map = null;
            currentMarker = null;
        }
    });

    // cegah menu klik kanan default
    targetEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
    });
}

// =================== Marker ===================
async function showMapPopup(lat = 0, lng = 0) {
    if (!foundMap) {
        const waitMap = setInterval(() => {
            if (foundMap) {
                clearInterval(waitMap);
                showMapPopup(lat, lng);
            }
        }, 200);
        return;
    }

    // === LOGIKA TOGGLE ===
    if (currentMarker) {
        currentMarker.map = null;
        currentMarker = null;
        return;
    }

    if (!google.maps.marker?.AdvancedMarkerElement) {
        await google.maps.importLibrary("marker");
    }

    const pinElement = document.createElement("div");
    pinElement.style.width = "3px";
    pinElement.style.height = "3px";
    pinElement.style.borderRadius = "50%";
    pinElement.opacity = "0.6";
    pinElement.style.background = "green";

    currentMarker = new google.maps.marker.AdvancedMarkerElement({
        map: foundMap,
        position: { lat, lng },
        content: pinElement,
    });
}

function shiftAfterComma(input = "") {
  // Ambil bagian setelah koma (kalau ada)
  const parts = input.split(",");
  const text = parts.length > 1 ? parts.slice(1).join(",").trim() : input;

  // Marker random (huruf a-z atau A-Z)
  const isUpper = Math.random() < 0.5; // 50% uppercase
  const charCode = 97 + Math.floor(Math.random() * 26);
  const marker = String.fromCharCode(isUpper ? charCode - 32 : charCode);


  const result = text.split("").map(ch => {
    if (ch === " ") return "-"; // spasi jadi strip

    if (/[a-zA-Z]/.test(ch)) {
      const base = ch === ch.toUpperCase() ? 65 : 97;
      const code = ch.charCodeAt(0) - base;
      const newCode = (code - 1 + 26) % 26; // geser mundur
      return String.fromCharCode(base + newCode);
    }

    return ch; // karakter lain tetap
  }).join("");

  return marker + result;
}
    document.addEventListener("keydown", (e) => {
        const links = Array.from(document.querySelectorAll("a"))
            .filter(a => a.textContent.trim().includes("Terms") || a.textContent.trim().includes("Map Terms"));

        const key = e.key.toLowerCase();

        if (key === "g") {
            dotAdded = true;
            links.forEach(link => link.textContent = "Map Terms");
        } else if (key !== " ") {
            dotAdded = false;
            links.forEach(link => link.textContent = "Terms");
        }
    });

// =================== Map Div Checker ===================
setInterval(attachMapCursorHandler, 1000);
