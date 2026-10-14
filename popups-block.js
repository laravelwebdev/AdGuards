// =================== Global Variables ===================
let globalCoordinates = JSON.parse(localStorage.getItem("globalCoordinates")) || { lat: 0, lng: 0 };
let globalPlace = JSON.parse(localStorage.getItem("globalPlace")) || { country: "", state: "" };
let playedRounds = []; // Menyimpan riwayat koordinat ronde yang sudah dimainkan dalam game saat ini
let currentRoundCoords = null; // Menyimpan koordinat ronde aktif / prefetch
let currentGameId = ""; // Menyimpan ID game untuk reset ronde saat mulai game baru
let foundMap = null;
let hint = "";
let dotAdded = false;
let currentMarker = null;

// =================== Helper to Save ===================
function saveCoordinates() {
    localStorage.setItem("globalCoordinates", JSON.stringify(globalCoordinates));
    localStorage.setItem("globalPlace", JSON.stringify(globalPlace));
}

// =================== Distance & Game Tracking Helpers ===================
function getDistanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371e3; // radius bumi dalam meter
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function isAlreadyPlayed(lat, lng) {
    return playedRounds.some(round => getDistanceMeters(round.lat, round.lng, lat, lng) < 500);
}

function getGameIdFromUrl() {
    const match = location.pathname.match(/\/(game|challenge|duels|live-challenge|party)\/([a-zA-Z0-9_-]+)/);
    return match ? match[2] : location.pathname;
}

function checkGameReset() {
    const gameId = getGameIdFromUrl();
    if (gameId && currentGameId && gameId !== currentGameId) {
        playedRounds = [];
        currentRoundCoords = null;
    }
    currentGameId = gameId;
}

function updateHashSilently(newHint) {
    if (!newHint) return;
    try {
        const newUrl = location.pathname + location.search + "#" + newHint;
        if (window.history && typeof History.prototype.replaceState === "function") {
            History.prototype.replaceState.call(window.history, window.history.state, "", newUrl);
        } else {
            window.history.replaceState(window.history.state, "", newUrl);
        }
    } catch (e) {
        location.hash = newHint;
    }
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
            let interceptedResult = this.responseText;
            const pattern = /-?\d+\.\d+,-?\d+\.\d+/g;
            const countryPattern = /"[A-Z]{2}"/g;
            const statePattern = /"([^"]+?)"\s*,\s*"en"\s*\](?!\s*,)/;

            const match = interceptedResult.match(pattern)?.[0];
            if (!match) return;

            const [lat, lng] = match.split(",").map(Number);
            if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

            checkGameReset();

            // 1. Cek jika koordinat ini adalah ronde yang sudah selesai dimainkan sebelumnya.
            // Saat ronde berakhir dan layar result/summary muncul, GeoGuessr sering memuat ulang Street View / metadata
            // untuk ronde yang baru saja selesai. Ini akan dicegah agar tidak menimpa ronde berikutnya yang sudah di-prefetch.
            if (isAlreadyPlayed(lat, lng)) {
                return;
            }

            // 2. Deteksi transisi ronde (jarak > 500m dari ronde aktif saat ini menandakan ronde baru)
            let isNewRound = false;
            if (currentRoundCoords) {
                const distFromCurrent = getDistanceMeters(currentRoundCoords.lat, currentRoundCoords.lng, lat, lng);
                if (distFromCurrent > 500) {
                    // Ronde sebelumnya selesai dan sekarang berpindah ke ronde berikutnya (misal prefetch)
                    if (!isAlreadyPlayed(currentRoundCoords.lat, currentRoundCoords.lng)) {
                        playedRounds.push({ lat: currentRoundCoords.lat, lng: currentRoundCoords.lng });
                        if (playedRounds.length > 5) {
                            playedRounds.shift();
                        }
                    }
                    currentRoundCoords = { lat, lng };
                    isNewRound = true;
                }
            } else {
                currentRoundCoords = { lat, lng };
                isNewRound = true;
            }

            // Simpan koordinat ronde jika ini ronde baru
            if (isNewRound) {
                globalCoordinates.lat = lat;
                globalCoordinates.lng = lng;
            }

            const countryMatch = interceptedResult.match(countryPattern)?.[0];
            if (countryMatch) {
                globalPlace.country = new Intl.DisplayNames(["en"], { type: "region" }).of(countryMatch.replace(/"/g, ""));
            } else if (isNewRound) {
                globalPlace.country = "";
            }

            const stateMatch = interceptedResult.match(statePattern)?.[1]?.trim();
            if (stateMatch) {
                globalPlace.state = stateMatch;
            } else if (isNewRound) {
                globalPlace.state = "";
            }

            const country = globalPlace.country || "";
            const state = globalPlace.state || "";
            const targetPlace = (country.toUpperCase() === 'INDONESIA') ? state : country;

            if (targetPlace) {
                hint = shiftAfterComma(targetPlace);
                if (isHintChanged(hint)) {
                    updateHashSilently(hint);
                }
            }
            saveCoordinates();
        });
    }
    return originalOpen.apply(this, arguments);
};

function isHintChanged(newHint) {
    // hint baru tidak ada → tidak berubah
    if (!newHint || newHint.trim() === "" || newHint.length < 2) return false;

    // ambil hash sekarang tanpa '#'
    const current = location.hash ? location.hash.substring(1) : "";

    // kalau hash belum ada → pasti berubah
    if (!current || current.length < 2) return true;

    // bandingkan mulai karakter kedua (case-insensitive biar aman)
    const newCore = newHint.substring(1).toLowerCase();
    const currentCore = current.substring(1).toLowerCase();

    return newCore !== currentCore;
}

// =================== Map Helpers & Lifecycle Detection ===================
function isGoogleMap(obj) {
    return obj && typeof obj.getCenter === "function" && typeof obj.setZoom === "function" && typeof obj.getDiv === "function";
}

function isMapValid(map) {
    if (!isGoogleMap(map)) return false;
    const div = map.getDiv();
    return !!(div && document.body.contains(div));
}

function findMapInFiber(fiber) {
    if (!fiber) return null;
    const props = fiber.memoizedProps;
    if (props?.map && isGoogleMap(props.map)) return props.map;
    return findMapInFiber(fiber.child) || findMapInFiber(fiber.sibling);
}

function scanForMap() {
    // Jika map saat ini masih valid di DOM dan terikat, tidak perlu scan ulang
    if (isMapValid(foundMap)) {
        attachMapListeners();
        return;
    }

    // Cari map di react fiber pada semua div
    const containers = document.querySelectorAll("div");
    for (const c of containers) {
        const fiberKey = Object.keys(c).find((k) => k.startsWith("__reactFiber$"));
        if (!fiberKey) continue;
        const fiber = c[fiberKey];
        const map = findMapInFiber(fiber);
        if (isMapValid(map)) {
            foundMap = map;
            attachMapListeners();
            break;
        }
    }
}

// MutationObserver tetap memantau DOM agar saat ronde baru me-remount map, kita otomatis re-bind
const mapObserver = new MutationObserver(() => {
    if (!isMapValid(foundMap)) {
        scanForMap();
    }
});
mapObserver.observe(document.body, { childList: true, subtree: true });
window.addEventListener("load", () => scanForMap());

// =================== Event Listeners Rebind Management ===================
let currentAttachedDiv = null;

function attachMapListeners() {
    if (!isMapValid(foundMap)) return;
    const targetEl = foundMap.getDiv();
    if (!targetEl || targetEl === currentAttachedDiv) return;

    // Bersihkan listener dari div lama jika ada perubahan DOM
    if (currentAttachedDiv) {
        currentAttachedDiv.removeEventListener("wheel", handleWheelZoom);
        currentAttachedDiv.removeEventListener("mousedown", handleMouseDown);
        currentAttachedDiv.removeEventListener("mouseup", handleMouseUp);
        currentAttachedDiv.removeEventListener("mouseleave", handleMouseLeave);
        currentAttachedDiv.removeEventListener("contextmenu", handleContextMenu);
    }

    currentAttachedDiv = targetEl;

    targetEl.addEventListener("wheel", handleWheelZoom, { passive: false });
    targetEl.addEventListener("mousedown", handleMouseDown);
    targetEl.addEventListener("mouseup", handleMouseUp);
    targetEl.addEventListener("mouseleave", handleMouseLeave);
    targetEl.addEventListener("contextmenu", handleContextMenu);
}

// =================== Human-Like Pan & Zoom (Geser Lalu Zoom Perlahan & Alami Tidak Kaku di Tengah) ===================
let currentPanAnimId = null;
let currentZoomTimerId = null;

function stopCurrentAction() {
    if (currentPanAnimId) {
        cancelAnimationFrame(currentPanAnimId);
        currentPanAnimId = null;
    }
    if (currentZoomTimerId) {
        clearTimeout(currentZoomTimerId);
        currentZoomTimerId = null;
    }
}

function getShortestLngDiff(targetLng, currentLng) {
    let diff = targetLng - currentLng;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    return diff;
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

// Konversi pixel offset ke selisih Lat/Lng pada tingkat zoom tertentu (agar target tidak mati di titik tengah)
function getPixelToLatLngOffset(pixelX, pixelY, lat, zoom) {
    const scale = 256 * Math.pow(2, zoom);
    const dLng = (pixelX / scale) * 360;
    const latRad = (lat * Math.PI) / 180;
    const dLat = -(pixelY / scale) * 360 * Math.cos(latRad);
    return { dLat, dLng };
}

function humanPanAndZoom(map, targetLat, targetLng) {
    if (!isMapValid(map) || isNaN(targetLat) || isNaN(targetLng)) return;

    // Hentikan animasi atau timer zoom sebelumnya jika sedang berjalan
    stopCurrentAction();

    const startCenter = map.getCenter();
    if (!startCenter) return;

    const startLat = startCenter.lat();
    const startLng = startCenter.lng();
    const startZoom = map.getZoom();

    const distanceMeters = getDistanceMeters(startLat, startLng, targetLat, targetLng);

    // Tentukan target zoom bertahap manusiawi (naik 2 tingkat zoom per klik tengah, bukan loncat drastis)
    let targetZoom = Math.min(17, startZoom + 2);
    // Batas minimum zoom agar jika dari zoom 1-2 (peta dunia), mendarat di skala negara/kawasan yang terbaca (zoom 4-5)
    if (distanceMeters > 2000000 && targetZoom < 4) {
        targetZoom = 4;
    }

    // Variasi offset alami posisi pandang manusia (TIDAK kaku di pixel tengah 0,0)
    // Manusia menempatkan target dalam pandangan mata yang nyaman, sedikit bergeser dari pusat (~20 - 45px)
    const baseOffsetX = (Math.random() < 0.5 ? -1 : 1) * (22 + Math.random() * 26);
    const baseOffsetY = (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 24);

    // Hitung koordinat pusat geser yang memiliki offset alami dari titik target
    const panOffset = getPixelToLatLngOffset(baseOffsetX, baseOffsetY, targetLat, startZoom);
    const panTargetLat = targetLat + panOffset.dLat;
    const panTargetLng = targetLng + panOffset.dLng;

    const dLat = panTargetLat - startLat;
    const dLng = getShortestLngDiff(panTargetLng, startLng);

    // Durasi geser santai manusiawi (peta meluncur anggun dan tenang, zoom tetap diam)
    const panDuration = distanceMeters < 50000
        ? 380 + Math.floor(Math.random() * 80)
        : Math.min(1250, Math.max(700, 650 + Math.log10(distanceMeters + 1) * 85));

    const startTime = performance.now();

    // Lengkungan mikro gerakan tangan manusia (micro-arc) agar tidak kaku garis lurus robot
    const arcMultiplier = (Math.random() < 0.5 ? -1 : 1) * (0.025 + Math.random() * 0.035);
    const perpLat = -dLng * arcMultiplier;
    const perpLng = dLat * arcMultiplier;

    // === FASE 1: MENGGESER PETA TERLEBIH DAHULU (PANNING ONLY, ZOOM TETAP) ===
    function panFrame(now) {
        if (!isMapValid(map)) {
            stopCurrentAction();
            return;
        }

        const elapsed = now - startTime;
        const rawT = Math.min(1, elapsed / panDuration);
        const t = easeOutCubic(rawT); // Deselerasi lembut seperti tarikan tangan manusia

        const arc = Math.sin(Math.PI * rawT);
        const currentL = startLat + dLat * t + perpLat * arc;
        const currentG = startLng + dLng * t + perpLng * arc;

        map.setCenter(new google.maps.LatLng(currentL, currentG));

        if (rawT < 1) {
            currentPanAnimId = requestAnimationFrame(panFrame);
        } else {
            // Selesai menggeser: posisi target berada di area pandang secara alami (sedikit off-center)
            map.setCenter(new google.maps.LatLng(panTargetLat, panTargetLng));
            currentPanAnimId = null;

            // === FASE 2: JEDA MANUSIAWI SEBELUM MEMULAI ZOOM (MATA MELIHAT LOKASI) ===
            // Manusia berhenti sejenak (~350 - 450ms) untuk melihat pulau/daerah di layar sebelum scroll wheel
            const humanViewPause = 350 + Math.floor(Math.random() * 100);
            currentZoomTimerId = setTimeout(() => {
                // === FASE 3: ZOOM PERLAHAN BERTINGKAT DENGAN DRIFT ALAMI (TIDAK KAKU DEAD-CENTER) ===
                stepZoomPerlahan(map, targetLat, targetLng, targetZoom, baseOffsetX, baseOffsetY);
            }, humanViewPause);
        }
    }

    currentPanAnimId = requestAnimationFrame(panFrame);
}

// Fungsi zoom perlahan bertahap dengan sedikit hand drift alami (seperti manusia memutar scroll wheel)
function stepZoomPerlahan(map, targetLat, targetLng, targetZoom, offsetX, offsetY) {
    if (!isMapValid(map)) {
        stopCurrentAction();
        return;
    }

    const currentZ = map.getZoom();
    if (currentZ < targetZoom) {
        const nextZ = currentZ + 1;

        // Sedikit drift acak tangan manusia saat memutar scroll wheel mouse (~4-8px)
        const currentOffsetX = offsetX + (Math.random() - 0.5) * 12;
        const currentOffsetY = offsetY + (Math.random() - 0.5) * 12;
        const zoomOffset = getPixelToLatLngOffset(currentOffsetX, currentOffsetY, targetLat, nextZ);

        map.setZoom(nextZ);
        // Map berpusat di dekat target dengan offset alami, BUKAN terkunci di titik tengah tepat
        map.setCenter(new google.maps.LatLng(targetLat + zoomOffset.dLat, targetLng + zoomOffset.dLng));

        // Jeda putaran scroll wheel manusia yang santai dan natural (340 - 430ms per notch)
        const scrollDelay = 340 + Math.floor(Math.random() * 90);
        currentZoomTimerId = setTimeout(() => {
            stepZoomPerlahan(map, targetLat, targetLng, targetZoom, currentOffsetX, currentOffsetY);
        }, scrollDelay);
    } else {
        stopCurrentAction();
    }
}

// =================== Wheel Zoom Handler ===================
function handleWheelZoom(e) {
    if (!isMapValid(foundMap) || !dotAdded) return;
    // Scroll sambil tahan tombol tengah (e.buttons === 4)
    if (e.buttons === 4 && globalCoordinates.lat && globalCoordinates.lng) {
        e.preventDefault();
        e.stopPropagation();
        stopCurrentAction();
        const delta = e.deltaY < 0 ? 1 : -1;
        const currentZoom = foundMap.getZoom();
        const newZoom = Math.max(1, Math.min(21, currentZoom + delta));
        foundMap.setZoom(newZoom);
        foundMap.panTo(new google.maps.LatLng(globalCoordinates.lat, globalCoordinates.lng));
    }
}

// =================== Mouse Click Handlers ===================
function handleMouseDown(e) {
    if (!isMapValid(foundMap)) return;

    // === Klik Tengah (Geser Dulu, Lalu Zoom Perlahan) ===
    if (e.button === 1 && dotAdded) {
        e.preventDefault();
        e.stopPropagation();
        if (globalCoordinates.lat && globalCoordinates.lng) {
            humanPanAndZoom(foundMap, globalCoordinates.lat, globalCoordinates.lng);
        }
        return;
    }

    // === Klik Kanan (Tampilkan Titik Marker Target) ===
    if (e.button === 2 && dotAdded) {
        e.preventDefault();
        e.stopPropagation();
        isRightMouseDown = true;
        if (globalCoordinates.lat && globalCoordinates.lng) {
            showMarkerAt(globalCoordinates.lat, globalCoordinates.lng);
        }
    }
}

function handleMouseUp(e) {
    if (e.button === 2) {
        isRightMouseDown = false;
        clearMarker();
    }
}

function handleMouseLeave() {
    if (isRightMouseDown) {
        isRightMouseDown = false;
        clearMarker();
    }
}

function handleContextMenu(e) {
    if (dotAdded) {
        e.preventDefault();
    }
}

// =================== Marker Management (Thread-Safe & High Contrast) ===================
let isRightMouseDown = false;

function showMarkerAt(lat, lng) {
    if (!isMapValid(foundMap) || !lat || !lng) return;

    clearMarker();

    if (!isRightMouseDown) return;

    // 1. Prioritaskan google.maps.Marker bawaan (instan 0ms, 100% kompatibel di raster map GeoGuessr tanpa butuh mapId)
    try {
        if (typeof google !== "undefined" && google.maps && google.maps.Marker) {
            currentMarker = new google.maps.Marker({
                position: { lat, lng },
                map: foundMap,
                zIndex: 9999999,
                clickable: false,
                optimized: false,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 7, // Diameter 14px - sangat jelas & tajam
                    fillColor: "#ff0038", // Merah neon menyala, sangat kontras di semua permukaan peta
                    fillOpacity: 1.0,
                    strokeColor: "#ffffff", // Outline putih tebal agar terlihat jelas di background gelap maupun terang
                    strokeWeight: 2.5,
                }
            });
            return;
        }
    } catch (err) {
        console.warn("[AdGuards] google.maps.Marker gagal, mencoba AdvancedMarkerElement:", err);
    }

    // 2. Fallback ke AdvancedMarkerElement jika Marker klasik tidak ada
    try {
        if (google.maps.marker?.AdvancedMarkerElement) {
            const pinElement = document.createElement("div");
            pinElement.style.width = "14px";
            pinElement.style.height = "14px";
            pinElement.style.borderRadius = "50%";
            pinElement.style.background = "#ff0038";
            pinElement.style.border = "2.5px solid #ffffff";
            pinElement.style.boxShadow = "0 0 6px rgba(0,0,0,0.7), 0 0 10px #ff0038";
            pinElement.style.transform = "translate(-50%, -50%)";
            pinElement.style.pointerEvents = "none";
            pinElement.style.zIndex = "9999999";

            currentMarker = new google.maps.marker.AdvancedMarkerElement({
                map: foundMap,
                position: { lat, lng },
                content: pinElement,
                zIndex: 9999999,
            });
        }
    } catch (err) {
        console.error("[AdGuards] Gagal membuat AdvancedMarkerElement:", err);
    }
}

function clearMarker() {
    if (currentMarker) {
        try {
            if (typeof currentMarker.setMap === "function") {
                currentMarker.setMap(null);
            }
            currentMarker.map = null;
        } catch (_) {}
        currentMarker = null;
    }
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

// =================== Party Modal Auto-Dismiss ===================
function dismissPartyModalIfNeeded() {
    const dialogs = document.querySelectorAll("[role='dialog'], [class*='modal'], [class*='dialog'], div[class*='overlay']");
    for (const dialog of dialogs) {
        const text = dialog.textContent || "";
        if (text.includes("Leave the party page") || text.includes("Leave the party?")) {
            const buttons = dialog.querySelectorAll("button");
            for (const btn of buttons) {
                const btnText = btn.textContent.trim().toLowerCase();
                if (btnText.includes("cancel") || btnText.includes("stay") || btnText.includes("no") || btnText.includes("batal") || btnText.includes("close")) {
                    btn.click();
                    break;
                }
            }
        }
    }
}

// =================== Background Handlers ===================
setInterval(() => {
    if (!isMapValid(foundMap)) {
        scanForMap();
    }
    dismissPartyModalIfNeeded();
}, 1000);
