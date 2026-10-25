// =================== Global Variables ===================
let globalCoordinates = JSON.parse(localStorage.getItem("globalCoordinates")) || { lat: 0, lng: 0 };
let globalPlace = JSON.parse(localStorage.getItem("globalPlace")) || { country: "", state: "", countryCode: "" };
let currentPanoId = "";
let cachedGeoGuessrClues = {
    key: "",
    countryCode: "",
    panoId: "",
    loading: false,
    countryClues: [],
    panoClues: [],
    error: null
};
let playedRounds = []; // Menyimpan riwayat koordinat ronde yang sudah dimainkan dalam game saat ini
let currentRoundCoords = null; // Menyimpan koordinat ronde aktif / prefetch
let currentGameId = ""; // Menyimpan ID game untuk reset ronde saat mulai game baru
let foundMap = null;
let hint = "";
let dotAdded = false;
let currentMarker = null;
let isRightMouseDown = false;
let currentAttachedDiv = null;
let isScanning = false;
let scanTimeout = null;

// =================== Helper to Save ===================
function saveCoordinates() {
    try {
        localStorage.setItem("globalCoordinates", JSON.stringify(globalCoordinates));
        localStorage.setItem("globalPlace", JSON.stringify(globalPlace));
    } catch (_) {}
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
    try {
        const match = location.pathname.match(/\/(game|challenge|duels|live-challenge|party)\/([a-zA-Z0-9_-]+)/);
        return match ? match[2] : location.pathname;
    } catch (_) {
        return "";
    }
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
        try {
            location.hash = newHint;
        } catch (_) {}
    }
}

// =================== Stealth Feedback Indicator ===================
// Tanda aktif super siluman: Tanpa alert/popup, hanya feedback mikro yang diketahui pemilik
function triggerStealthActiveIndicator() {
    try {
        // 1. Indikator di teks "Terms" (Pojok Kanan Bawah Peta - Paling Alami & Stealth)
        const links = Array.from(document.querySelectorAll("a")).filter(isTermsElement);
        links.forEach(link => {
            const originalColor = link.style.color;
            const originalShadow = link.style.textShadow;
            link.textContent = "Terms ✓";
            link.style.transition = "color 0.2s ease, text-shadow 0.2s ease";
            link.style.color = "#38bdf8";
            link.style.textShadow = "0 0 6px rgba(56, 189, 248, 0.8)";
            setTimeout(() => {
                link.textContent = dotAdded ? "Map Terms" : "Terms";
                link.style.color = originalColor || "";
                link.style.textShadow = originalShadow || "";
            }, 900);
        });

        // 2. Indikator Tab Title (Title Pulse 700ms)
        const currentTitle = document.title;
        if (!currentTitle.startsWith("• ")) {
            document.title = "• " + currentTitle;
            setTimeout(() => {
                if (document.title.startsWith("• ")) {
                    document.title = document.title.replace(/^•\s*/, "");
                }
            }, 700);
        }

        // 3. Indikator Border Mikro Layar (1.5px Subtle Edge Flash 220ms)
        let flash = document.getElementById("__adguards_stealth_flash");
        if (!flash) {
            flash = document.createElement("div");
            flash.id = "__adguards_stealth_flash";
            flash.style.position = "fixed";
            flash.style.top = "0";
            flash.style.left = "0";
            flash.style.width = "100vw";
            flash.style.height = "100vh";
            flash.style.pointerEvents = "none";
            flash.style.zIndex = "2147483647";
            flash.style.boxSizing = "border-box";
            flash.style.border = "2px solid rgba(56, 189, 248, 0.45)";
            flash.style.boxShadow = "inset 0 0 12px rgba(56, 189, 248, 0.2)";
            flash.style.opacity = "0";
            flash.style.transition = "opacity 0.25s ease-out";
            (document.body || document.documentElement).appendChild(flash);
        }
        flash.style.opacity = "1";
        setTimeout(() => {
            if (flash) flash.style.opacity = "0";
        }, 220);

        // 4. Console log diam-diam
        console.log("%c🛡️ AdGuards: Active & Synchronized ✓", "color: #38bdf8; font-weight: bold;");
    } catch (_) {}
}

// =================== Coordinate & Location Extractor ===================
function extractCoordsAndHint(interceptedResult) {
    if (!interceptedResult || typeof interceptedResult !== "string") return;
    try {
        const pattern = /-?\d+\.\d+,-?\d+\.\d+/g;
        const countryPattern = /"[A-Z]{2}"/g;
        const statePattern = /"([^"]+?)"\s*,\s*"en"\s*\](?!\s*,)/;

        const match = interceptedResult.match(pattern)?.[0];
        if (!match) return;

        const [lat, lng] = match.split(",").map(Number);
        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

        checkGameReset();

        // Cek jika koordinat ini adalah ronde yang sudah selesai dimainkan sebelumnya.
        if (isAlreadyPlayed(lat, lng)) {
            return;
        }

        // Deteksi transisi ronde atau retry/fallback panorama
        let isNewRound = false;
        if (currentRoundCoords) {
            const distFromCurrent = getDistanceMeters(currentRoundCoords.lat, currentRoundCoords.lng, lat, lng);
            if (distFromCurrent > 500) {
                if (!isAlreadyPlayed(currentRoundCoords.lat, currentRoundCoords.lng)) {
                    playedRounds.push({ lat: currentRoundCoords.lat, lng: currentRoundCoords.lng });
                    if (playedRounds.length > 5) {
                        playedRounds.shift();
                    }
                }
                currentRoundCoords = { lat, lng };
                isNewRound = true;
            } else if (distFromCurrent > 1) {
                currentRoundCoords = { lat, lng };
                isNewRound = true;
            }
        } else {
            currentRoundCoords = { lat, lng };
            isNewRound = true;
        }

        if (isNewRound) {
            globalCoordinates.lat = lat;
            globalCoordinates.lng = lng;
        }

        const countryMatch = interceptedResult.match(countryPattern)?.[0];
        if (countryMatch) {
            const code = countryMatch.replace(/"/g, "");
            globalPlace.countryCode = code;
            try {
                globalPlace.country = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
            } catch (_) {
                globalPlace.country = code;
            }
        } else if (isNewRound) {
            globalPlace.country = "";
            globalPlace.countryCode = "";
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
        if (typeof updatePlonkitUI === "function") {
            updatePlonkitUI();
        }
    } catch (_) {}
}

// =================== Intercept XHR & Fetch (Anti Gagal) ===================
var originalOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url) {
    try {
        if (
            typeof method === "string" && method.toUpperCase() === "POST" &&
            typeof url === "string" &&
            (url.includes("MapsJsInternalService/GetMetadata") ||
             url.includes("MapsJsInternalService/SingleImageSearch") ||
             url.includes("/api/v3/games/") ||
             url.includes("/api/v4/"))
        ) {
            this.addEventListener("load", function () {
                try {
                    if (this.responseType && this.responseType !== "" && this.responseType !== "text") return;
                    extractCoordsAndHint(this.responseText);
                } catch (_) {}
            });
        }
    } catch (_) {}
    return originalOpen.apply(this, arguments);
};

if (typeof window.fetch === "function" && !window.fetch.__adguards_hooked) {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = typeof args[0] === "string" ? args[0] : (args[0]?.url || "");
            if (
                url.includes("MapsJsInternalService/GetMetadata") ||
                url.includes("MapsJsInternalService/SingleImageSearch") ||
                url.includes("/api/v3/games/") ||
                url.includes("/api/v4/")
            ) {
                const clone = response.clone();
                clone.text().then(text => {
                    extractCoordsAndHint(text);
                }).catch(() => {});
            }
        } catch (_) {}
        return response;
    };
    window.fetch.__adguards_hooked = true;
}

function isHintChanged(newHint) {
    if (!newHint || newHint.trim() === "" || newHint.length < 2) return false;
    const current = location.hash ? location.hash.substring(1) : "";
    if (!current || current.length < 2) return true;
    const newCore = newHint.substring(1).toLowerCase();
    const currentCore = current.substring(1).toLowerCase();
    return newCore !== currentCore;
}

// =================== Hook Google Maps Constructor & Prototype ===================
function hookGoogleMapConstructor() {
    try {
        if (typeof google !== "undefined" && google.maps && google.maps.Map && !google.maps.Map.__adguards_hooked) {
            const originalMapCtor = google.maps.Map;
            google.maps.Map = function (...args) {
                const instance = new originalMapCtor(...args);
                try {
                    setTimeout(() => {
                        if (isMapValid(instance)) {
                            foundMap = instance;
                            attachMapListeners();
                        }
                    }, 50);
                } catch (_) {}
                return instance;
            };
            Object.assign(google.maps.Map, originalMapCtor);
            google.maps.Map.prototype = originalMapCtor.prototype;
            google.maps.Map.__adguards_hooked = true;
        }
    } catch (_) {}
}

function hookGoogleMapPrototype() {
    try {
        if (typeof google !== "undefined" && google.maps && google.maps.Map && google.maps.Map.prototype) {
            const proto = google.maps.Map.prototype;
            if (!proto.__adguards_proto_hooked) {
                proto.__adguards_proto_hooked = true;
                const origSetCenter = proto.setCenter;
                proto.setCenter = function (...args) {
                    try {
                        if (isMapValid(this) && foundMap !== this) {
                            foundMap = this;
                            attachMapListeners();
                        }
                    } catch (_) {}
                    return origSetCenter.apply(this, args);
                };
                const origPanTo = proto.panTo;
                proto.panTo = function (...args) {
                    try {
                        if (isMapValid(this) && foundMap !== this) {
                            foundMap = this;
                            attachMapListeners();
                        }
                    } catch (_) {}
                    return origPanTo.apply(this, args);
                };
                const origSetZoom = proto.setZoom;
                proto.setZoom = function (...args) {
                    try {
                        if (isMapValid(this) && foundMap !== this) {
                            foundMap = this;
                            attachMapListeners();
                        }
                    } catch (_) {}
                    return origSetZoom.apply(this, args);
                };
            }
        }
    } catch (_) {}
}

// =================== Map Helpers & Lifecycle Detection ===================
function isGoogleMap(obj) {
    try {
        return !!(obj && typeof obj.getCenter === "function" && typeof obj.setZoom === "function" && typeof obj.getDiv === "function");
    } catch (_) {
        return false;
    }
}

function isMapValid(map) {
    if (!isGoogleMap(map)) return false;
    try {
        const div = map.getDiv();
        if (!div || !document.body || !document.body.contains(div) || div.isConnected === false) return false;
        if (div.offsetWidth === 0 && div.offsetHeight === 0 && div.getClientRects().length === 0) {
            return false;
        }
        const center = map.getCenter();
        return !!(center && typeof center.lat === "function" && !isNaN(center.lat()));
    } catch (_) {
        return false;
    }
}

function findMapInFiber(fiber, depth = 0) {
    if (!fiber || depth > 35) return null;
    try {
        const props = fiber.memoizedProps;
        if (props?.map && isGoogleMap(props.map) && isMapValid(props.map)) return props.map;
        return findMapInFiber(fiber.child, depth + 1) || findMapInFiber(fiber.sibling, depth + 1);
    } catch (_) {
        return null;
    }
}

function requestScanForMap(delay = 250) {
    if (scanTimeout) return;
    scanTimeout = setTimeout(() => {
        scanTimeout = null;
        if (!isMapValid(foundMap)) {
            scanForMap();
        }
    }, delay);
}

function scanForMap() {
    if (isMapValid(foundMap)) {
        attachMapListeners();
        return;
    }
    if (isScanning) return;
    isScanning = true;

    try {
        // 1. Cek container guess-map potensial terlebih dahulu (cepat & tidak membebani CPU)
        const candidates = document.querySelectorAll(
            'div[data-qa="guess-map"], div[class*="guess-map"], div[class*="styles_map__"], div[class*="map-container"], div.widget-scene-canvas'
        );
        for (const c of candidates) {
            const fiberKey = Object.keys(c).find(k => k.startsWith("__reactFiber$"));
            if (!fiberKey) continue;
            const map = findMapInFiber(c[fiberKey]);
            if (isMapValid(map)) {
                foundMap = map;
                attachMapListeners();
                isScanning = false;
                return;
            }
        }

        // 2. Fallback: Cari di kontainer umum dengan batas agar tidak membekukan tab saat error
        const containers = document.querySelectorAll("div");
        const maxCheck = Math.min(containers.length, 120);
        for (let i = 0; i < maxCheck; i++) {
            const c = containers[i];
            const fiberKey = Object.keys(c).find(k => k.startsWith("__reactFiber$"));
            if (!fiberKey) continue;
            const map = findMapInFiber(c[fiberKey]);
            if (isMapValid(map)) {
                foundMap = map;
                attachMapListeners();
                break;
            }
        }
    } catch (_) {}
    isScanning = false;
}

// Deteksi otomatis saat layar GeoGuessr menampilkan pesan gagal memuat panorama
function checkPanoramaFailure() {
    try {
        const text = document.body ? (document.body.innerText || "") : "";
        if (
            text.includes("Failed to load the panorama") ||
            text.includes("Failed to load panorama") ||
            text.includes("Could not load panorama") ||
            text.includes("Unable to load panorama") ||
            text.includes("Error loading panorama")
        ) {
            stopCurrentAction();
            if (!isMapValid(foundMap)) {
                foundMap = null;
            }
        }
    } catch (_) {}
}

// Debounce MutationObserver agar TIDAK membekukan browser saat ronde/panorama gagal dan terjadi banjir mutasi DOM
const mapObserver = new MutationObserver(() => {
    if (!isMapValid(foundMap)) {
        requestScanForMap(300);
    }
});
if (document.body) {
    mapObserver.observe(document.body, { childList: true, subtree: true });
}

hookGoogleMapConstructor();
hookGoogleMapPrototype();

if (document.readyState === "complete" || document.readyState === "interactive") {
    scanForMap();
} else {
    window.addEventListener("load", () => scanForMap());
}
triggerStealthActiveIndicator();

// =================== Event Listeners Rebind Management ===================
let touchTimer = null;
let touchStartPos = { x: 0, y: 0 };
let isTouching = false;
let lastTouchEndTime = 0;

function handleMapTouchStart(e) {
    try {
        if (!isMapValid(foundMap)) {
            scanForMap();
            if (!isMapValid(foundMap)) return;
        }
        if (!dotAdded) return;
        if (e.touches && e.touches.length > 1) {
            if (touchTimer) clearTimeout(touchTimer);
            return;
        }

        const touch = e.touches[0];
        touchStartPos = { x: touch.clientX, y: touch.clientY };
        isTouching = true;

        const now = Date.now();
        if (now - lastTouchEndTime < 300) {
            if (touchTimer) clearTimeout(touchTimer);
            lastTouchEndTime = 0;
            if (globalCoordinates.lat && globalCoordinates.lng) {
                humanPanAndZoom(foundMap, globalCoordinates.lat, globalCoordinates.lng);
            }
            return;
        }

        if (touchTimer) clearTimeout(touchTimer);
        touchTimer = setTimeout(() => {
            if (isTouching && dotAdded && globalCoordinates.lat && globalCoordinates.lng) {
                isRightMouseDown = true;
                showMarkerAt(globalCoordinates.lat, globalCoordinates.lng);
            }
        }, 350);
    } catch (_) {}
}

function handleMapTouchMove(e) {
    try {
        if (e.touches && e.touches.length > 0) {
            const touch = e.touches[0];
            const dx = Math.abs(touch.clientX - touchStartPos.x);
            const dy = Math.abs(touch.clientY - touchStartPos.y);
            if (dx > 12 || dy > 12) {
                if (touchTimer) {
                    clearTimeout(touchTimer);
                    touchTimer = null;
                }
            }
        }
    } catch (_) {}
}

function handleMapTouchEnd() {
    try {
        lastTouchEndTime = Date.now();
        isTouching = false;
        if (touchTimer) {
            clearTimeout(touchTimer);
            touchTimer = null;
        }
        if (isRightMouseDown) {
            isRightMouseDown = false;
            clearMarker();
        }
    } catch (_) {}
}

function attachMapListeners() {
    if (!isMapValid(foundMap)) return;
    try {
        const targetEl = foundMap.getDiv();
        if (!targetEl) return;

        if (targetEl !== currentAttachedDiv) {
            if (currentAttachedDiv) {
                currentAttachedDiv.removeEventListener("wheel", handleWheelZoom);
                currentAttachedDiv.removeEventListener("mousedown", handleMouseDown);
                currentAttachedDiv.removeEventListener("mouseup", handleMouseUp);
                currentAttachedDiv.removeEventListener("mouseleave", handleMouseLeave);
                currentAttachedDiv.removeEventListener("contextmenu", handleContextMenu);
                currentAttachedDiv.removeEventListener("touchstart", handleMapTouchStart);
                currentAttachedDiv.removeEventListener("touchmove", handleMapTouchMove);
                currentAttachedDiv.removeEventListener("touchend", handleMapTouchEnd);
                currentAttachedDiv.removeEventListener("touchcancel", handleMapTouchEnd);
            }
            currentAttachedDiv = targetEl;
        }

        targetEl.removeEventListener("wheel", handleWheelZoom);
        targetEl.removeEventListener("mousedown", handleMouseDown);
        targetEl.removeEventListener("mouseup", handleMouseUp);
        targetEl.removeEventListener("mouseleave", handleMouseLeave);
        targetEl.removeEventListener("contextmenu", handleContextMenu);
        targetEl.removeEventListener("touchstart", handleMapTouchStart);
        targetEl.removeEventListener("touchmove", handleMapTouchMove);
        targetEl.removeEventListener("touchend", handleMapTouchEnd);
        targetEl.removeEventListener("touchcancel", handleMapTouchEnd);

        targetEl.addEventListener("wheel", handleWheelZoom, { passive: false });
        targetEl.addEventListener("mousedown", handleMouseDown);
        targetEl.addEventListener("mouseup", handleMouseUp);
        targetEl.addEventListener("mouseleave", handleMouseLeave);
        targetEl.addEventListener("contextmenu", handleContextMenu);

        targetEl.addEventListener("touchstart", handleMapTouchStart, { passive: true });
        targetEl.addEventListener("touchmove", handleMapTouchMove, { passive: true });
        targetEl.addEventListener("touchend", handleMapTouchEnd, { passive: true });
        targetEl.addEventListener("touchcancel", handleMapTouchEnd, { passive: true });
    } catch (_) {}
}

// =================== Human-Like Pan & Zoom ===================
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

function getPixelToLatLngOffset(pixelX, pixelY, lat, zoom) {
    const scale = 256 * Math.pow(2, zoom);
    const dLng = (pixelX / scale) * 360;
    const latRad = (lat * Math.PI) / 180;
    const dLat = -(pixelY / scale) * 360 * Math.cos(latRad);
    return { dLat, dLng };
}

function humanPanAndZoom(map, targetLat, targetLng) {
    try {
        if (!isMapValid(map) || isNaN(targetLat) || isNaN(targetLng)) return;

        stopCurrentAction();

        const startCenter = map.getCenter();
        if (!startCenter || typeof startCenter.lat !== "function") return;

        const startLat = startCenter.lat();
        const startLng = startCenter.lng();
        const startZoom = map.getZoom();

        const distanceMeters = getDistanceMeters(startLat, startLng, targetLat, targetLng);

        let targetZoom = Math.min(17, startZoom + 2);
        if (distanceMeters > 2000000 && targetZoom < 4) {
            targetZoom = 4;
        }

        const baseOffsetX = (Math.random() < 0.5 ? -1 : 1) * (22 + Math.random() * 26);
        const baseOffsetY = (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 24);

        const panOffset = getPixelToLatLngOffset(baseOffsetX, baseOffsetY, targetLat, startZoom);
        const panTargetLat = targetLat + panOffset.dLat;
        const panTargetLng = targetLng + panOffset.dLng;

        const dLat = panTargetLat - startLat;
        const dLng = getShortestLngDiff(panTargetLng, startLng);

        const panDuration = distanceMeters < 50000
            ? 380 + Math.floor(Math.random() * 80)
            : Math.min(1250, Math.max(700, 650 + Math.log10(distanceMeters + 1) * 85));

        const startTime = performance.now();

        const arcMultiplier = (Math.random() < 0.5 ? -1 : 1) * (0.025 + Math.random() * 0.035);
        const perpLat = -dLng * arcMultiplier;
        const perpLng = dLat * arcMultiplier;

        function panFrame(now) {
            try {
                if (!isMapValid(map)) {
                    stopCurrentAction();
                    return;
                }

                const elapsed = now - startTime;
                const rawT = Math.min(1, elapsed / panDuration);
                const t = easeOutCubic(rawT);

                const arc = Math.sin(Math.PI * rawT);
                const currentL = startLat + dLat * t + perpLat * arc;
                const currentG = startLng + dLng * t + perpLng * arc;

                if (typeof google !== "undefined" && google.maps) {
                    map.setCenter(new google.maps.LatLng(currentL, currentG));
                }

                if (rawT < 1) {
                    currentPanAnimId = requestAnimationFrame(panFrame);
                } else {
                    if (typeof google !== "undefined" && google.maps) {
                        map.setCenter(new google.maps.LatLng(panTargetLat, panTargetLng));
                    }
                    currentPanAnimId = null;

                    const humanViewPause = 350 + Math.floor(Math.random() * 100);
                    currentZoomTimerId = setTimeout(() => {
                        stepZoomPerlahan(map, targetLat, targetLng, targetZoom, baseOffsetX, baseOffsetY);
                    }, humanViewPause);
                }
            } catch (_) {
                stopCurrentAction();
            }
        }

        currentPanAnimId = requestAnimationFrame(panFrame);
    } catch (_) {
        stopCurrentAction();
    }
}

function stepZoomPerlahan(map, targetLat, targetLng, targetZoom, offsetX, offsetY) {
    try {
        if (!isMapValid(map)) {
            stopCurrentAction();
            return;
        }

        const currentZ = map.getZoom();
        if (currentZ < targetZoom) {
            const nextZ = currentZ + 1;
            const currentOffsetX = offsetX + (Math.random() - 0.5) * 12;
            const currentOffsetY = offsetY + (Math.random() - 0.5) * 12;
            const zoomOffset = getPixelToLatLngOffset(currentOffsetX, currentOffsetY, targetLat, nextZ);

            map.setZoom(nextZ);
            if (typeof google !== "undefined" && google.maps) {
                map.setCenter(new google.maps.LatLng(targetLat + zoomOffset.dLat, targetLng + zoomOffset.dLng));
            }

            const scrollDelay = 340 + Math.floor(Math.random() * 90);
            currentZoomTimerId = setTimeout(() => {
                stepZoomPerlahan(map, targetLat, targetLng, targetZoom, currentOffsetX, currentOffsetY);
            }, scrollDelay);
        } else {
            stopCurrentAction();
        }
    } catch (_) {
        stopCurrentAction();
    }
}

// =================== Wheel Zoom Handler ===================
function handleWheelZoom(e) {
    try {
        if (!isMapValid(foundMap) || !dotAdded) return;
        if (e.buttons === 4 && globalCoordinates.lat && globalCoordinates.lng) {
            e.preventDefault();
            e.stopPropagation();
            stopCurrentAction();
            const delta = e.deltaY < 0 ? 1 : -1;
            const currentZoom = foundMap.getZoom();
            const newZoom = Math.max(1, Math.min(21, currentZoom + delta));
            foundMap.setZoom(newZoom);
            if (typeof google !== "undefined" && google.maps) {
                foundMap.panTo(new google.maps.LatLng(globalCoordinates.lat, globalCoordinates.lng));
            }
        }
    } catch (_) {}
}

// =================== Mouse Click Handlers ===================
function handleMouseDown(e) {
    try {
        if (!isMapValid(foundMap)) {
            scanForMap();
            if (!isMapValid(foundMap)) return;
        }

        if (e.button === 1 && dotAdded) {
            e.preventDefault();
            e.stopPropagation();
            if (globalCoordinates.lat && globalCoordinates.lng) {
                humanPanAndZoom(foundMap, globalCoordinates.lat, globalCoordinates.lng);
            }
            return;
        }

        if (e.button === 2 && dotAdded) {
            e.preventDefault();
            e.stopPropagation();
            isRightMouseDown = true;
            if (globalCoordinates.lat && globalCoordinates.lng) {
                showMarkerAt(globalCoordinates.lat, globalCoordinates.lng);
            }
        }
    } catch (_) {}
}

function handleMouseUp(e) {
    try {
        if (e.button === 2) {
            isRightMouseDown = false;
            clearMarker();
        }
    } catch (_) {}
}

function handleMouseLeave() {
    try {
        if (isRightMouseDown) {
            isRightMouseDown = false;
            clearMarker();
        }
    } catch (_) {}
}

function handleContextMenu(e) {
    if (dotAdded) {
        e.preventDefault();
    }
}

// =================== Marker Management ===================
function showMarkerAt(lat, lng, force = false) {
        try {
            if (!isMapValid(foundMap)) {
                scanForMap();
                if (!isMapValid(foundMap)) return;
            }
            if (!lat || !lng) return;

            clearMarker();
            if (!isRightMouseDown && !force && !gMarkerActive) return;

        if (typeof google !== "undefined" && google.maps && google.maps.Marker) {
            currentMarker = new google.maps.Marker({
                position: { lat, lng },
                map: foundMap,
                zIndex: 9999999,
                clickable: false,
                optimized: false,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 2,
                    fillColor: "#0088ff",
                    fillOpacity: 1.0,
                    strokeColor: "#ffffff",
                    strokeWeight: 1,
                }
            });
            return;
        }

        if (typeof google !== "undefined" && google.maps?.marker?.AdvancedMarkerElement) {
            const pinElement = document.createElement("div");
            pinElement.style.width = "4px";
            pinElement.style.height = "4px";
            pinElement.style.borderRadius = "50%";
            pinElement.style.background = "#0088ff";
            pinElement.style.border = "1px solid #ffffff";
            pinElement.style.boxShadow = "0 0 3px #0088ff";
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
    } catch (_) {}
}

function clearMarker() {
    try {
        if (currentMarker) {
            if (typeof currentMarker.setMap === "function") {
                currentMarker.setMap(null);
            }
            currentMarker.map = null;
            currentMarker = null;
        }
    } catch (_) {
        currentMarker = null;
    }
}

function shiftAfterComma(input = "") {
    try {
        const parts = input.split(",");
        const text = parts.length > 1 ? parts.slice(1).join(",").trim() : input;

        const isUpper = Math.random() < 0.5;
        const charCode = 97 + Math.floor(Math.random() * 26);
        const marker = String.fromCharCode(isUpper ? charCode - 32 : charCode);

        const result = text.split("").map(ch => {
            if (ch === " ") return "-";
            if (/[a-zA-Z]/.test(ch)) {
                const base = ch === ch.toUpperCase() ? 65 : 97;
                const code = ch.charCodeAt(0) - base;
                const newCode = (code - 1 + 26) % 26;
                return String.fromCharCode(base + newCode);
            }
            return ch;
        }).join("");

        return marker + result;
    } catch (_) {
        return "";
    }
}

// =================== Terms Interceptor ===================
function isTermsElement(target) {
    if (!target) return false;
    try {
        const a = target.closest ? target.closest("a") : (target.tagName === "A" ? target : null);
        if (!a) return false;
        const text = (a.textContent || "").trim();
        const href = (a.getAttribute("href") || "").toLowerCase();
        return text.includes("Terms") || text.includes("Map Terms") || text.includes("Persyaratan") || href.includes("terms_maps") || href.includes("help/terms");
    } catch (_) {
        return false;
    }
}

function syncTermsText() {
        try {
            const links = Array.from(document.querySelectorAll("a")).filter(isTermsElement);
            links.forEach(link => {
                try {
                    if (link.hasAttribute("href")) {
                        link.removeAttribute("href");
                    }
                    link.removeAttribute("target");
                    link.removeAttribute("rel");
                    link.style.cursor = "pointer";
                    link.style.userSelect = "none";
                    link.style.webkitUserSelect = "none";
                    link.style.touchAction = "manipulation";

                    const desired = dotAdded ? "Map Terms" : "Terms";
                    if (link.textContent !== desired) {
                        link.textContent = desired;
                    }

                    if (!link.__adguards_bound) {
                        link.__adguards_bound = true;
                        const toggleHandler = function(e) {
                            if (e) {
                                e.preventDefault();
                                e.stopPropagation();
                                e.stopImmediatePropagation();
                            }
                            dotAdded = !dotAdded;
                            syncTermsText();
                            if (!dotAdded) {
                                isRightMouseDown = false;
                                clearMarker();
                            }
                            return false;
                        };
                        link.addEventListener("click", toggleHandler, true);
                        link.addEventListener("touchend", toggleHandler, true);
                        link.addEventListener("pointerdown", toggleHandler, true);
                        link.onclick = toggleHandler;
                    }
                } catch (_) {}
            });
        } catch (_) {}
    }

    function handleTermsTrigger(e) {
    try {
        if (isTermsElement(e.target)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            dotAdded = !dotAdded;
            syncTermsText();

            if (!dotAdded) {
                isRightMouseDown = false;
                clearMarker();
            }
            return false;
        }
    } catch (_) {}
}

window.addEventListener("click", handleTermsTrigger, true);
window.addEventListener("touchend", handleTermsTrigger, true);
window.addEventListener("pointerdown", handleTermsTrigger, true);
document.addEventListener("click", handleTermsTrigger, true);
document.addEventListener("touchend", handleTermsTrigger, true);
document.addEventListener("pointerdown", handleTermsTrigger, true);

// =================== GeoGuessr Clue Assistant (Official GeoGuessr v4 Clues + Plonkit Meta) ===================
const GEO_CLUES = {
    "DK": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".dk",
        "bollard": "White cylindrical bollard with a yellow reflective top band, or white post with red rectangular reflector (front) and white reflector (back).",
        "plate": "Standard EU plate with blue strip on left and red border. Commercial delivery vans often have yellow rear plates.",
        "pole": "Mainly wooden poles with distinct metal crossarms or unpainted wooden utility poles.",
        "lines": "White road lines: dashed white edge lines and dashed white center lines.",
        "tips": "Flat landscape with agricultural fields, brick houses with pitched tile roofs. Danish uses unique letters æ, ø, å. Yellow PostNord vans."
    },
    "AL": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".al",
        "bollard": "White post with a black top cap and a vertical red reflector on the front, white reflector on the back.",
        "plate": "Standard European size plate with blue strips on BOTH left and right sides (pre-2011 plates have a red strip on left).",
        "pole": "Concrete utility poles, often rectangular or with metal brackets.",
        "lines": "White outer road lines and dashed white or solid white center lines.",
        "tips": "Sky rifts (distinct dark diagonal lines in the sky on Gen 3 coverage). Rugged mountains, concrete military bunkers, language features ë and ç."
    },
    "JP": {
        "drive": "Left",
        "cam": "Gen 4 (Low Cam)",
        "domain": ".jp",
        "bollard": "White bollard with round white reflector, or distinct yellow/black striped poles near curbs.",
        "plate": "White plates with green characters for standard cars; yellow plates with black characters for kei cars.",
        "pole": "Grey concrete poles with yellow-and-black protective spiral sleeves at the base and complex transformer boxes.",
        "lines": "Solid white outer lines with dashed white or solid yellow center line (no passing).",
        "tips": "Camera height is noticeably lower than standard (Low Cam). Kanji, Hiragana, and Katakana characters everywhere. Driving on the left."
    },
    "ID": {
        "drive": "Left",
        "cam": "Gen 3/4",
        "domain": ".id",
        "bollard": "White-and-black striped concrete bollards or guide stones, often with yellow reflectors.",
        "plate": "Black license plate with white lettering in 3 groups (e.g. B 1234 ABC), with a small expiration date line below.",
        "pole": "Concrete poles with ladders/steps or triangular multi-wire crossarms.",
        "lines": "Solid or dashed white road lines, occasionally yellow center lines on national highways.",
        "tips": "Black Google car with silver roof rack (Gen 3). Driving on the left. Indonesian words: Jl. / Jalan, Kabupaten, Warung, RT/RW."
    },
    "MY": {
        "drive": "Left",
        "cam": "Gen 3/4",
        "domain": ".my",
        "bollard": "White bollards with red/white reflectors, or black-and-white curbstones.",
        "plate": "Black license plate with white lettering (similar to Indonesia, but single-row or distinct font without expiration date line).",
        "pole": "Black square metal poles or concrete poles with blue stickers.",
        "lines": "White outer lines and dashed/solid white center lines.",
        "tips": "White Google car with roof rack. Bahasa Melayu signs (Jalan, Laluan, Hospital). Distinct interstate highway shields (E1, E2)."
    },
    "TH": {
        "drive": "Left",
        "cam": "Gen 3/4",
        "domain": ".th",
        "bollard": "White concrete posts with black top angle bands.",
        "plate": "White license plate with black lettering; yellow plates for commercial vehicles.",
        "pole": "Square concrete utility poles (very distinct sharp rectangular edges).",
        "lines": "White edge lines with yellow center lines.",
        "tips": "Thai script with round loops. White Google car with visible roof rack / antennae. Driving on the left."
    },
    "NO": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".no",
        "bollard": "White bollard with single red reflector (front) and white reflector (back); tall orange snow poles in winter.",
        "plate": "White plate with blue EU-style Norwegian flag strip. Commercial green plates for 2-seater vans.",
        "pole": "Wooden utility poles, often without crossarms or simple top insulators.",
        "lines": "Solid yellow center lines and dashed white edge lines.",
        "tips": "Yellow center lines are standard in Norway (unlike Sweden/Denmark). Dramatic fjords, snow-capped peaks, wooden stave houses."
    },
    "SE": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".se",
        "bollard": "White bollard with white reflective rectangle and black base; orange/blue snow poles in winter.",
        "plate": "White EU plate with blue strip on the left.",
        "pole": "Wooden poles, often darker treated timber.",
        "lines": "Short dashed white center lines (frequent dashes: 3m dash, 9m gap or 1m dash, 2m gap) and dashed white outer lines.",
        "tips": "All road lines are white (never yellow like Norway). Red wooden cottages (Falu red), birch and pine forests. Swedish letters: å, ä, ö."
    },
    "FI": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".fi",
        "bollard": "White bollard with thin rectangular reflector; orange/blue winter reflector sticks.",
        "plate": "White EU plate with blue strip. Non-EU older plates also common without blue strip.",
        "pole": "Wooden poles, frequently paired in A-frame shapes.",
        "lines": "Dashed white edge lines; solid or dashed white or yellow center line depending on road class.",
        "tips": "Finnish language has double vowels/consonants (aa, ee, kk, tt) and words ending in -tie (road). Flat boreal forest with countless lakes."
    },
    "IS": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".is",
        "bollard": "Bright yellow plastic bollards with white/yellow reflective strips.",
        "plate": "White license plate with light blue font and small Icelandic flag, or standard European size.",
        "pole": "Wooden utility poles, often with distinct yellow guy-wire plastic protectors.",
        "lines": "Solid or dashed white center line, dashed yellow edge lines on primary roads.",
        "tips": "Yellow bollards everywhere. Volcanic landscape, lack of trees, glaciers, moss-covered lava fields. Letters: ð, þ, æ, ö."
    },
    "GB": {
        "drive": "Left",
        "cam": "Gen 2/3/4",
        "domain": ".co.uk",
        "bollard": "White plastic bollards with red/amber reflectors, or round plastic bollards on traffic islands.",
        "plate": "White front license plate and YELLOW rear license plate (EU or UK flag on left).",
        "pole": "Dark brown wooden telephone poles with metal steps or climbing rungs.",
        "lines": "Broken white center lines; distinct double yellow lines along curbs indicating no parking.",
        "tips": "Yellow rear plates + white front plates. Driving on the left. Red postboxes, chevron signs with blue backgrounds or yellow borders."
    },
    "IE": {
        "drive": "Left",
        "cam": "Gen 3/4",
        "domain": ".ie",
        "bollard": "White posts with green and red reflectors.",
        "plate": "White plates front and rear with blue EU strip and Irish county name in Gaelic.",
        "pole": "Wooden utility poles.",
        "lines": "Dashed yellow edge lines along shoulders; white center lines.",
        "tips": "Dashed yellow road edge lines are unique to Ireland in Europe. Bilingual signs (English in all-caps, Irish Gaelic in italics above)."
    },
    "DE": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".de",
        "bollard": "White triangular-profile bollard with black slanted stripe containing a vertical white/red reflector.",
        "plate": "Standard EU plate with blue strip, state coat of arms and municipal emissions stickers between letters.",
        "pole": "Utility poles are rare along roads (mostly underground wiring); wooden or concrete when present.",
        "lines": "Solid or dashed white lines; no yellow lines except in construction zones.",
        "tips": "Extensive building blur on older Gen 3 coverage. Red-and-white striped warning signs. German suffixes: -straße, -weg, -platz."
    },
    "FR": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".fr",
        "bollard": "White cylindrical bollard with a red reflective ring (front/rear).",
        "plate": "White EU plate with blue strip on left (F) and regional logo with department number on right.",
        "pole": "Wooden poles or concrete poles with holes; distinct blue/white route markers (Bornes).",
        "lines": "Long dashed white lines along road edges (lines longer than gaps); white center line.",
        "tips": "French street signs are usually dark blue with white borders or white metal plaques. Priority to the right (Priorité à droite)."
    },
    "IT": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".it",
        "bollard": "White bollards with black band and red/white reflectors; black/white striped tunnel bollards.",
        "plate": "Narrow front plate and regular rear plate, both having blue strips on BOTH left and right ends.",
        "pole": "Triangular concrete poles or brown wooden poles with distinctive triangular brackets.",
        "lines": "Continuous or broken white center and edge lines.",
        "tips": "Narrow front license plates are a dead giveaway for Italy. Italian words: Via, Piazza, Corso, Viale. Mediterranean pines and terracotta roofs."
    },
    "ES": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".es",
        "bollard": "White bollard with black horizontal band containing an amber/white reflector.",
        "plate": "Standard EU plate with blue strip on left (E).",
        "pole": "Concrete utility poles with distinct square holes, or wooden poles.",
        "lines": "White outer lines and white center lines. Yellow curb markings indicate loading zones.",
        "tips": "Kilometer markers with colored tops (blue=Autovía, red=Nacional, green/yellow=regional). Spanish words: Calle, Avenida, Camino, Paseo."
    },
    "PT": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".pt",
        "bollard": "White bollard with black cap and rectangular reflector.",
        "plate": "Standard EU plate with blue strip on left; older pre-2020 plates have a distinct yellow vertical strip on the right.",
        "pole": "Concrete utility poles, often with horizontal crossarms.",
        "lines": "White edge lines and white center lines; yellow curbs indicate parking restrictions.",
        "tips": "Yellow strip on right side of older license plates. Portuguese tiles (Azulejos), calçada cobblestone pavements. Words: Rua, Travessa, Praça."
    },
    "NL": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".nl",
        "bollard": "White or red-and-white plastic bollards along rural and cycle paths.",
        "plate": "Bright yellow license plates on both front and rear (blue EU strip on left).",
        "pole": "Utility wiring is completely buried; streetlights are modern grey/silver metal.",
        "lines": "Green center strip between double white lines (100 km/h roads) or dashed white lines without center line (rural 60 km/h roads).",
        "tips": "Bright yellow plates front and rear. Red cycle tracks (Fietspad) everywhere. Exceptionally flat terrain with canals and brick houses."
    },
    "BE": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".be",
        "bollard": "White cylindrical bollard with an orange or red reflective band.",
        "plate": "White plate with red/maroon lettering and border (standard EU blue strip on left).",
        "pole": "Concrete utility poles with crossbars or steel lattice poles.",
        "lines": "White edge lines and white center lines; extensive motorway lighting.",
        "tips": "Red/maroon font on license plates. Bilingual signage (Dutch in north Flanders, French in south Wallonia). Concrete slab roads."
    },
    "PL": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".pl",
        "bollard": "White post with red reflective band (front) and white reflector (back); top angled cut.",
        "plate": "Standard EU plate with blue strip (PL).",
        "pole": "Concrete utility poles, often circular or spun concrete with multi-tier brackets.",
        "lines": "Solid or dashed white center and edge lines.",
        "tips": "Polish words: Ulica (Ul.), Aleja (Al.), Plac. Characteristic letters: ą, ę, ł, ś, ć, ż, ź. Red and white pedestrian signs."
    },
    "CZ": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".cz",
        "bollard": "White bollard with black base and two vertical orange/white reflectors on front.",
        "plate": "Standard EU plate with blue strip (CZ).",
        "pole": "Concrete poles with rounded or tapered tops.",
        "lines": "White outer lines and white center lines.",
        "tips": "Czech letters: ř, ě, š, č, ž, ů. Blue pedestrian crossing signs with white interior border. Words: Ulice, Náměstí, Třída."
    },
    "SK": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".sk",
        "bollard": "White bollard with black base and two vertical reflectors.",
        "plate": "Standard EU plate with Slovak coat of arms next to blue strip (SK).",
        "pole": "Concrete poles similar to Czech Republic.",
        "lines": "White edge lines and white center lines.",
        "tips": "Slovak language features ä, ľ, ĺ, ŕ, ô. High Tatras mountains in the north. Blue highway signs (Diaľnica)."
    },
    "AT": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".at",
        "bollard": "White bollard with rounded black top cap and a vertical red reflector.",
        "plate": "Standard EU plate with Austrian provincial coat of arms between state letters and numbers; red border around plate.",
        "pole": "Dark wooden poles or concrete poles; metal guardrail posts.",
        "lines": "White edge lines and white center lines.",
        "tips": "Austrian license plates have a subtle red border. Alpine peaks, immaculate chalets with wooden balconies. Words: Gasse, Straße."
    },
    "CH": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".ch",
        "bollard": "White bollard with black cap and white rectangular reflector.",
        "plate": "Small front plate without EU blue strip; rear plate with Swiss shield on left and canton shield on right.",
        "pole": "Wooden poles with metal crossbars or lattice steel poles in mountain passes.",
        "lines": "Yellow pedestrian crossings (Zebrastreifen) and white road center lines.",
        "tips": "Yellow zebra crosswalks are unique to Switzerland. Swiss cross on license plates. Multilingual: German, French, Italian, Romansh."
    },
    "GR": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".gr",
        "bollard": "White plastic bollard with red reflective top stripe or black/yellow striped posts.",
        "plate": "White EU plate with blue strip (GR); pre-2004 plates are plain white without blue strip.",
        "pole": "Concrete poles with metal rungs or treated wooden poles with porcelain insulators.",
        "lines": "White edge lines; solid or dashed white/yellow center lines on mountain roads.",
        "tips": "Greek alphabet (Ω, Δ, Σ, Θ, etc.). Olive trees, arid rocky mountains, blue-and-white churches. Bilingual signs in Greek and Latin script."
    },
    "TR": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".tr",
        "bollard": "White plastic bollards with red/white reflective rectangles, often with black bases.",
        "plate": "White EU-style plate with blue strip (TR) on the left.",
        "pole": "Concrete utility poles with multiple triangular or T-shaped crossarms.",
        "lines": "White road lines; yellow lines are rare except in roadworks.",
        "tips": "Turkish language with dotless ı, dotted İ, ş, ç, ğ, ö, ü. Words: Sokak (Sk.), Cadde (Cd.), Mahalle (Mah.). Mosques with minarets."
    },
    "RO": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".ro",
        "bollard": "White bollard with red reflective band on angled top.",
        "plate": "Standard EU plate with blue strip (RO).",
        "pole": "Concrete poles, frequently painted with white reflective paint at the base.",
        "lines": "White center and outer lines.",
        "tips": "White-painted bottoms of utility poles and roadside trees. Romanian letters: ă, â, î, ș, ț. Words: Strada (Str.), Calea, Bulevardul."
    },
    "HU": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".hu",
        "bollard": "White bollard with angled red reflective top strip.",
        "plate": "Standard EU plate with blue strip (H); Hungarian coat of arms on newer 2022+ plates.",
        "pole": "Concrete utility poles, often with metal struts or circular spun concrete.",
        "lines": "White outer lines and white center lines.",
        "tips": "Hungarian language with distinctive accents (ő, ű, á, é, í, ó, ö, ú, ü). Words: Utca (u.), Út, Tér. Flat Pannonian plains."
    },
    "BG": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".bg",
        "bollard": "White bollard with red reflective rectangle.",
        "plate": "Standard EU plate with blue strip (BG).",
        "pole": "Concrete poles, often rectangular with hollow slots or steel crossbars.",
        "lines": "White road lines.",
        "tips": "Cyrillic alphabet (България, ул., бул.). Winter coverage with snow and leafless trees is common on Gen 3."
    },
    "HR": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".hr",
        "bollard": "White bollard with black cap and vertical reflector.",
        "plate": "Standard EU plate with Croatian coat of arms between city code and digits.",
        "pole": "Concrete poles with metal brackets or dark wooden poles.",
        "lines": "White outer and center road lines.",
        "tips": "Croatian coat of arms (checkerboard) on license plates. Coastal Dalmatian stone walls and cypress trees. Words: Ulica, Trg."
    },
    "RS": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".rs",
        "bollard": "White bollard with red reflector and black base.",
        "plate": "White plate with blue strip (SRB) on left and Serbian coat of arms.",
        "pole": "Concrete poles or wooden poles.",
        "lines": "White road lines.",
        "tips": "Both Cyrillic and Latin alphabets are used on signs. Serbian coat of arms on plates. Words: Ulica, Trg."
    },
    "US": {
        "drive": "Right",
        "cam": "Gen 2/3/4",
        "domain": ".us / .com",
        "bollard": "Flexible white or yellow delineator posts with small rectangular reflectors.",
        "plate": "Short rectangular license plates (12x6 inches), distinct colorful design per state.",
        "pole": "Tall dark brown wooden utility poles carrying thick bundles of cables and cylinder transformers.",
        "lines": "Yellow center lines (solid double yellow for no passing; broken yellow for passing); white outer edge lines.",
        "tips": "Yellow center road lines are universal. Speed limit signs in MPH. Interstate highway shield badges (I-XX, US-XX). Standard English."
    },
    "CA": {
        "drive": "Right",
        "cam": "Gen 2/3/4",
        "domain": ".ca",
        "bollard": "White/yellow flexible delineator posts or wooden snow marker sticks.",
        "plate": "Short rectangular plates (12x6 inches) with province names (e.g. Ontario, Quebec, Alberta).",
        "pole": "Tall wooden utility poles similar to US, but speed limits are posted in km/h with 'MAXIMUM'.",
        "lines": "Yellow center lines (double solid or dashed) and white edge lines.",
        "tips": "Speed limit signs state 'MAXIMUM' in km/h. Bilingual signs in French & English (Quebec is exclusively French). Trans-Canada Highway maple leaf shield."
    },
    "MX": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".mx",
        "bollard": "White concrete or plastic posts with red reflectors.",
        "plate": "Short rectangular plates with state names printed at the top/bottom.",
        "pole": "Square or octagonal concrete utility poles; wooden poles in rural areas.",
        "lines": "White edge lines and yellow center lines (similar to US).",
        "tips": "Octagonal stop signs state 'ALTO' (never 'PARE'). Pemex gas stations. Water tanks (tinacos) on flat rooftops. Words: Calle, Calzada."
    },
    "BR": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".br",
        "bollard": "White and orange/red delineators along highways.",
        "plate": "Mercosul license plate: white background with blue horizontal band at top; older plates are grey with state abbreviation.",
        "pole": "Square concrete utility poles with curved or horizontal concrete crossarms; three-wire brackets.",
        "lines": "White outer lines and yellow center lines.",
        "tips": "Black car with antenna (Gen 4) or visible roof rails. Red soil (terra roxa) in many regions. Portuguese words: Rua, Avenida, Rodovia."
    },
    "AR": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".ar",
        "bollard": "White delineators with red reflective strips.",
        "plate": "Mercosul plate: white with blue top band (similar to Brazil, but format is AA 123 AA).",
        "pole": "Concrete utility poles or wooden poles with crossarms.",
        "lines": "White edge lines and yellow center lines.",
        "tips": "Black Google car with thick roof rack. Vast flat pampas, poplar windbreaks, eucalyptus trees. Signs state 'PARE' for stop."
    },
    "CL": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".cl",
        "bollard": "White bollards with red/orange reflectors.",
        "plate": "White license plate with dark blue lettering (Chilean flag badge in center on newer plates).",
        "pole": "Concrete utility poles with distinct reinforcement struts.",
        "lines": "White center and outer lines; yellow lines in mountain passes.",
        "tips": "White Google car without roof rack. Andes mountain backdrop to the east, Pacific to the west. Road signs have dark blue or green highway shields."
    },
    "CO": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".co",
        "bollard": "White and yellow markers along winding mountain roads.",
        "plate": "BRIGHT YELLOW license plates on all private vehicles; white plates for public transport/taxis.",
        "pole": "Square concrete poles or stepped wooden poles.",
        "lines": "White edge lines and yellow center lines.",
        "tips": "Bright yellow license plates on almost every vehicle. Mountainous topography with lush cloud forests. Signs state 'PARE'."
    },
    "AU": {
        "drive": "Left",
        "cam": "Gen 2/3/4",
        "domain": ".au",
        "bollard": "White flexible bollard with red rectangular reflector (left side) and white reflector (right side).",
        "plate": "Rectangular plates with state names (e.g. Victoria, NSW, Queensland) or slimline plates.",
        "pole": "Wooden utility poles or steel Stobie poles (two steel vertical beams with concrete core, unique to South Australia).",
        "lines": "Broken or solid white center lines; yellow edge lines in snowy alpine regions.",
        "tips": "Driving on the left. Eucalyptus trees (gum trees), red dirt, distinct wildlife warning signs (kangaroo, koala, wombat). Speed signs have black numbers in red circle."
    },
    "NZ": {
        "drive": "Left",
        "cam": "Gen 2/3/4",
        "domain": ".nz",
        "bollard": "White flexible post with a red reflector on the left and white reflector on the right; red bands on bridge balustrades.",
        "plate": "White plate with black lettering front and rear (no blue EU strip).",
        "pole": "Concrete utility poles with hollow circular notches, or wooden poles.",
        "lines": "White center lines (dashed) and solid white edge lines.",
        "tips": "Driving on the left. Rolling green hills, sheep pastures, snow-capped Southern Alps, silver fern vegetation. Bridge warning paddles with black-and-white diagonal stripes."
    },
    "ZA": {
        "drive": "Left",
        "cam": "Gen 2/3/4",
        "domain": ".za",
        "bollard": "White concrete markers with yellow/white reflectors.",
        "plate": "White license plates front and rear with province coat of arms / logo; Western Cape and Gauteng use distinct font.",
        "pole": "Wooden utility poles or steel lattice poles.",
        "lines": "Yellow outer edge lines and white center lines.",
        "tips": "Yellow outer road lines are a key hallmark of South Africa and southern African countries. Driving on the left. White Google car with roof rack."
    },
    "KR": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".kr",
        "bollard": "White plastic bollard with orange/yellow reflective strip.",
        "plate": "White plates with black Hangul characters; older commercial plates are yellow.",
        "pole": "Concrete utility poles with yellow-and-black protective spiral sleeves at base (similar to Japan, but driving on the right).",
        "lines": "Yellow center line (single or double) and white edge lines; blue bus lanes.",
        "tips": "Hangul script (circles and straight lines). Driving on the RIGHT (distinguishes from Japan). Tall apartment blocks with large numbers on side."
    },
    "TW": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".tw",
        "bollard": "White/yellow bollards with reflective tape.",
        "plate": "White license plate with black lettering (format: ABC-1234).",
        "pole": "Concrete poles marked with yellow-and-black diagonal hazard paint stripes at the base.",
        "lines": "Solid double yellow center lines and white edge lines.",
        "tips": "Traditional Chinese characters (繁體中文). Yellow-and-black striped utility poles. Red-and-white motorcycle boxes at traffic lights."
    },
    "PH": {
        "drive": "Right",
        "cam": "Gen 3/4",
        "domain": ".ph",
        "bollard": "Concrete guide posts with black/white paint.",
        "plate": "White plate with green or black letters and 'MATATAG NA REPUBLIKA' or 'PILIPINAS' below.",
        "pole": "Concrete poles or wooden poles with heavy transformer setups.",
        "lines": "White edge lines and solid/dashed white center lines.",
        "tips": "Driving on the right. Jeepneys, tricycles, English road signs. Coconut palms and tropical scenery."
    },
    "SG": {
        "drive": "Left",
        "cam": "Gen 3/4",
        "domain": ".sg",
        "bollard": "White plastic bollards with amber reflectors.",
        "plate": "White front license plate and yellow rear license plate (black background also common).",
        "pole": "Modern silver metal streetlights; all utility wires are underground.",
        "lines": "Crisp white road lines, yellow zig-zag curb markings indicating no parking.",
        "tips": "Hyper-clean tropical city-state. Driving on the left. English street signs with green/white headers. ERP toll gantries."
    }
};

    // =================== Official GeoGuessr Clues Engine (Iris AI) ===================
    function triggerCluesFetch() {
        const cc = (globalPlace.countryCode || "").toLowerCase();
        const pano = currentPanoId || "";
        if (!cc && !pano) return;

        const cacheKey = `${cc}_${pano}`;
        if (cachedGeoGuessrClues.key === cacheKey && (cachedGeoGuessrClues.countryClues.length > 0 || cachedGeoGuessrClues.panoClues.length > 0)) {
            return;
        }

        cachedGeoGuessrClues.key = cacheKey;
        cachedGeoGuessrClues.countryCode = cc;
        cachedGeoGuessrClues.panoId = pano;
        cachedGeoGuessrClues.loading = true;
        cachedGeoGuessrClues.countryClues = [];
        cachedGeoGuessrClues.panoClues = [];
        cachedGeoGuessrClues.error = null;

        if (plonkitActive && typeof updatePlonkitUI === "function") {
            updatePlonkitUI();
        }

        const tasks = [];
        // Fetch official GeoGuessr country educational clues (/api/v4/clues/country/{countryCode}?count=8)
        if (cc) {
            tasks.push(
                fetch("/api/v4/clues/country/" + encodeURIComponent(cc) + "?count=8", { credentials: "include" })
                    .then(res => res.ok ? res.json() : null)
                    .then(data => {
                        if (Array.isArray(data)) {
                            cachedGeoGuessrClues.countryClues = data;
                        } else if (data && Array.isArray(data.clues)) {
                            cachedGeoGuessrClues.countryClues = data.clues;
                        }
                    })
                    .catch(() => {})
            );
        }

        // Fetch official GeoGuessr panorama-specific visual clues (/api/v4/clues/{panoId})
        if (pano) {
            tasks.push(
                fetch("/api/v4/clues/" + encodeURIComponent(pano), { credentials: "include" })
                    .then(res => res.ok ? res.json() : null)
                    .then(data => {
                        if (Array.isArray(data)) {
                            cachedGeoGuessrClues.panoClues = data;
                        } else if (data && Array.isArray(data.clues)) {
                            cachedGeoGuessrClues.panoClues = data.clues;
                        }
                    })
                    .catch(() => {})
            );
        }

        Promise.all(tasks).finally(() => {
            cachedGeoGuessrClues.loading = false;
            if (plonkitActive && typeof updatePlonkitUI === "function") {
                updatePlonkitUI();
            }
        });
    }

    function escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function getGeoGuessrImageUrl(imagePath) {
        if (!imagePath) return "";
        if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) return imagePath;
        if (imagePath.startsWith("/")) return "https://www.geoguessr.com" + imagePath;
        return "https://www.geoguessr.com/images/auto/384/256/ce/0/plain/" + imagePath;
    }

    function getTypeBadge(type) {
        const t = (type || "").toLowerCase();
        if (t.includes("sign")) return "🪧 Road Signs";
        if (t.includes("plate")) return "🚘 License Plates";
        if (t.includes("arch")) return "🏛️ Architecture";
        if (t.includes("lang")) return "🔤 Language";
        if (t.includes("pole") || t.includes("infra")) return "🪵 Infrastructure";
        if (t.includes("bollard")) return "📍 Bollard";
        if (t.includes("line") || t.includes("mark")) return "🛣️ Road Lines";
        if (t.includes("nature") || t.includes("land")) return "🌲 Landscape";
        return "💡 " + (t ? t.replace(/-/g, " ").toUpperCase() : "CLUE");
    }

    function getComplexityBadge(comp) {
        const n = Number(comp) || 1;
        if (n === 1) return '<span class="clue-complexity-badge complexity-1">⭐ Easy</span>';
        if (n === 2) return '<span class="clue-complexity-badge complexity-2">⭐⭐ Medium</span>';
        return '<span class="clue-complexity-badge complexity-3">⭐⭐⭐ Advanced</span>';
    }

    function generatePlonkitRewrittenHtml(countryCode, countryName, state) {
        const c = (countryCode || "").toUpperCase();
        const codeLower = c.toLowerCase() || "un";
        const clue = c ? (GEO_CLUES[c] || null) : null;

        // Core metadata
        const drive = (clue ? clue.drive : "Right").trim();
        const cam = clue ? (clue.cam || "Gen 3/4") : "Gen 3/4";
        const domain = clue ? (clue.domain || ("." + codeLower)) : ("." + codeLower);

        const isLeft = drive.toLowerCase() === "left" || drive.toLowerCase() === "kiri";
        const driveColor = isLeft ? "#f59e0b" : "#38bdf8";
        const driveBg = isLeft ? "rgba(245, 158, 11, 0.15)" : "rgba(56, 189, 248, 0.15)";
        const driveBorder = isLeft ? "rgba(245, 158, 11, 0.35)" : "rgba(56, 189, 248, 0.35)";

        // Plonkit Clues
        const bollard = clue ? (clue.bollard || "") : "";
        const plate = clue ? (clue.plate || "") : "";
        const pole = clue ? (clue.pole || "") : "";
        const lines = clue ? (clue.lines || "") : "";
        const tips = clue ? (clue.tips || "") : "";

        const panoClues = cachedGeoGuessrClues.panoClues || [];
        const countryClues = cachedGeoGuessrClues.countryClues || [];
        const isLoading = cachedGeoGuessrClues.loading;

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
    ::-webkit-scrollbar-thumb { background: rgba(56, 189, 248, 0.3); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(56, 189, 248, 0.6); }
    body {
        background: #090e1a;
        color: #f1f5f9;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        padding: 16px;
        font-size: 13px;
        line-height: 1.5;
        user-select: none;
    }
    .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        margin-bottom: 14px;
        position: sticky;
        top: 0;
        background: #090e1a;
        z-index: 10;
    }
    .header-left {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .flag {
        width: 44px;
        height: 30px;
        border-radius: 4px;
        object-fit: cover;
        box-shadow: 0 2px 8px rgba(0,0,0,0.6);
        border: 1px solid rgba(255,255,255,0.15);
    }
    .title-group h1 {
        font-size: 16px;
        font-weight: 700;
        color: #ffffff;
        line-height: 1.2;
    }
    .title-group .state {
        font-size: 11px;
        color: #94a3b8;
    }
    .header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .badge-h {
        background: rgba(56, 189, 248, 0.15);
        border: 1px solid rgba(56, 189, 248, 0.3);
        color: #38bdf8;
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        font-family: monospace;
    }
    .btn-close {
        background: none;
        border: none;
        color: #94a3b8;
        font-size: 18px;
        cursor: pointer;
        padding: 2px 6px;
        line-height: 1;
        transition: color 0.15s;
    }
    .btn-close:hover { color: #ffffff; }

    .badges {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 14px;
    }
    .badge {
        padding: 4px 9px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }
    .badge-drive {
        background: ${driveBg};
        color: ${driveColor};
        border: 1px solid ${driveBorder};
    }
    .badge-cam {
        background: rgba(255, 255, 255, 0.06);
        color: #e2e8f0;
        border: 1px solid rgba(255, 255, 255, 0.12);
    }
    .badge-domain {
        background: rgba(56, 189, 248, 0.1);
        color: #38bdf8;
        border: 1px solid rgba(56, 189, 248, 0.25);
        font-family: monospace;
    }

    .section-divider {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.8px;
        color: #38bdf8;
        text-transform: uppercase;
        margin: 18px 0 10px;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .section-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: rgba(56, 189, 248, 0.2);
    }
    .section-divider-meta {
        color: #94a3b8;
    }
    .section-divider-meta::after {
        background: rgba(255, 255, 255, 0.08);
    }

    .sub-divider {
        font-size: 10.5px;
        font-weight: 700;
        color: #94a3b8;
        margin: 10px 0 6px;
        letter-spacing: 0.4px;
        text-transform: uppercase;
    }

    /* GeoGuessr Official Clue Cards */
    .clue-card {
        background: #111827;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        padding: 12px;
        margin-bottom: 10px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .clue-card:hover {
        border-color: rgba(56, 189, 248, 0.4);
        transform: translateY(-1px);
    }
    .clue-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
        gap: 6px;
        flex-wrap: wrap;
    }
    .clue-type-badge {
        background: rgba(56, 189, 248, 0.12);
        border: 1px solid rgba(56, 189, 248, 0.3);
        color: #38bdf8;
        font-size: 10px;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 5px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
    }
    .clue-complexity-badge {
        font-size: 9.5px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 4px;
    }
    .complexity-1 {
        background: rgba(16, 185, 129, 0.15);
        color: #34d399;
        border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .complexity-2 {
        background: rgba(245, 158, 11, 0.15);
        color: #fbbf24;
        border: 1px solid rgba(245, 158, 11, 0.3);
    }
    .complexity-3 {
        background: rgba(168, 85, 247, 0.15);
        color: #c084fc;
        border: 1px solid rgba(168, 85, 247, 0.3);
    }
    .clue-heading-badge {
        background: rgba(255, 255, 255, 0.07);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #e2e8f0;
        font-size: 9.5px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 4px;
    }
    .clue-title {
        font-size: 13px;
        font-weight: 700;
        color: #ffffff;
        margin-bottom: 6px;
        line-height: 1.3;
    }
    .clue-img-wrap {
        width: 100%;
        margin: 6px 0 8px 0;
        border-radius: 8px;
        overflow: hidden;
        background: #090e1a;
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .clue-img {
        width: 100%;
        max-height: 160px;
        object-fit: cover;
        display: block;
        transition: transform 0.2s ease;
    }
    .clue-img:hover {
        transform: scale(1.02);
    }
    .clue-desc {
        color: #cbd5e1;
        font-size: 11.5px;
        line-height: 1.5;
    }

    .loading-box {
        text-align: center;
        padding: 16px 10px;
        color: #94a3b8;
        background: rgba(56, 189, 248, 0.03);
        border: 1px dashed rgba(56, 189, 248, 0.25);
        border-radius: 8px;
        margin-bottom: 12px;
        font-size: 11.5px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
    }
    .spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(56, 189, 248, 0.2);
        border-top-color: #38bdf8;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
        to { transform: rotate(360deg); }
    }
    .empty-clues-box {
        padding: 10px 12px;
        background: rgba(255,255,255,0.02);
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.06);
        color: #94a3b8;
        font-size: 11px;
        line-height: 1.4;
        margin-bottom: 10px;
    }

    /* Plonkit Meta Cards */
    .card {
        background: #111827;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        padding: 11px 13px;
        margin-bottom: 9px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .card-title {
        font-size: 11px;
        font-weight: 700;
        color: #38bdf8;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 4px;
    }
    .card-body {
        color: #cbd5e1;
        font-size: 12px;
        line-height: 1.5;
    }
    .tips-card {
        background: rgba(56, 189, 248, 0.06);
        border: 1px solid rgba(56, 189, 248, 0.25);
    }
    .tips-card .card-title { color: #38bdf8; }
    .tips-card .card-body { color: #f8fafc; font-weight: 500; }

    .footer-note {
        margin-top: 18px;
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        font-size: 11px;
        color: #64748b;
        text-align: center;
    }
</style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <img class="flag" src="https://flagcdn.com/w80/${codeLower}.png" alt="${countryName}" onerror="this.style.display='none'">
            <div class="title-group">
                <h1>${countryName ? countryName : "Awaiting Round Detection..."}</h1>
                ${state ? `<div class="state">${state}</div>` : ""}
            </div>
        </div>
        <div class="header-actions">
            <span class="badge-h">[H]</span>
            <button class="btn-close" onclick="window.parent.postMessage({type:'ADGUARDS_CLOSE_IFRAME'}, '*')" title="Close guide (Press H)">✕</button>
        </div>
    </div>

    ${countryName ? `
        <!-- Top Meta Badges -->
        <div class="badges">
            <span class="badge badge-drive">🚗 Drive: ${drive}</span>
            <span class="badge badge-cam">📷 ${cam}</span>
            <span class="badge badge-domain">🌐 ${domain}</span>
        </div>

        <!-- 1. OFFICIAL GEOGUESSR IRIS CLUES SECTION -->
        <div class="section-divider">🎯 GeoGuessr Iris Clues</div>

        ${isLoading ? `
            <div class="loading-box">
                <div class="spinner"></div>
                <span>Fetching official GeoGuessr Iris clues...</span>
            </div>
        ` : ""}

        <!-- Panorama Specific Clues -->
        ${panoClues.length > 0 ? `
            <div class="sub-divider">📍 Panorama Clues (${panoClues.length})</div>
            ${panoClues.map(item => `
                <div class="clue-card">
                    <div class="clue-header">
                        <span class="clue-type-badge">${getTypeBadge(item.type || item.category)}</span>
                        ${item.complexity ? getComplexityBadge(item.complexity) : ""}
                        ${typeof item.heading === "number" ? `<span class="clue-heading-badge">🧭 Heading ${Math.round(item.heading)}°</span>` : ""}
                    </div>
                    <div class="clue-title">${escapeHtml(item.title || "Target Object Clue")}</div>
                    ${item.imagePath ? `
                        <div class="clue-img-wrap">
                            <img class="clue-img" src="${getGeoGuessrImageUrl(item.imagePath)}" alt="${escapeHtml(item.title || '')}" loading="lazy" onerror="this.parentElement.style.display='none'">
                        </div>
                    ` : ""}
                    ${item.description ? `<div class="clue-desc">${escapeHtml(item.description)}</div>` : ""}
                </div>
            `).join("")}
        ` : ""}

        <!-- Country Educational Clues -->
        ${countryClues.length > 0 ? `
            <div class="sub-divider">🗺️ Country Clues (${countryClues.length})</div>
            ${countryClues.map(item => `
                <div class="clue-card">
                    <div class="clue-header">
                        <span class="clue-type-badge">${getTypeBadge(item.type || item.category)}</span>
                        ${item.complexity ? getComplexityBadge(item.complexity) : ""}
                    </div>
                    <div class="clue-title">${escapeHtml(item.title || "Country Clue")}</div>
                    ${item.imagePath ? `
                        <div class="clue-img-wrap">
                            <img class="clue-img" src="${getGeoGuessrImageUrl(item.imagePath)}" alt="${escapeHtml(item.title || '')}" loading="lazy" onerror="this.parentElement.style.display='none'">
                        </div>
                    ` : ""}
                    ${item.description ? `<div class="clue-desc">${escapeHtml(item.description)}</div>` : ""}
                </div>
            `).join("")}
        ` : ""}

        ${(!isLoading && panoClues.length === 0 && countryClues.length === 0) ? `
            <div class="empty-clues-box">
                ℹ️ No official GeoGuessr Iris clues found for ${countryName} in the v4 database. Plonkit guide is active below.
            </div>
        ` : ""}

        <!-- 2. PLONKIT CLUES & META SECTION -->
        <div class="section-divider section-divider-meta">📖 Plonkit Clues & Meta</div>

        ${bollard ? `
            <div class="card">
                <div class="card-title">🪧 BOLLARDS & REFLECTORS</div>
                <div class="card-body">${bollard}</div>
            </div>
        ` : ""}

        ${plate ? `
            <div class="card">
                <div class="card-title">🚘 LICENSE PLATES</div>
                <div class="card-body">${plate}</div>
            </div>
        ` : ""}

        ${pole ? `
            <div class="card">
                <div class="card-title">🪵 UTILITY POLES & INFRASTRUCTURE</div>
                <div class="card-body">${pole}</div>
            </div>
        ` : ""}

        ${lines ? `
            <div class="card">
                <div class="card-title">🛣️ ROAD LINES & MARKINGS</div>
                <div class="card-body">${lines}</div>
            </div>
        ` : ""}

        ${tips ? `
            <div class="card tips-card">
                <div class="card-title">💡 KEY META TIPS</div>
                <div class="card-body">${tips}</div>
            </div>
        ` : ""}

    ` : `
        <div style="text-align: center; padding: 36px 12px; color: #94a3b8;">
            <div style="font-size: 32px; margin-bottom: 10px;">🧭</div>
            <div style="font-size: 14px; font-weight: 700; color: #cbd5e1; margin-bottom: 6px;">Awaiting Round Location...</div>
            <div style="font-size: 11.5px; color: #64748b; line-height: 1.5;">Official GeoGuessr visual clues and Plonkit meta tips will automatically load as soon as Street View coordinates are detected.</div>
        </div>
    `}

    <div class="footer-note">
        Press <strong style="color: #38bdf8;">H</strong> on keyboard to hide / show this guide
    </div>
</body>
</html>`;
    }

    function createOrGetPlonkitIframe() {
        let iframe = document.getElementById("__adguards_plonkit_iframe");
        if (iframe) return iframe;

        iframe = document.createElement("iframe");
        iframe.id = "__adguards_plonkit_iframe";
        iframe.style.position = "fixed";
        iframe.style.top = "60px";
        iframe.style.left = "16px";
        iframe.style.width = "390px";
        iframe.style.maxWidth = "calc(100vw - 32px)";
        iframe.style.height = "calc(100vh - 85px)";
        iframe.style.zIndex = "2147483640";
        iframe.style.border = "1px solid rgba(56, 189, 248, 0.4)";
        iframe.style.borderRadius = "14px";
        iframe.style.boxShadow = "0 16px 48px rgba(0, 0, 0, 0.85), 0 0 20px rgba(56, 189, 248, 0.15)";
        iframe.style.background = "#090e1a";
        iframe.style.display = "none";
        iframe.style.userSelect = "none";

        (document.body || document.documentElement).appendChild(iframe);
        plonkitIframeEl = iframe;
        return iframe;
    }

function updatePlonkitUI() {
    const iframe = createOrGetPlonkitIframe();
    if (!plonkitActive) {
        iframe.style.display = "none";
        return;
    }

    iframe.style.display = "block";

    const country = globalPlace.country || "";
    const countryCode = (globalPlace.countryCode || "").toUpperCase();
    const state = globalPlace.state || "";

    const html = generatePlonkitRewrittenHtml(countryCode, country, state);
    iframe.srcdoc = html;
}

function togglePlonkitPanel() {
    plonkitActive = !plonkitActive;
    try { localStorage.setItem("plonkitActive", JSON.stringify(plonkitActive)); } catch (_) {}
    if (plonkitActive && typeof triggerCluesFetch === "function") {
        triggerCluesFetch();
    }
    updatePlonkitUI();
}

window.addEventListener("message", (e) => {
    if (e && e.data && e.data.type === "ADGUARDS_CLOSE_IFRAME") {
        plonkitActive = false;
        try { localStorage.setItem("plonkitActive", "false"); } catch (_) {}
        updatePlonkitUI();
    }
});




        // =================== Keyboard Listener (Shortcut G & H) ===================
    document.addEventListener("keydown", (e) => {
        try {
            const activeTag = document.activeElement ? document.activeElement.tagName : "";
            if (activeTag === "INPUT" || activeTag === "TEXTAREA" || document.activeElement?.isContentEditable) {
                return;
            }
            const key = e.key ? e.key.toLowerCase() : "";
            if (key === "h") {
                togglePlonkitPanel();
            } else if (key === "g") {
                dotAdded = true;
                syncTermsText();
            } else if (key !== " " && !isRightMouseDown) {
                dotAdded = false;
                syncTermsText();
                clearMarker();
            }
        } catch (_) {}
    });

// =================== Party Modal Auto-Dismiss ===================
function dismissPartyModalIfNeeded() {
    try {
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
    } catch (_) {}
}

// =================== Background Interval (Bulletproof) ===================
setInterval(() => {
    try {
        hookGoogleMapConstructor();
        hookGoogleMapPrototype();
        hookStreetViewPanorama();
        checkPanoramaFailure();
        if (!isMapValid(foundMap)) {
            requestScanForMap(100);
        }
        syncTermsText();
        dismissPartyModalIfNeeded();
    } catch (_) {}
}, 1000);
