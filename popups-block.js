// =================== Global Variables ===================
let globalCoordinates = JSON.parse(localStorage.getItem("globalCoordinates")) || { lat: 0, lng: 0 };
let globalPlace = JSON.parse(localStorage.getItem("globalPlace")) || { country: "", state: "", countryCode: "" };
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
function showMarkerAt(lat, lng) {
    try {
        if (!isMapValid(foundMap) || !lat || !lng) return;

        clearMarker();
        if (!isRightMouseDown) return;

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

// =================== Plonkit Clue Assistant (Iframe Rewritten HTML + Geomastr Visuals) ===================
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
    if (code && codeMap[code]) {
        return codeMap[code];
    }
    return (countryName || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}


    const GEOMASTR_DATA = {"albania":{"c":"Europe","dr":"Right","l":"Albanian","cr":"Albanian Lek - Lek","dm":".al","ph":"+355","ab":"albanian.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["Rruga","Sheshi","Bulevardi"],"bc":1,"pc":2,"po":1,"fs":["Kastrati.png","Alpet.png","Elda.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"american-samoa":{"c":"Oceania","dr":"Right","cr":"United States Dollar - $","dm":".as","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Road","Avenue","Drive"],"bc":1,"pc":2,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"andorra":{"c":"Europe","dr":"Right","l":"Catalan","cr":"Euro - €","dm":".ad","ph":"+376","ab":"latin.png","rl":"White Outside - White Inside","sx":["Carrer","Avinguda","Plaça","Passatge","Ronda","Camí"],"bc":2,"pc":3,"po":2,"fs":["Total.png","Esso.png","Repsol.png","Cepsa.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"argentina":{"c":"South America","dr":"Right","l":"Spanish","cr":"Argentine Peso - $","dm":".ar","ph":"+54","ab":"latin.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["Calle","Avenida","Pasaje","Camino","Boulevard","Paseo","Senda","Corredor","Rambla"],"bc":1,"pc":2,"po":1,"fs":["Puma.png","Esso.png","YPF.png","AxionEnergy.png","Refinor.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"australia":{"c":"Oceania","dr":"Left","l":"English","cr":"Australian Dollar - AU$","dm":".au","ph":"+61","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside / Yellow Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Parade","Boulevard","Circuit","Terrace"],"bc":6,"pc":6,"po":1,"fs":["Puma.png","Caltex.png","ColesExpress.png","WoolworthsPetrol.png","UnitedPetroleum.png","LibertyOil.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"austria":{"c":"Europe","dr":"Right","l":"German","cr":"Euro - €","dm":".at","ph":"+43","ab":"latin.png","rl":"White Outside - White Inside","sx":["Straße","Gasse","Platz","Allee","Ring","Weg","Hauptplatz","Promenade"],"bc":6,"pc":2,"po":1,"fs":["Esso.png","OMV.png","Jet.png","Eni.png","Avia.png","Agip.png","Hofer.png","AS24.png","Socar.png","Genol.png","Diskont.png","Avanti.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"bangladesh":{"c":"Asia","dr":"Left","l":"Bengali","cr":"Bangladeshi Taka - ৳","dm":".bd","ph":"+880","ab":"bengali.png","rl":"White Outside - White Inside","sx":["Road","Lane","Avenue","Bazar","Sarani","Para","Rasta","Block","Mahalla"],"bc":1,"pc":3,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"belgium":{"c":"Europe","dr":"Right","cr":"Euro - €","dm":".be","ph":"+32","ab":"latin.png","rl":"White Outside - White Inside","sx":["Straat","Laan","Weg","Plein","Dreef","Steeg","Hof","Kaai","Park"],"bc":3,"pc":2,"po":1,"fs":["Total.png","Esso.png","Lukoil.png","Texaco.png","Q8.png","Avia.png","AS24.png","BP.png","Power.png","Gabriels.png","MAES.png","OCTA+.png","Dats24.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"bermuda":{"c":"North America","dr":"Left","l":"English","cr":"Bermudian dollar (BMD) - $","dm":".bm","ab":"latin.png","rl":"White Outside - White Inside","sx":["Lane","Avenue","Road","Circle","Court"],"bc":1,"pc":2,"po":1,"fs":["Esso.png","Rubis.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"bhutan":{"c":"Asia","dr":"Left","l":"Dzongkha","cr":"Bhutanese Ngultrum - Nu.","dm":".bt","ph":"+975","ab":"tibetan.png","rl":"White Outside - White Inside","sx":["Theg","Zam","Street","Chhewog","Toe","Row","Village","Lane","Bridge"],"bc":1,"pc":2,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"bolivia":{"c":"South America","dr":"Right","cr":"Boliviano - Bs.","dm":".bo","ph":"+591","ab":"latin.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["Calle","Avenida","Pasaje","Camino","Paseo","Carretera","Plaza","Jirón","Cuesta"],"bc":1,"pc":3,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"botswana":{"c":"Africa","dr":"Left","cr":"Botswana Pula - P","dm":".bw","ph":"+267","ab":"latin.png","rl":"Yellow Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Crescent","Close","Drive","Court","Circle"],"bc":2,"pc":4,"po":1,"fs":["Total.png","Puma.png","Caltex.png","Engen.png","Galp.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"brazil":{"c":"South America","dr":"Right","l":"Portuguese","cr":"Brazilian Real - R$","dm":".br","ph":"+55","ab":"latin.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["Rua","Avenida","Estrada","Travessa","Alameda","Rodovia","Quadra","Praça","Largo","Passarela"],"bc":2,"pc":2,"po":1,"fs":["Esso.png","Ipiranga.png","Ale.png","BRDistribuidora.png","Raizen.png","Ultragaz.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"bulgaria":{"c":"Europe","dr":"Right","l":"Bulgarian","cr":"Bulgarian lev - лв","dm":".bg","ph":"+359","ab":"bulgarian.png","rl":"White Outside - White Inside","sx":["улица","площад","булевард","квартал","парк","тракт","път","мост","алея","бул"],"bc":1,"pc":2,"po":1,"fs":["Lukoil.png","OMV.png","EKO.png","Avia.png","Rompetrol.png","NIS.png","Astra.png","InsaOil.png","NaftexPetrol.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"cambodia":{"c":"Asia","dr":"Right","l":"Khmer","cr":"Cambodian Riel - ៛","dm":".kh","ph":"+855","ab":"khmer.png","rl":"White Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Sangkat","Phum","Thnou","Sang"],"bc":2,"pc":3,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"canada":{"c":"North America","dr":"Right","cr":"Canadian Dollar - C$","dm":".ca","ph":"+1","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":5,"pc":11,"po":1,"fs":["Esso.png","Irving.png","Petro-Canada.png","HuskyEnergy.png","Sunoco.png","Ultramar.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"chile":{"c":"South America","dr":"Right","l":"Spanish","cr":"Chilean Peso - $","dm":".cl","ph":"+56","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside / White Outside - Yellow Inside / Yellow Outside - Yellow Inside","sx":["Calle","Avenida","Pasaje","Camino","Boulevard","Paseo","Senda","Corredor","Rambla"],"bc":2,"pc":3,"po":1,"fs":["Terpel.png","COPEC.png","Petrobras.png","ENEX.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"christmas-island":{"c":"Asia","dr":"Left","l":"English","cr":"Australian Dollar - $","dm":".cx","ph":"+61","ab":"latin.png","rl":"White Outside - White Inside","sx":["Road","Avenue","Drive","Way","Circuit","Terrace","Boulevard","Close","Parade","Lane"],"bc":1,"pc":3,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"colombia":{"c":"South America","dr":"Right","l":"Spanish","cr":"Colombian Peso - $","dm":".co","ph":"+57","ab":"latin.png","rl":"White Outside - Yellow Inside / Yellow Outside - White Inside","sx":["Calle","Avenida","Carrera","Transversal","Diagonal","Peatonal","Vía","Autopista","Circunvalar","Cruce"],"bc":1,"pc":3,"po":1,"fs":["Puma.png","Esso.png","Texaco.png","Petrobras.png","Terpel.png","EcoPetrol.png","Biomax.png","BP.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"croatia":{"c":"Europe","dr":"Right","l":"Croatian","cr":"Kuna - kn","dm":".hr","ph":"+385","ab":"croatian.png","rl":"White Outside - White Inside / Red Outside - White Inside","sx":["Ulica","Trg","Avenija","Put","Cesta","Naselje","Skalini","Riva","Traversa","Promenada"],"bc":1,"pc":2,"po":1,"fs":["Lukoil.png","OMV.png","INA.png","Firezone.png","Argos.png","Tifon.png","Crodux.png","Petrol.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"curacao":{"c":"North America","dr":"Right","cr":"Netherlands Antillean Guilder - ƒ","dm":".cw","ph":"+599","ab":"latin.png","rl":"White Outside - White Inside","sx":["Straat","Weg","Weggetje","Boulevard","Laan","Plein","Dreef","Kade","Steeg"],"bc":1,"pc":4,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"czech-republic":{"c":"Europe","dr":"Right","l":"Czech","cr":"Czech koruna - Kč","dm":".cz","ph":"+420","ab":"czech.png","rl":"White Outside - White Inside","sx":["Ulice","Náměstí","Třída","Sady","Alej","Nábřeží","Park","Rybník","Cesta","Most"],"bc":1,"pc":4,"po":1,"fs":["Texaco.png","OMV.png","MOL.png","Avia.png","Agip.png","Tesco.png","Benzina.png","Elda.png","PapOil.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"denmark":{"c":"Europe","dr":"Right","l":"Danish","cr":"Danish krone - kr","dm":".dk","ph":"+45","ab":"dano-norwegian.png","rl":"White Outside - White Inside","sx":["Vej","Gade","Plads","Torv","Allé","Stien","Stræde","Mark","Bakke","Holme"],"bc":3,"pc":5,"po":2,"fs":["Q8.png","Ingo.png","Uno-X.png","OK.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"dominican-republic":{"c":"North America","dr":"Right","l":"Spanish","cr":"Dominican Peso - RD$","dm":".do","ph":"+809","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Calle","Avenida","Carretera","Callejón","Pasaje","Bulevar","Carretera","Cruce","Paraje","Sector"],"bc":1,"pc":2,"po":1,"fs":["Total.png","Esso.png","Texaco.png","Isla.png","Sunix.png","CoastalPetroleumDominicana.png","Propagas.png","Anadegas.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"ecuador":{"c":"South America","dr":"Right","l":"Spanish","cr":"United States Dollar - $","dm":".ec","ph":"+593","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Calle","Avenida","Pasaje","Camino","Boulevard","Paseo","Senda","Corredor","Rambla"],"bc":2,"pc":5,"po":1,"fs":["Puma.png","Terpel.png","Petroecuador.png","Petromas.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"estonia":{"c":"Europe","dr":"Right","l":"Estonian","cr":"Euro - €","dm":".ee","ph":"+372","ab":"estonian.png","rl":"White Outside - White Inside","sx":["Tänav","Tee","Puiestee","Tänav","Tänav","Maantee","Tänav","Puiestee","Tänav"],"bc":1,"pc":3,"po":1,"fs":["Neste.png","Alexela.png","Olerex.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"eswatini":{"c":"Africa","dr":"Left","cr":"Swazi Lilangeni -  L","dm":".sz","ph":"+268","ab":"latin.png","rl":"Yellow Outside - White Inside / Yellow Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Crescent","Drive","Court","Circle","Close"],"bc":1,"pc":4,"po":1,"fs":["Total.png","Puma.png","Caltex.png","Engen.png","Excel.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"faroe-islands":{"c":"Europe","dr":"Right","cr":"Faroese Krona - kr","dm":".fo","ph":"+298","ab":"latin.png","rl":"White Outside - White Inside","sx":["Gøta","Vegur","Stígur","Gøta","Vegur","Gøta","Vegur","Stígur","Gøta"],"bc":1,"pc":1,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"finland":{"c":"Europe","dr":"Right","l":"Finnish","cr":"Euro - €","dm":".fi","ph":"+358","ab":"finnish.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["Katu","Tie","Kuja","Rinne","Polku","Aukio","Tori","Piha","Silta","Rinne"],"bc":1,"pc":3,"po":2,"fs":["Neste.png","Teboil.png","Tango.png","ABC.png","Seo.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"france":{"c":"Europe","dr":"Right","l":"French","cr":"Euro - €","dm":".fr","ph":"+33","ab":"latin.png","rl":"White Outside - White Inside","sx":["Rue","Avenue","Boulevard","Impasse","Chemin","Place","Route","Cours","Quai","Passage"],"bc":2,"pc":5,"po":1,"fs":["Total.png","Esso.png","Q8.png","Eni.png","Avia.png","Tamoil.png","Rompetrol.png","Carrefour.png","AS24.png","E.Leclerc.png","Intermarche.png","SuperU.png","E.Leclerc.png","Auchan.png","Casino.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"germany":{"c":"Europe","dr":"Right","l":"German","cr":"Euro - €","dm":".de","ph":"+49","ab":"latin.png","rl":"White Outside - White Inside / Yellow Outside - Yellow Inside","sx":["Straße","Weg","Platz","Allee","Ring","Gasse","Promenade","Hauptstraße","Pfad","An der"],"bc":1,"pc":4,"po":1,"fs":["Total.png","Esso.png","OMV.png","Aral.png","Avia.png","Orlen.png","Agip.png","Elan.png","Jet.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"ghana":{"c":"Africa","dr":"Right","l":"English","cr":"Ghanaian cedi - GH₵","dm":".gh","ph":"+233","ab":"latin.png","rl":"White Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Crescent","Drive","Court","Circle","Close"],"bc":1,"pc":3,"po":1,"fs":["Total.png","Puma.png","Engen.png","Goil.png","StarOil.png","Total.png","AlliedOil.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"gibraltar":{"c":"Europe","dr":"Right","l":"English","cr":"Gibraltar Pound - £","dm":".gi","ph":"+350","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Crescent","Drive","Court","Circle","Close"],"bc":1,"pc":4,"po":1,"fs":["Cepsa.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"greece":{"c":"Europe","dr":"Right","l":"Greek","cr":"Euro - €","dm":".gr","ph":"+30","ab":"greek.png","rl":"White Outside - White Inside","sx":["οδός","πλατεία","αγορά","αλλού","περιφέρειας","λεωφόρος","δρόμος","κάμπος","γέφυρα","βρύση"],"bc":1,"pc":1,"po":1,"fs":["EKO.png","Revoil.png","Elin.png","AegeanOil.png","SilkOil.png","Avin.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"greenland":{"c":"North America","dr":"Right","cr":"Danish krone - kr","dm":".gl","ph":"+299","ab":"latin.png","rl":"White Outside - White Inside","sx":["Vej","Gade","Plads","Torv","Allé","Sti","Grønland","Havn","Bakke"],"bc":1,"pc":2,"po":2,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"guam":{"c":"Oceania","dr":"Right","cr":"United States Dollar - $","dm":".gu","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Drive","Court","Circle","Close"],"bc":1,"pc":2,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"guatemala":{"c":"North America","dr":"Right","l":"Spanish","cr":"Guatemalan quetzal - Q","dm":".gt","ph":"+502","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Calle","Avenida","Pasaje","Camino","Boulevard","Paseo","Senda","Corredor","Rambla"],"bc":1,"pc":4,"po":1,"fs":["Texaco.png","Puma.png","Uno.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"hungary":{"c":"Europe","dr":"Right","l":"Hungarian","cr":"Forint - Ft","dm":".hu","ph":"+36","ab":"hungarian.png","rl":"White Outside - White Inside","sx":["Utca","Tér","út","Körút","Sétány","Köz","Park","Híd","Tér"],"bc":2,"pc":3,"po":1,"fs":["Lukoil.png","OMV.png","MOL.png","Avia.png","AS24.png","Auchan.png","MOL.png","Agip.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"iceland":{"c":"Europe","dr":"Right","l":"Icelandic","cr":"Icelandic krÃ³na - kr","dm":".is","ph":"+354","ab":"icelandic.png","rl":"White Outside - White Inside","sx":["Gata","Braut","Vegur","Stígur","ás","Vík","Bakki","Höfði","Gata"],"bc":1,"pc":3,"po":1,"fs":["N1.png","Orkan.png","AO.png","Skeljungur.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"india":{"c":"Asia","dr":"Left","cr":"Indian Rupee - ₹","dm":".in","ph":"+91","ab":"devanagari.png","rl":"Yellow Outside - White Inside / White Outside - White Inside / Yellow Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":3,"pc":5,"po":1,"fs":["IndianOil.png","BharatPetroleum.png","HindustanPetroleum.png","ReliancePetroleum.png","EssarOil.png","Nayara.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"indonesia":{"c":"Asia","dr":"Left","l":"Indonesian","cr":"Indonesian Rupiah - Rp","dm":".id","ph":"+62","ab":"latin.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["Jalan","Gang","Lorong","Perumahan","Desa","Kecamatan","Kampung","Pemukiman","Paseban","Gang"],"bc":2,"pc":3,"po":1,"fs":["Caltex.png","Pertamina.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"ireland":{"c":"Europe","dr":"Left","cr":"Euro - €","dm":".ie","ph":"+353","ab":"latin.png","rl":"Yellow Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":4,"po":1,"fs":["Esso.png","Texaco.png","Tesco.png","Maxol.png","Applegreen.png","EmoOil.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"isle-of-man":{"c":"Europe","dr":"Left","cr":"British Pound - £","dm":".im","ph":"+44","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":1,"po":1,"fs":["Total.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"israel":{"c":"Asia","dr":"Right","cr":"Israeli new shekel - ₪","dm":".il","ph":"+972","ab":"hebrew.png","rl":"Yellow Outside - White Inside","sx":["רחוב","כיכר","בית","מסלול","סמטה","גינה","מעבר","שדרות"],"bc":1,"pc":3,"po":1,"fs":["PazOilCompany.png","Delek.png","Sonol.png","DorAlon.png","TenPetroleum.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"italy":{"c":"Europe","dr":"Right","l":"Italian","cr":"Euro - €","dm":".it","ph":"+39","ab":"latin.png","rl":"White Outside - White Inside","sx":["Via","Piazza","Strada","Viale","Corso","Vicolo","Piazzale","Lungomare","Salita","Traversa"],"bc":2,"pc":4,"po":1,"fs":["Esso.png","Q8.png","Eni.png","Repsol.png","Avia.png","Tamoil.png","Agip.png","IP.png","AS24.png","Auchan.png","Agip.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"japan":{"c":"Asia","dr":"Left","l":"Japanese","cr":"Yen -  ¥","dm":".jp","ph":"+81","ab":"japanese.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["通り","道","町","番地","丁目","ヶ町","ヶ丁目","地割","公園","橋"],"bc":3,"pc":4,"po":1,"fs":["ENEOS.png","Idemitsu.png","CosmoOil.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"jersey":{"c":"Europe","dr":"Left","cr":"British Pound - £","dm":".je","ph":"+44","ab":"latin.png","rl":"Yellow Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":1,"po":1,"fs":["Total.png","Esso.png","Rubis.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"jordan":{"c":"Asia","dr":"Right","l":"Arabic","cr":"Jordanian Dinar - د.ا","dm":".jo","ph":"+962","ab":"arabic.png","rl":"Yellow Outside - White Inside","sx":["شارع","ميدان","ساحة","طريق","جادة","زقاق","حارة","جسر","دوار","ساحة"],"bc":1,"pc":3,"po":1,"fs":["Total.png","ManaseerOilGas.png","Total.png","JoPetro.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"kenya":{"c":"Africa","dr":"Left","cr":"Kenyan Shilling - KSh","dm":".ke","ph":"+254","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Road","Lane","Avenue","Street","Way","Boulevard","Drive","Court","Circle","Close"],"bc":2,"pc":3,"po":1,"fs":["Total.png","OiLibya.png","VivoEnergy.png","KenolKobil.png","NationalOilCorporationofKenya.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"kyrgyzstan":{"c":"Asia","dr":"Right","cr":"Kyrgyzstani som - COM","dm":".kg","ph":"+996","ab":"cyrillic.png","rl":"White Outside - White Inside","sx":["улица","площадь","проспект","переулок","квартал","аллея","мост","тракт","бульвар"],"bc":1,"pc":4,"po":1,"fs":["EcoPetrol.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"laos":{"c":"Asia","dr":"Right","l":"Lao","cr":"Lao Kip - ₭","dm":".la","ph":"+856","ab":"lao.png","rl":"White Outside - White Inside","sx":["ຖະຫນົນ","ຖະຫນົນ","ຖະຫນົນ","ຖະຫນົນ","ຖະຫນົນ","ຖະຫນົນ","ຖະຫນົນ","ຖະຫນົນ","ຖະຫນົນ"],"bc":1,"pc":1,"po":1,"fs":["PTT.png","LaoStateFuelCompany.png","PTT.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"latvia":{"c":"Europe","dr":"Right","l":"Latvian","cr":"Euro - €","dm":".lv","ph":"+371","ab":"latin.png","rl":"White Outside - White Inside","sx":["Iela","Laukums","Bulvāris","Gatve","Ceļš","Aleja","Promenāde","Tilts","Skvērs","Pļavas"],"bc":1,"pc":4,"po":1,"fs":["Lukoil.png","Neste.png","Dinaz.png","AstarteNafta.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"lesotho":{"c":"Africa","dr":"Left","cr":"Lesotho Loti (LSL), South African Rand (ZAR) - L, R","dm":".ls","ph":"+266","ab":"latin.png","rl":"Yellow Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Crescent","Drive","Court","Circle","Close"],"bc":1,"pc":3,"po":1,"fs":["Total.png","Engen.png","Excel.png","Total.png","Engen.png","Shell.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"lithuania":{"c":"Europe","dr":"Right","l":"Lithuanian","cr":"Euro - €","dm":".lt","ph":"+370","ab":"lithuanian.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["Gatvė","Aikštė","Skveras","Kelias","Alėja","Parkas","Takas","Tiltas","Miestelis","Namų"],"bc":1,"pc":2,"po":1,"fs":["Lukoil.png","Orlen.png","Neste.png","Viada.png","BalticPetroleum.png","Dujos.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"luxembourg":{"c":"Europe","dr":"Right","cr":"Euro - €","dm":".lu","ph":"+352","ab":"latin.png","rl":"White Outside - White Inside","sx":["Rue","Avenue","Boulevard","Place","Rond","point","Impasse","Allée","Chemin","Route","Quai"],"bc":2,"pc":4,"po":1,"fs":["Total.png","Esso.png","Texaco.png","Q8.png","Aral.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"madagascar":{"c":"Africa","dr":"Right","cr":"Malagasy ariary - Ar","dm":".mg","ph":"+261","ab":"latin.png","rl":"White Outside - White Inside","sx":["Rue","Avenue","Boulevard","Route","Impasse","Place","Voie","Carrefour","Quartier","Passage"],"bc":1,"pc":3,"po":1,"fs":["Total.png","BunkerOil.png","BestStasjon.png","Galana.png","Jovena.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"malaysia":{"c":"Asia","dr":"Left","l":"Malay","cr":"Malaysian ringgit - RM","dm":".my","ph":"+60","ab":"latin.png","rl":"White Outside - White Inside","sx":["Jalan","Lorong","Persiaran","Lebuh","Persimpangan","Taman","Kampung","Pekan","Jalan","Jalan"],"bc":4,"pc":4,"po":1,"fs":["Caltex.png","Petron.png","Neste.png","Petronas.png","BHPetrol.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"malta":{"c":"Europe","dr":"Left","cr":"Euro - €","dm":".mt","ph":"+356","ab":"latin.png","rl":"White Outside - White Inside","sx":["Triq","Square","Road","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":4,"po":1,"fs":["Enemed.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"mexico":{"c":"North America","dr":"Right","l":"Spanish","cr":"Mexican Peso - $","dm":".mx","ph":"+52","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside / White Outside - Yellow Inside","sx":["Calle","Avenida","Callejón","Camino","Boulevard","Paseo","Sendero","Corredor","Rambla"],"bc":1,"pc":20,"po":1,"fs":["Total.png","Arco.png","Pemex.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"monaco":{"c":"Europe","dr":"Right","l":"French","cr":"Euro  - €","dm":".mc","ph":"+377","ab":"latin.png","rl":"White Outside - White Inside","sx":["Rue","Avenue","Boulevard","Impasse","Place","Quai","Promenade","Voie","Escalier","Terrasse"],"bc":1,"pc":4,"po":1,"fs":["Avia.png","Agip.png","Esso.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"mongolia":{"c":"Asia","dr":"Right","l":"Mongolian","cr":"Mongolian tögrög - ₮","dm":".mn","ph":"+976","ab":"cyrillic.png","rl":"White Outside - White Inside","sx":["гудамж","төлөө","хөдөлгөөнт","гудамж","гудамж","мөргөлдөөн","дөрөв","суурилуулалт","шалгаруулалт","өргөн"],"bc":1,"pc":2,"po":1,"fs":["MagnaiTrade.png","Shunkhlai.png","Petrovis.png","SodMongolGroup.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"montenegro":{"c":"Europe","dr":"Right","l":"Montenegrin","cr":"Euro - €","dm":".me","ph":"+382","ab":"montenegrin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["Ulica","Trg","Bulevar","Put","Sokak","Ploča","Most","Aleja","Promenada","Ulaz"],"bc":1,"pc":4,"po":1,"fs":["Lukoil.png","EKO.png","Petrol.png","INA.png","Teboil.png","EuroPetrol.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"netherlands":{"c":"Europe","dr":"Right","l":"Dutch","cr":"Euro - €","dm":".nl","ph":"+31","ab":"latin.png","rl":"White Outside - White Inside","sx":["Straat","Weg","Laan","Plein","Gracht","Hof","Dijk","Steeg","Park","Allee"],"bc":3,"pc":4,"po":1,"fs":["Total.png","Esso.png","Lukoil.png","Texaco.png","Q8.png","Avia.png","Tamoil.png","Gulf.png","Tango.png","Firezone.png","Argos.png","Sakko.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"new-zealand":{"c":"Oceania","dr":"Left","l":"English","cr":"New Zealand Dollar - NZ$","dm":".nz","ph":"+64","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside / White Outside - Yellow Inside / Yellow Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":4,"po":2,"fs":["Caltex.png","ZEnergy.png","Caltex.png","Mobil.png","Gull.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"nigeria":{"c":"Africa","dr":"Right","l":"English","cr":"Nigerian Naira - ₦","dm":".ng","ph":"+234","ab":"latin.png","rl":"Yellow Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Crescent","Drive","Court","Circle","Close"],"bc":1,"pc":4,"po":1,"fs":["Total.png","ForteOil.png","Oando.png","Mobil.png","Conoil.png","MRSOilNigeria.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"north-macedonia":{"c":"Europe","dr":"Right","l":"Macedonian","cr":"Macedonian Denar - ден","dm":".mk","ph":"+389","ab":"cyrillic.png","rl":"White Outside - White Inside / Yellow Outside - Yellow Inside","sx":["улица","плоштад","булевар","пат","камен","мост","алеја","тракт","проход","плоштад"],"bc":4,"pc":4,"po":1,"fs":["Lukoil.png","Makpetrol.png","OKTA.png","Gazprom.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"northern-mariana-islands":{"c":"Oceania","dr":"Right","cr":"United States Dollar - $","dm":".mp","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Road","Avenue","Drive","Way","Boulevard","Circle","Court","Lane","Parkway","Plaza"],"bc":1,"pc":1,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"norway":{"c":"Europe","dr":"Right","l":"Norwegian","cr":"Norwegian Krone - kr","dm":".no","ph":"+47","ab":"dano-norwegian.png","rl":"White Outside - Yellow Inside","sx":["Gate","Vei","Plass","Allé","Veg","Stien","Torg","Gata","Bakken","Havn"],"bc":1,"pc":4,"po":1,"fs":["Esso.png","Uno-X.png","St1.png","YXEnergi.png","BunkerOil.png","BestStasjon.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"peru":{"c":"South America","dr":"Right","l":"Spanish","cr":"Sol - S/.","dm":".pe","ph":"+51","ab":"latin.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["Calle","Avenida","Pasaje","Camino","Boulevard","Paseo","Senda","Corredor","Rambla"],"bc":1,"pc":2,"po":1,"fs":["Repsol.png","Primax.png","Repsol.png","PetroPeru.png","Pecsa.png","GrifoMapco.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"philippines":{"c":"Asia","dr":"Right","cr":"Philippine Peso - ₱","dm":".ph","ph":"+63","ab":"latin.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":2,"pc":4,"po":1,"fs":["Caltex.png","PTT.png","EasternPetroleum.png","Unioil.png","Petron.png","PhoenixPetroleum.png","Seaoil.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"poland":{"c":"Europe","dr":"Right","l":"Polish","cr":"złoty - zł","dm":".pl","ph":"+48","ab":"polish.png","rl":"White Outside - White Inside","sx":["Ulica","Plac","Aleja","Skwer","Deptak","Rondo","Droga","Most","ścieżka","Pasaż"],"bc":2,"pc":4,"po":1,"fs":["Total.png","Lukoil.png","Aral.png","Avia.png","Orlen.png","AS24.png","Tesco.png","Auchan.png","GrupaLotos.png","BP.png","CircleK.png","Statoil.png","PKNOrlen.png","Lotos.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"portugal":{"c":"Europe","dr":"Right","l":"Portuguese","cr":"Euro - €","dm":".pt","ph":"+351","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["Rua","Avenida","Estrada","Travessa","Calçada","Beco","Largo","Praça","Rotunda","Passeio"],"bc":2,"pc":4,"po":1,"fs":["Repsol.png","Avia.png","Cepsa.png","Galp.png","Intermarche.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"puerto-rico":{"c":"North America","dr":"Right","cr":"United States Dollar - $","dm":".pr","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Calle","Avenida","Carretera","Boulevard","Carr","Paseo","Camino","Pasaje","Autopista"],"bc":1,"pc":1,"po":1,"fs":["Total.png","Puma.png","Puma.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"qatar":{"c":"Asia","dr":"Right","l":"Arabic","cr":"Qatari Riyal - ﷼","dm":".qa","ph":"+974","ab":"arabic.png","rl":"White Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":3,"po":1,"fs":["Woqod.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"romania":{"c":"Europe","dr":"Right","l":"Romanian","cr":"Romanian Leu - lei","dm":".ro","ph":"+40","ab":"romanian.png","rl":"White Outside - White Inside / Yellow Outside - Yellow Inside","sx":["Strada","Bulevard","Avenue","Piața","Calea","Aleea","Bulevardul","Strada","Pasaj","șoseaua"],"bc":1,"pc":4,"po":1,"fs":["Lukoil.png","OMV.png","MOL.png","Gazprom.png","Petrom.png","Rompetrol.png","Socar.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"russia":{"c":"Asia","dr":"Right","l":"Russian","cr":"Russian Ruble - ₽","dm":".ru","ph":"+7","ab":"russian.png","rl":"Yellow Outside - White Inside / White Outside - White Inside / White Outside - Yellow Inside","sx":["улица","площадь","проспект","переулок","аллея","бульвар","тракт","мост","переезд","шоссе"],"bc":2,"pc":4,"po":1,"fs":["Lukoil.png","Texaco.png","EcoPetrol.png","Gazprom.png","Rosneft.png","Tatneft.png","Surgutneftegas.png","Bashneft.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"rwanda":{"c":"Africa","dr":"Right","cr":"Rwandan Franc - FRw","dm":".rw","ph":"+250","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Ruko","Kimironko","Ibuye","Umujyi","Huye","Akarere","Umu","Cyerezo","Akagali","Mu"],"bc":1,"pc":4,"po":1,"fs":["Engen.png","SP.png","KenolKobil.png","HashiEnergy.png","MountMeru.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"san-marino":{"c":"Europe","dr":"Right","l":"Italian","cr":"Euro - €","dm":".sm","ph":"+378","ab":"latin.png","rl":"White Outside - White Inside","sx":["Via","Piazza","Strada","Viale","Corso","Vicolo","Passaggio","Salita","Piazzetta","Ramo"],"bc":1,"pc":1,"po":1,"fs":["Tamoil.png","Agip.png","IP.png","Eni.png","Q8.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"senegal":{"c":"Africa","dr":"Right","l":"French","cr":"West African CFA franc - CFA","dm":".sn","ph":"+221","ab":"latin.png","rl":"White Outside - White Inside","sx":["Rue","Avenue","Boulevard","Place","Voie","Impasse","Quartier","Pont","Carrefour","Passement"],"bc":3,"pc":2,"po":1,"fs":["Total.png","Puma.png","OiLibya.png","Elton.png","Petrosen.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"serbia":{"c":"Europe","dr":"Right","l":"Serbian","cr":"Serbian dinar - RSD","dm":".rs","ph":"+381","ab":"serbian.png","rl":"White Outside - White Inside","sx":["Ulica","Trg","Bulevar","Put","Sokak","Ploča","Most","Aleja","Promenada","Ulaz"],"bc":2,"pc":3,"po":1,"fs":["Lukoil.png","OMV.png","EKO.png","MOL.png","Avia.png","Gazprom.png","Petrol.png","NIS.png","EKO.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"singapore":{"c":"Asia","dr":"Left","cr":"Singapore Dollar - S$","dm":".sg","ph":"+65","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["Road","Avenue","Lane","Street","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":3,"po":1,"fs":["Esso.png","Neste.png","OMV.png","SingaporePetroleumCompany.png","Caltex.png","SPC.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"slovakia":{"c":"Europe","dr":"Right","l":"Slovak","cr":"Euro - €","dm":".sk","ph":"+421","ab":"slovak.png","rl":"White Outside - White Inside","sx":["Ulica","Námestie","Cesta","Alej","Most","Park","Dvor","Rampa","Obchodná"],"bc":1,"pc":4,"po":1,"fs":["OMV.png","Orlen.png","Benzina.png","Tesco.png","Lotos.png","Slovnaft.png","Avia.png","Lukoil.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"slovenia":{"c":"Europe","dr":"Right","l":"Slovene","cr":"Euro - €","dm":".si","ph":"+386","ab":"slovene.png","rl":"White Outside - White Inside","sx":["Ulica","Trg","Avenija","Cesta","Pot","Promenada","Most","Galerija","Nabrežje","Ploščad"],"bc":2,"pc":4,"po":1,"fs":["Q8.png","Agip.png","Petrol.png","Hofer.png","AS24.png","Tifon.png","MOL.png","OMV.png","Crodux.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"south-africa":{"c":"Africa","dr":"Left","cr":"South African Rand - R","dm":".za","ph":"+27","ab":"latin.png","rl":"Yellow Outside - White Inside / Red Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":9,"po":1,"fs":["Total.png","Puma.png","Caltex.png","BP.png","Chevron.png","Sasol.png","Engen.png","BP.png","Shell.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"south-korea":{"c":"Asia","dr":"Right","l":"Korean","cr":"South Korean won - ₩","dm":".kr","ph":"+82","ab":"hangul.png","rl":"White Outside - Yellow Inside","sx":["로","길","거리","로","길","거리","산길","길","길","로"],"bc":1,"pc":3,"po":1,"fs":["SKEnergy.png","GSCaltex.png","HyundaiOilbank.png","S-Oil.png","E1.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"spain":{"c":"Europe","dr":"Right","l":"Spanish","cr":"Euro - €","dm":".es","ph":"+34","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["Calle","Avenida","Plaza","Paseo","Carretera","Camino","Boulevard","Ronda","Pueblo","Rambla"],"bc":2,"pc":4,"po":1,"fs":["Avia.png","Tamoil.png","Carrefour.png","AS24.png","E.Leclerc.png","BP.png","Galp.png","Repsol.png","Cepsa.png","Disa.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"sri-lanka":{"c":"Asia","dr":"Left","cr":"Sri Lankan Rupee - Rs, රු","dm":".lk","ph":"+94","ab":"sinhala.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["පාර","පාර","පාර","පාර","පාර","පාර","පාර","පාර","පාර"],"bc":2,"pc":1,"po":1,"fs":["Caltex.png","CeylonPetroleumCorporation.png","LankaIOC.png","Laugfs.png","LitroGasLanka.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"sweden":{"c":"Europe","dr":"Right","l":"Swedish","cr":"Swedish Krona - kr","dm":".se","ph":"+46","ab":"swedish.png","rl":"White Outside - White Inside","sx":["Gatan","Vägen","Platsen","Gränden","Allén","Stråket","Vägen","Torg","Backen"],"bc":5,"pc":4,"po":1,"fs":["Total.png","Ingo.png","Q8.png","CircleK.png","Preem.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"switzerland":{"c":"Europe","dr":"Right","cr":"Swiss franc - CHF","dm":".ch","ph":"+41","ab":"latin.png","rl":"White Outside - White Inside","sx":["Strasse","Weg","Platz","Allee","Ring","Gasse","Promenade","Hauptstrasse","Pfad"],"bc":2,"pc":4,"po":1,"fs":["Esso.png","Eni.png","Agip.png","Socar.png","Avia.png","Tamoil.png","Migrol.png","Agrola.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"taiwan":{"c":"Asia","dr":"Right","l":"Mandarin Chinese","cr":"New Taiwan Dollar - NT$","dm":".tw","ph":"+886","ab":"chinese.png","rl":"White Outside - Yellow Inside","bc":1,"pc":3,"po":1,"fs":["CPCCorporation.png","FormosaPetrochemicalCorp.png","TaiwanSugarCorporation.png","Uni-President.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"thailand":{"c":"Asia","dr":"Left","l":"Thai","cr":"Thai Baht - ฿","dm":".th","ph":"+66","ab":"thai.png","rl":"White Outside - Yellow Inside","sx":["ถนน","ซอย","ตรอก","แยก","แม่น้ำ","ป่า","สะพาน","ทาง","พื้นที่","เขต"],"bc":1,"pc":4,"po":1,"fs":["Caltex.png","PTT.png","Esso.png","Bangchak.png","PTGEnergy.png","Susco.png","Jiffy.png","Pure.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"tunisia":{"c":"Africa","dr":"Right","l":"Arabic","cr":"Tunisian dinar - DT","dm":".tn","ph":"+216","ab":"arabic.png","rl":"White Outside - White Inside","sx":["Rue","Avenue","Boulevard","Place","Voie","Impasse","Quartier","Pont","Carrefour","Passage"],"bc":1,"pc":2,"po":1,"fs":["Total.png","OiLibya.png","Staroil.png","Agil.png","VivoEnergy.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"turkey":{"c":"Europe","dr":"Right","l":"Turkish","cr":"Turkish Lira - ₺","dm":".tr","ph":"+90","ab":"turkish.png","rl":"White Outside - White Inside / White Outside - Yellow Inside / Yellow Outside - Yellow Inside","sx":["Sokak","Cadde","Bulvar","Mahallesi","Caddesi","Sokağı","Köyü","Mevkii","Kavşak","çıkmaz"],"bc":2,"pc":4,"po":1,"fs":["Lukoil.png","Total.png","Opet.png","PetrolOfisi.png","BP.png","MOil.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"uganda":{"c":"Africa","dr":"Left","cr":"Ugandan shilling - USh","dm":".ug","ph":"+256","ab":"latin.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","bc":1,"pc":3,"po":1,"fs":["Total.png","OiLibya.png","Total.png","VivoEnergy.png","OryxEnergies.png","HassPetroleum.png","Petrocity.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"ukraine":{"c":"Europe","dr":"Right","l":"Ukrainian","cr":"Ukrainian Hryvnia - ₴","dm":".ua","ph":"+380","ab":"ukrainian.png","rl":"White Outside - White Inside","sx":["вулиця","площа","проспект","провулок","алея","бульвар","тракт","міст","перехрестя","шосе"],"bc":2,"pc":4,"po":1,"fs":["OKKO.png","WOG.png","Socar.png","KLO.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"united-arab-emirates":{"c":"Asia","dr":"Right","l":"Arabic","cr":"UAE dirham - د.إ","dm":".ae","ph":"+971","ab":"arabic.png","rl":"Yellow Outside - White Inside / Yellow Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":4,"po":1,"fs":["ADNOC.png","ENOC.png","EPPCO.png","Emarat.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"united-kingdom":{"c":"Europe","dr":"Left","l":"English","cr":"Pound Sterling - £","dm":".uk","ph":"+44","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":3,"pc":1,"po":1,"fs":["Esso.png","Texaco.png","Jet.png","Tesco.png","Morrisons.png","AsdaPetrolStations.png","SainsburysPetrolStations.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"united-states":{"c":"North America","dr":"Right","l":"English","cr":"US Dollar - $","dm":".us","ph":"+1","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":6,"pc":53,"po":1,"fs":["BP.png","Lukoil.png","CircleK.png","Gulf.png","Mobil.png","Costco.png","7-Eleven.png","Irving.png","Pemex.png","Wawa.png","Meijer.png","H-E-B.png","CaseysGeneralStores.png","Kroger.png","Albertsons.png","GiantEagle.png","Safeway.png","Target.png","Walmart.png","BJsWholesaleClub.png","SamsClub.png","MurphyUSA.png","QuikTrip.png","RaceTrac.png","Sheetz.png","HolidayStationstores.png","Maverik.png","KwikTrip.png","CumberlandFarms.png","LovesTravelStops.png","PilotFlyingJ.png","TravelCentersofAmerica.png","Exxon.png","Sunoco.png","Phillips66.png","Valero.png","MarathonPetroleum.png","Tesoro.png","Sinclair.png","Conoco.png","Hy-Vee.png","Mobil.png","RaceTrac.png","Shell.png","ExxonMobil.png","Texaco.png","Chevron.png","Arco.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"uruguay":{"c":"South America","dr":"Right","l":"Spanish","cr":"Uruguayan peso - $U","dm":".uy","ph":"+598","ab":"latin.png","sx":["Calle","Avenida","Pasaje","Camino","Boulevard","Paseo","Senda","Corredor","Rambla"],"bc":1,"pc":3,"po":1,"fs":["Petrobras.png","ANCAP.png","DUCSA.png","Petrobras.png","Esso.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"us-virgin-islands":{"c":"North America","dr":"Left","l":"English","cr":"United States Dollar - $","dm":".vi","ab":"latin.png","rl":"White Outside - Yellow Inside","bc":1,"pc":1,"po":1,"fs":["Total.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"vietnam":{"c":"Asia","dr":"Right","l":"Vietnamese","cr":"Vietnamese dong - ₫","dm":".vn","ph":"+84","ab":"vietnamese.png","sx":["đường","Phố","Hẻm","Ngõ","Quận","đường","Hẻm","Quận","Phường","Khu"],"bc":1,"pc":2,"po":1,"fs":["Petrolimex.png","PVOil.png","BinhSonRefiningandPetrochemicalJSC.png","VietNamNationalGasolineCompany.png","DongThapPetroleumTradingImportExportCompany.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]}};

    
    const GEOMASTR_DATA = {"albania":{"c":"Europe","dr":"Right","l":"Albanian","cr":"Albanian Lek - Lek","dm":".al","ph":"+355","ab":"albanian.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["Rruga","Sheshi","Bulevardi"],"bc":1,"pc":2,"po":1,"fs":["Kastrati.png","Alpet.png","Elda.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"american-samoa":{"c":"Oceania","dr":"Right","cr":"United States Dollar - $","dm":".as","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Road","Avenue","Drive"],"bc":1,"pc":2,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"andorra":{"c":"Europe","dr":"Right","l":"Catalan","cr":"Euro - €","dm":".ad","ph":"+376","ab":"latin.png","rl":"White Outside - White Inside","sx":["Carrer","Avinguda","Plaça","Passatge","Ronda","Camí"],"bc":2,"pc":3,"po":2,"fs":["Total.png","Esso.png","Repsol.png","Cepsa.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"argentina":{"c":"South America","dr":"Right","l":"Spanish","cr":"Argentine Peso - $","dm":".ar","ph":"+54","ab":"latin.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["Calle","Avenida","Pasaje","Camino","Boulevard","Paseo","Senda","Corredor","Rambla"],"bc":1,"pc":2,"po":1,"fs":["Puma.png","Esso.png","YPF.png","AxionEnergy.png","Refinor.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"australia":{"c":"Oceania","dr":"Left","l":"English","cr":"Australian Dollar - AU$","dm":".au","ph":"+61","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside / Yellow Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Parade","Boulevard","Circuit","Terrace"],"bc":6,"pc":6,"po":1,"fs":["Puma.png","Caltex.png","ColesExpress.png","WoolworthsPetrol.png","UnitedPetroleum.png","LibertyOil.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"austria":{"c":"Europe","dr":"Right","l":"German","cr":"Euro - €","dm":".at","ph":"+43","ab":"latin.png","rl":"White Outside - White Inside","sx":["Straße","Gasse","Platz","Allee","Ring","Weg","Hauptplatz","Promenade"],"bc":6,"pc":2,"po":1,"fs":["Esso.png","OMV.png","Jet.png","Eni.png","Avia.png","Agip.png","Hofer.png","AS24.png","Socar.png","Genol.png","Diskont.png","Avanti.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"bangladesh":{"c":"Asia","dr":"Left","l":"Bengali","cr":"Bangladeshi Taka - ৳","dm":".bd","ph":"+880","ab":"bengali.png","rl":"White Outside - White Inside","sx":["Road","Lane","Avenue","Bazar","Sarani","Para","Rasta","Block","Mahalla"],"bc":1,"pc":3,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"belgium":{"c":"Europe","dr":"Right","cr":"Euro - €","dm":".be","ph":"+32","ab":"latin.png","rl":"White Outside - White Inside","sx":["Straat","Laan","Weg","Plein","Dreef","Steeg","Hof","Kaai","Park"],"bc":3,"pc":2,"po":1,"fs":["Total.png","Esso.png","Lukoil.png","Texaco.png","Q8.png","Avia.png","AS24.png","BP.png","Power.png","Gabriels.png","MAES.png","OCTA+.png","Dats24.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"bermuda":{"c":"North America","dr":"Left","l":"English","cr":"Bermudian dollar (BMD) - $","dm":".bm","ab":"latin.png","rl":"White Outside - White Inside","sx":["Lane","Avenue","Road","Circle","Court"],"bc":1,"pc":2,"po":1,"fs":["Esso.png","Rubis.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"bhutan":{"c":"Asia","dr":"Left","l":"Dzongkha","cr":"Bhutanese Ngultrum - Nu.","dm":".bt","ph":"+975","ab":"tibetan.png","rl":"White Outside - White Inside","sx":["Theg","Zam","Street","Chhewog","Toe","Row","Village","Lane","Bridge"],"bc":1,"pc":2,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"bolivia":{"c":"South America","dr":"Right","cr":"Boliviano - Bs.","dm":".bo","ph":"+591","ab":"latin.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["Calle","Avenida","Pasaje","Camino","Paseo","Carretera","Plaza","Jirón","Cuesta"],"bc":1,"pc":3,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"botswana":{"c":"Africa","dr":"Left","cr":"Botswana Pula - P","dm":".bw","ph":"+267","ab":"latin.png","rl":"Yellow Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Crescent","Close","Drive","Court","Circle"],"bc":2,"pc":4,"po":1,"fs":["Total.png","Puma.png","Caltex.png","Engen.png","Galp.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"brazil":{"c":"South America","dr":"Right","l":"Portuguese","cr":"Brazilian Real - R$","dm":".br","ph":"+55","ab":"latin.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["Rua","Avenida","Estrada","Travessa","Alameda","Rodovia","Quadra","Praça","Largo","Passarela"],"bc":2,"pc":2,"po":1,"fs":["Esso.png","Ipiranga.png","Ale.png","BRDistribuidora.png","Raizen.png","Ultragaz.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"bulgaria":{"c":"Europe","dr":"Right","l":"Bulgarian","cr":"Bulgarian lev - лв","dm":".bg","ph":"+359","ab":"bulgarian.png","rl":"White Outside - White Inside","sx":["улица","площад","булевард","квартал","парк","тракт","път","мост","алея","бул"],"bc":1,"pc":2,"po":1,"fs":["Lukoil.png","OMV.png","EKO.png","Avia.png","Rompetrol.png","NIS.png","Astra.png","InsaOil.png","NaftexPetrol.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"cambodia":{"c":"Asia","dr":"Right","l":"Khmer","cr":"Cambodian Riel - ៛","dm":".kh","ph":"+855","ab":"khmer.png","rl":"White Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Sangkat","Phum","Thnou","Sang"],"bc":2,"pc":3,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"canada":{"c":"North America","dr":"Right","cr":"Canadian Dollar - C$","dm":".ca","ph":"+1","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":5,"pc":11,"po":1,"fs":["Esso.png","Irving.png","Petro-Canada.png","HuskyEnergy.png","Sunoco.png","Ultramar.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"chile":{"c":"South America","dr":"Right","l":"Spanish","cr":"Chilean Peso - $","dm":".cl","ph":"+56","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside / White Outside - Yellow Inside / Yellow Outside - Yellow Inside","sx":["Calle","Avenida","Pasaje","Camino","Boulevard","Paseo","Senda","Corredor","Rambla"],"bc":2,"pc":3,"po":1,"fs":["Terpel.png","COPEC.png","Petrobras.png","ENEX.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"christmas-island":{"c":"Asia","dr":"Left","l":"English","cr":"Australian Dollar - $","dm":".cx","ph":"+61","ab":"latin.png","rl":"White Outside - White Inside","sx":["Road","Avenue","Drive","Way","Circuit","Terrace","Boulevard","Close","Parade","Lane"],"bc":1,"pc":3,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"colombia":{"c":"South America","dr":"Right","l":"Spanish","cr":"Colombian Peso - $","dm":".co","ph":"+57","ab":"latin.png","rl":"White Outside - Yellow Inside / Yellow Outside - White Inside","sx":["Calle","Avenida","Carrera","Transversal","Diagonal","Peatonal","Vía","Autopista","Circunvalar","Cruce"],"bc":1,"pc":3,"po":1,"fs":["Puma.png","Esso.png","Texaco.png","Petrobras.png","Terpel.png","EcoPetrol.png","Biomax.png","BP.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"croatia":{"c":"Europe","dr":"Right","l":"Croatian","cr":"Kuna - kn","dm":".hr","ph":"+385","ab":"croatian.png","rl":"White Outside - White Inside / Red Outside - White Inside","sx":["Ulica","Trg","Avenija","Put","Cesta","Naselje","Skalini","Riva","Traversa","Promenada"],"bc":1,"pc":2,"po":1,"fs":["Lukoil.png","OMV.png","INA.png","Firezone.png","Argos.png","Tifon.png","Crodux.png","Petrol.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"curacao":{"c":"North America","dr":"Right","cr":"Netherlands Antillean Guilder - ƒ","dm":".cw","ph":"+599","ab":"latin.png","rl":"White Outside - White Inside","sx":["Straat","Weg","Weggetje","Boulevard","Laan","Plein","Dreef","Kade","Steeg"],"bc":1,"pc":4,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"czech-republic":{"c":"Europe","dr":"Right","l":"Czech","cr":"Czech koruna - Kč","dm":".cz","ph":"+420","ab":"czech.png","rl":"White Outside - White Inside","sx":["Ulice","Náměstí","Třída","Sady","Alej","Nábřeží","Park","Rybník","Cesta","Most"],"bc":1,"pc":4,"po":1,"fs":["Texaco.png","OMV.png","MOL.png","Avia.png","Agip.png","Tesco.png","Benzina.png","Elda.png","PapOil.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"denmark":{"c":"Europe","dr":"Right","l":"Danish","cr":"Danish krone - kr","dm":".dk","ph":"+45","ab":"dano-norwegian.png","rl":"White Outside - White Inside","sx":["Vej","Gade","Plads","Torv","Allé","Stien","Stræde","Mark","Bakke","Holme"],"bc":3,"pc":5,"po":2,"fs":["Q8.png","Ingo.png","Uno-X.png","OK.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"dominican-republic":{"c":"North America","dr":"Right","l":"Spanish","cr":"Dominican Peso - RD$","dm":".do","ph":"+809","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Calle","Avenida","Carretera","Callejón","Pasaje","Bulevar","Carretera","Cruce","Paraje","Sector"],"bc":1,"pc":2,"po":1,"fs":["Total.png","Esso.png","Texaco.png","Isla.png","Sunix.png","CoastalPetroleumDominicana.png","Propagas.png","Anadegas.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"ecuador":{"c":"South America","dr":"Right","l":"Spanish","cr":"United States Dollar - $","dm":".ec","ph":"+593","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Calle","Avenida","Pasaje","Camino","Boulevard","Paseo","Senda","Corredor","Rambla"],"bc":2,"pc":5,"po":1,"fs":["Puma.png","Terpel.png","Petroecuador.png","Petromas.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"estonia":{"c":"Europe","dr":"Right","l":"Estonian","cr":"Euro - €","dm":".ee","ph":"+372","ab":"estonian.png","rl":"White Outside - White Inside","sx":["Tänav","Tee","Puiestee","Tänav","Tänav","Maantee","Tänav","Puiestee","Tänav"],"bc":1,"pc":3,"po":1,"fs":["Neste.png","Alexela.png","Olerex.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"eswatini":{"c":"Africa","dr":"Left","cr":"Swazi Lilangeni -  L","dm":".sz","ph":"+268","ab":"latin.png","rl":"Yellow Outside - White Inside / Yellow Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Crescent","Drive","Court","Circle","Close"],"bc":1,"pc":4,"po":1,"fs":["Total.png","Puma.png","Caltex.png","Engen.png","Excel.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"faroe-islands":{"c":"Europe","dr":"Right","cr":"Faroese Krona - kr","dm":".fo","ph":"+298","ab":"latin.png","rl":"White Outside - White Inside","sx":["Gøta","Vegur","Stígur","Gøta","Vegur","Gøta","Vegur","Stígur","Gøta"],"bc":1,"pc":1,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"finland":{"c":"Europe","dr":"Right","l":"Finnish","cr":"Euro - €","dm":".fi","ph":"+358","ab":"finnish.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["Katu","Tie","Kuja","Rinne","Polku","Aukio","Tori","Piha","Silta","Rinne"],"bc":1,"pc":3,"po":2,"fs":["Neste.png","Teboil.png","Tango.png","ABC.png","Seo.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"france":{"c":"Europe","dr":"Right","l":"French","cr":"Euro - €","dm":".fr","ph":"+33","ab":"latin.png","rl":"White Outside - White Inside","sx":["Rue","Avenue","Boulevard","Impasse","Chemin","Place","Route","Cours","Quai","Passage"],"bc":2,"pc":5,"po":1,"fs":["Total.png","Esso.png","Q8.png","Eni.png","Avia.png","Tamoil.png","Rompetrol.png","Carrefour.png","AS24.png","E.Leclerc.png","Intermarche.png","SuperU.png","E.Leclerc.png","Auchan.png","Casino.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"germany":{"c":"Europe","dr":"Right","l":"German","cr":"Euro - €","dm":".de","ph":"+49","ab":"latin.png","rl":"White Outside - White Inside / Yellow Outside - Yellow Inside","sx":["Straße","Weg","Platz","Allee","Ring","Gasse","Promenade","Hauptstraße","Pfad","An der"],"bc":1,"pc":4,"po":1,"fs":["Total.png","Esso.png","OMV.png","Aral.png","Avia.png","Orlen.png","Agip.png","Elan.png","Jet.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"ghana":{"c":"Africa","dr":"Right","l":"English","cr":"Ghanaian cedi - GH₵","dm":".gh","ph":"+233","ab":"latin.png","rl":"White Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Crescent","Drive","Court","Circle","Close"],"bc":1,"pc":3,"po":1,"fs":["Total.png","Puma.png","Engen.png","Goil.png","StarOil.png","Total.png","AlliedOil.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"gibraltar":{"c":"Europe","dr":"Right","l":"English","cr":"Gibraltar Pound - £","dm":".gi","ph":"+350","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Crescent","Drive","Court","Circle","Close"],"bc":1,"pc":4,"po":1,"fs":["Cepsa.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"greece":{"c":"Europe","dr":"Right","l":"Greek","cr":"Euro - €","dm":".gr","ph":"+30","ab":"greek.png","rl":"White Outside - White Inside","sx":["οδός","πλατεία","αγορά","αλλού","περιφέρειας","λεωφόρος","δρόμος","κάμπος","γέφυρα","βρύση"],"bc":1,"pc":1,"po":1,"fs":["EKO.png","Revoil.png","Elin.png","AegeanOil.png","SilkOil.png","Avin.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"greenland":{"c":"North America","dr":"Right","cr":"Danish krone - kr","dm":".gl","ph":"+299","ab":"latin.png","rl":"White Outside - White Inside","sx":["Vej","Gade","Plads","Torv","Allé","Sti","Grønland","Havn","Bakke"],"bc":1,"pc":2,"po":2,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"guam":{"c":"Oceania","dr":"Right","cr":"United States Dollar - $","dm":".gu","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Drive","Court","Circle","Close"],"bc":1,"pc":2,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"guatemala":{"c":"North America","dr":"Right","l":"Spanish","cr":"Guatemalan quetzal - Q","dm":".gt","ph":"+502","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Calle","Avenida","Pasaje","Camino","Boulevard","Paseo","Senda","Corredor","Rambla"],"bc":1,"pc":4,"po":1,"fs":["Texaco.png","Puma.png","Uno.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"hungary":{"c":"Europe","dr":"Right","l":"Hungarian","cr":"Forint - Ft","dm":".hu","ph":"+36","ab":"hungarian.png","rl":"White Outside - White Inside","sx":["Utca","Tér","út","Körút","Sétány","Köz","Park","Híd","Tér"],"bc":2,"pc":3,"po":1,"fs":["Lukoil.png","OMV.png","MOL.png","Avia.png","AS24.png","Auchan.png","MOL.png","Agip.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"iceland":{"c":"Europe","dr":"Right","l":"Icelandic","cr":"Icelandic krÃ³na - kr","dm":".is","ph":"+354","ab":"icelandic.png","rl":"White Outside - White Inside","sx":["Gata","Braut","Vegur","Stígur","ás","Vík","Bakki","Höfði","Gata"],"bc":1,"pc":3,"po":1,"fs":["N1.png","Orkan.png","AO.png","Skeljungur.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"india":{"c":"Asia","dr":"Left","cr":"Indian Rupee - ₹","dm":".in","ph":"+91","ab":"devanagari.png","rl":"Yellow Outside - White Inside / White Outside - White Inside / Yellow Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":3,"pc":5,"po":1,"fs":["IndianOil.png","BharatPetroleum.png","HindustanPetroleum.png","ReliancePetroleum.png","EssarOil.png","Nayara.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"indonesia":{"c":"Asia","dr":"Left","l":"Indonesian","cr":"Indonesian Rupiah - Rp","dm":".id","ph":"+62","ab":"latin.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["Jalan","Gang","Lorong","Perumahan","Desa","Kecamatan","Kampung","Pemukiman","Paseban","Gang"],"bc":2,"pc":3,"po":1,"fs":["Caltex.png","Pertamina.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"ireland":{"c":"Europe","dr":"Left","cr":"Euro - €","dm":".ie","ph":"+353","ab":"latin.png","rl":"Yellow Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":4,"po":1,"fs":["Esso.png","Texaco.png","Tesco.png","Maxol.png","Applegreen.png","EmoOil.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"isle-of-man":{"c":"Europe","dr":"Left","cr":"British Pound - £","dm":".im","ph":"+44","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":1,"po":1,"fs":["Total.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"israel":{"c":"Asia","dr":"Right","cr":"Israeli new shekel - ₪","dm":".il","ph":"+972","ab":"hebrew.png","rl":"Yellow Outside - White Inside","sx":["רחוב","כיכר","בית","מסלול","סמטה","גינה","מעבר","שדרות"],"bc":1,"pc":3,"po":1,"fs":["PazOilCompany.png","Delek.png","Sonol.png","DorAlon.png","TenPetroleum.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"italy":{"c":"Europe","dr":"Right","l":"Italian","cr":"Euro - €","dm":".it","ph":"+39","ab":"latin.png","rl":"White Outside - White Inside","sx":["Via","Piazza","Strada","Viale","Corso","Vicolo","Piazzale","Lungomare","Salita","Traversa"],"bc":2,"pc":4,"po":1,"fs":["Esso.png","Q8.png","Eni.png","Repsol.png","Avia.png","Tamoil.png","Agip.png","IP.png","AS24.png","Auchan.png","Agip.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"japan":{"c":"Asia","dr":"Left","l":"Japanese","cr":"Yen -  ¥","dm":".jp","ph":"+81","ab":"japanese.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["通り","道","町","番地","丁目","ヶ町","ヶ丁目","地割","公園","橋"],"bc":3,"pc":4,"po":1,"fs":["ENEOS.png","Idemitsu.png","CosmoOil.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"jersey":{"c":"Europe","dr":"Left","cr":"British Pound - £","dm":".je","ph":"+44","ab":"latin.png","rl":"Yellow Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":1,"po":1,"fs":["Total.png","Esso.png","Rubis.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"jordan":{"c":"Asia","dr":"Right","l":"Arabic","cr":"Jordanian Dinar - د.ا","dm":".jo","ph":"+962","ab":"arabic.png","rl":"Yellow Outside - White Inside","sx":["شارع","ميدان","ساحة","طريق","جادة","زقاق","حارة","جسر","دوار","ساحة"],"bc":1,"pc":3,"po":1,"fs":["Total.png","ManaseerOilGas.png","Total.png","JoPetro.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"kenya":{"c":"Africa","dr":"Left","cr":"Kenyan Shilling - KSh","dm":".ke","ph":"+254","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Road","Lane","Avenue","Street","Way","Boulevard","Drive","Court","Circle","Close"],"bc":2,"pc":3,"po":1,"fs":["Total.png","OiLibya.png","VivoEnergy.png","KenolKobil.png","NationalOilCorporationofKenya.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"kyrgyzstan":{"c":"Asia","dr":"Right","cr":"Kyrgyzstani som - COM","dm":".kg","ph":"+996","ab":"cyrillic.png","rl":"White Outside - White Inside","sx":["улица","площадь","проспект","переулок","квартал","аллея","мост","тракт","бульвар"],"bc":1,"pc":4,"po":1,"fs":["EcoPetrol.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"laos":{"c":"Asia","dr":"Right","l":"Lao","cr":"Lao Kip - ₭","dm":".la","ph":"+856","ab":"lao.png","rl":"White Outside - White Inside","sx":["ຖະຫນົນ","ຖະຫນົນ","ຖະຫນົນ","ຖະຫນົນ","ຖະຫນົນ","ຖະຫນົນ","ຖະຫນົນ","ຖະຫນົນ","ຖະຫນົນ"],"bc":1,"pc":1,"po":1,"fs":["PTT.png","LaoStateFuelCompany.png","PTT.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"latvia":{"c":"Europe","dr":"Right","l":"Latvian","cr":"Euro - €","dm":".lv","ph":"+371","ab":"latin.png","rl":"White Outside - White Inside","sx":["Iela","Laukums","Bulvāris","Gatve","Ceļš","Aleja","Promenāde","Tilts","Skvērs","Pļavas"],"bc":1,"pc":4,"po":1,"fs":["Lukoil.png","Neste.png","Dinaz.png","AstarteNafta.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"lesotho":{"c":"Africa","dr":"Left","cr":"Lesotho Loti (LSL), South African Rand (ZAR) - L, R","dm":".ls","ph":"+266","ab":"latin.png","rl":"Yellow Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Crescent","Drive","Court","Circle","Close"],"bc":1,"pc":3,"po":1,"fs":["Total.png","Engen.png","Excel.png","Total.png","Engen.png","Shell.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"lithuania":{"c":"Europe","dr":"Right","l":"Lithuanian","cr":"Euro - €","dm":".lt","ph":"+370","ab":"lithuanian.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["Gatvė","Aikštė","Skveras","Kelias","Alėja","Parkas","Takas","Tiltas","Miestelis","Namų"],"bc":1,"pc":2,"po":1,"fs":["Lukoil.png","Orlen.png","Neste.png","Viada.png","BalticPetroleum.png","Dujos.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"luxembourg":{"c":"Europe","dr":"Right","cr":"Euro - €","dm":".lu","ph":"+352","ab":"latin.png","rl":"White Outside - White Inside","sx":["Rue","Avenue","Boulevard","Place","Rond","point","Impasse","Allée","Chemin","Route","Quai"],"bc":2,"pc":4,"po":1,"fs":["Total.png","Esso.png","Texaco.png","Q8.png","Aral.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"madagascar":{"c":"Africa","dr":"Right","cr":"Malagasy ariary - Ar","dm":".mg","ph":"+261","ab":"latin.png","rl":"White Outside - White Inside","sx":["Rue","Avenue","Boulevard","Route","Impasse","Place","Voie","Carrefour","Quartier","Passage"],"bc":1,"pc":3,"po":1,"fs":["Total.png","BunkerOil.png","BestStasjon.png","Galana.png","Jovena.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"malaysia":{"c":"Asia","dr":"Left","l":"Malay","cr":"Malaysian ringgit - RM","dm":".my","ph":"+60","ab":"latin.png","rl":"White Outside - White Inside","sx":["Jalan","Lorong","Persiaran","Lebuh","Persimpangan","Taman","Kampung","Pekan","Jalan","Jalan"],"bc":4,"pc":4,"po":1,"fs":["Caltex.png","Petron.png","Neste.png","Petronas.png","BHPetrol.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"malta":{"c":"Europe","dr":"Left","cr":"Euro - €","dm":".mt","ph":"+356","ab":"latin.png","rl":"White Outside - White Inside","sx":["Triq","Square","Road","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":4,"po":1,"fs":["Enemed.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"mexico":{"c":"North America","dr":"Right","l":"Spanish","cr":"Mexican Peso - $","dm":".mx","ph":"+52","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside / White Outside - Yellow Inside","sx":["Calle","Avenida","Callejón","Camino","Boulevard","Paseo","Sendero","Corredor","Rambla"],"bc":1,"pc":20,"po":1,"fs":["Total.png","Arco.png","Pemex.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"monaco":{"c":"Europe","dr":"Right","l":"French","cr":"Euro  - €","dm":".mc","ph":"+377","ab":"latin.png","rl":"White Outside - White Inside","sx":["Rue","Avenue","Boulevard","Impasse","Place","Quai","Promenade","Voie","Escalier","Terrasse"],"bc":1,"pc":4,"po":1,"fs":["Avia.png","Agip.png","Esso.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"mongolia":{"c":"Asia","dr":"Right","l":"Mongolian","cr":"Mongolian tögrög - ₮","dm":".mn","ph":"+976","ab":"cyrillic.png","rl":"White Outside - White Inside","sx":["гудамж","төлөө","хөдөлгөөнт","гудамж","гудамж","мөргөлдөөн","дөрөв","суурилуулалт","шалгаруулалт","өргөн"],"bc":1,"pc":2,"po":1,"fs":["MagnaiTrade.png","Shunkhlai.png","Petrovis.png","SodMongolGroup.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"montenegro":{"c":"Europe","dr":"Right","l":"Montenegrin","cr":"Euro - €","dm":".me","ph":"+382","ab":"montenegrin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["Ulica","Trg","Bulevar","Put","Sokak","Ploča","Most","Aleja","Promenada","Ulaz"],"bc":1,"pc":4,"po":1,"fs":["Lukoil.png","EKO.png","Petrol.png","INA.png","Teboil.png","EuroPetrol.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"netherlands":{"c":"Europe","dr":"Right","l":"Dutch","cr":"Euro - €","dm":".nl","ph":"+31","ab":"latin.png","rl":"White Outside - White Inside","sx":["Straat","Weg","Laan","Plein","Gracht","Hof","Dijk","Steeg","Park","Allee"],"bc":3,"pc":4,"po":1,"fs":["Total.png","Esso.png","Lukoil.png","Texaco.png","Q8.png","Avia.png","Tamoil.png","Gulf.png","Tango.png","Firezone.png","Argos.png","Sakko.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"new-zealand":{"c":"Oceania","dr":"Left","l":"English","cr":"New Zealand Dollar - NZ$","dm":".nz","ph":"+64","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside / White Outside - Yellow Inside / Yellow Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":4,"po":2,"fs":["Caltex.png","ZEnergy.png","Caltex.png","Mobil.png","Gull.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"nigeria":{"c":"Africa","dr":"Right","l":"English","cr":"Nigerian Naira - ₦","dm":".ng","ph":"+234","ab":"latin.png","rl":"Yellow Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Crescent","Drive","Court","Circle","Close"],"bc":1,"pc":4,"po":1,"fs":["Total.png","ForteOil.png","Oando.png","Mobil.png","Conoil.png","MRSOilNigeria.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"north-macedonia":{"c":"Europe","dr":"Right","l":"Macedonian","cr":"Macedonian Denar - ден","dm":".mk","ph":"+389","ab":"cyrillic.png","rl":"White Outside - White Inside / Yellow Outside - Yellow Inside","sx":["улица","плоштад","булевар","пат","камен","мост","алеја","тракт","проход","плоштад"],"bc":4,"pc":4,"po":1,"fs":["Lukoil.png","Makpetrol.png","OKTA.png","Gazprom.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"northern-mariana-islands":{"c":"Oceania","dr":"Right","cr":"United States Dollar - $","dm":".mp","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Road","Avenue","Drive","Way","Boulevard","Circle","Court","Lane","Parkway","Plaza"],"bc":1,"pc":1,"po":1,"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"norway":{"c":"Europe","dr":"Right","l":"Norwegian","cr":"Norwegian Krone - kr","dm":".no","ph":"+47","ab":"dano-norwegian.png","rl":"White Outside - Yellow Inside","sx":["Gate","Vei","Plass","Allé","Veg","Stien","Torg","Gata","Bakken","Havn"],"bc":1,"pc":4,"po":1,"fs":["Esso.png","Uno-X.png","St1.png","YXEnergi.png","BunkerOil.png","BestStasjon.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"peru":{"c":"South America","dr":"Right","l":"Spanish","cr":"Sol - S/.","dm":".pe","ph":"+51","ab":"latin.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["Calle","Avenida","Pasaje","Camino","Boulevard","Paseo","Senda","Corredor","Rambla"],"bc":1,"pc":2,"po":1,"fs":["Repsol.png","Primax.png","Repsol.png","PetroPeru.png","Pecsa.png","GrifoMapco.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"philippines":{"c":"Asia","dr":"Right","cr":"Philippine Peso - ₱","dm":".ph","ph":"+63","ab":"latin.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":2,"pc":4,"po":1,"fs":["Caltex.png","PTT.png","EasternPetroleum.png","Unioil.png","Petron.png","PhoenixPetroleum.png","Seaoil.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"poland":{"c":"Europe","dr":"Right","l":"Polish","cr":"złoty - zł","dm":".pl","ph":"+48","ab":"polish.png","rl":"White Outside - White Inside","sx":["Ulica","Plac","Aleja","Skwer","Deptak","Rondo","Droga","Most","ścieżka","Pasaż"],"bc":2,"pc":4,"po":1,"fs":["Total.png","Lukoil.png","Aral.png","Avia.png","Orlen.png","AS24.png","Tesco.png","Auchan.png","GrupaLotos.png","BP.png","CircleK.png","Statoil.png","PKNOrlen.png","Lotos.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"portugal":{"c":"Europe","dr":"Right","l":"Portuguese","cr":"Euro - €","dm":".pt","ph":"+351","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["Rua","Avenida","Estrada","Travessa","Calçada","Beco","Largo","Praça","Rotunda","Passeio"],"bc":2,"pc":4,"po":1,"fs":["Repsol.png","Avia.png","Cepsa.png","Galp.png","Intermarche.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"puerto-rico":{"c":"North America","dr":"Right","cr":"United States Dollar - $","dm":".pr","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Calle","Avenida","Carretera","Boulevard","Carr","Paseo","Camino","Pasaje","Autopista"],"bc":1,"pc":1,"po":1,"fs":["Total.png","Puma.png","Puma.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"qatar":{"c":"Asia","dr":"Right","l":"Arabic","cr":"Qatari Riyal - ﷼","dm":".qa","ph":"+974","ab":"arabic.png","rl":"White Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":3,"po":1,"fs":["Woqod.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"romania":{"c":"Europe","dr":"Right","l":"Romanian","cr":"Romanian Leu - lei","dm":".ro","ph":"+40","ab":"romanian.png","rl":"White Outside - White Inside / Yellow Outside - Yellow Inside","sx":["Strada","Bulevard","Avenue","Piața","Calea","Aleea","Bulevardul","Strada","Pasaj","șoseaua"],"bc":1,"pc":4,"po":1,"fs":["Lukoil.png","OMV.png","MOL.png","Gazprom.png","Petrom.png","Rompetrol.png","Socar.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"russia":{"c":"Asia","dr":"Right","l":"Russian","cr":"Russian Ruble - ₽","dm":".ru","ph":"+7","ab":"russian.png","rl":"Yellow Outside - White Inside / White Outside - White Inside / White Outside - Yellow Inside","sx":["улица","площадь","проспект","переулок","аллея","бульвар","тракт","мост","переезд","шоссе"],"bc":2,"pc":4,"po":1,"fs":["Lukoil.png","Texaco.png","EcoPetrol.png","Gazprom.png","Rosneft.png","Tatneft.png","Surgutneftegas.png","Bashneft.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"rwanda":{"c":"Africa","dr":"Right","cr":"Rwandan Franc - FRw","dm":".rw","ph":"+250","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Ruko","Kimironko","Ibuye","Umujyi","Huye","Akarere","Umu","Cyerezo","Akagali","Mu"],"bc":1,"pc":4,"po":1,"fs":["Engen.png","SP.png","KenolKobil.png","HashiEnergy.png","MountMeru.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"san-marino":{"c":"Europe","dr":"Right","l":"Italian","cr":"Euro - €","dm":".sm","ph":"+378","ab":"latin.png","rl":"White Outside - White Inside","sx":["Via","Piazza","Strada","Viale","Corso","Vicolo","Passaggio","Salita","Piazzetta","Ramo"],"bc":1,"pc":1,"po":1,"fs":["Tamoil.png","Agip.png","IP.png","Eni.png","Q8.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"senegal":{"c":"Africa","dr":"Right","l":"French","cr":"West African CFA franc - CFA","dm":".sn","ph":"+221","ab":"latin.png","rl":"White Outside - White Inside","sx":["Rue","Avenue","Boulevard","Place","Voie","Impasse","Quartier","Pont","Carrefour","Passement"],"bc":3,"pc":2,"po":1,"fs":["Total.png","Puma.png","OiLibya.png","Elton.png","Petrosen.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"serbia":{"c":"Europe","dr":"Right","l":"Serbian","cr":"Serbian dinar - RSD","dm":".rs","ph":"+381","ab":"serbian.png","rl":"White Outside - White Inside","sx":["Ulica","Trg","Bulevar","Put","Sokak","Ploča","Most","Aleja","Promenada","Ulaz"],"bc":2,"pc":3,"po":1,"fs":["Lukoil.png","OMV.png","EKO.png","MOL.png","Avia.png","Gazprom.png","Petrol.png","NIS.png","EKO.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"singapore":{"c":"Asia","dr":"Left","cr":"Singapore Dollar - S$","dm":".sg","ph":"+65","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["Road","Avenue","Lane","Street","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":3,"po":1,"fs":["Esso.png","Neste.png","OMV.png","SingaporePetroleumCompany.png","Caltex.png","SPC.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"slovakia":{"c":"Europe","dr":"Right","l":"Slovak","cr":"Euro - €","dm":".sk","ph":"+421","ab":"slovak.png","rl":"White Outside - White Inside","sx":["Ulica","Námestie","Cesta","Alej","Most","Park","Dvor","Rampa","Obchodná"],"bc":1,"pc":4,"po":1,"fs":["OMV.png","Orlen.png","Benzina.png","Tesco.png","Lotos.png","Slovnaft.png","Avia.png","Lukoil.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"slovenia":{"c":"Europe","dr":"Right","l":"Slovene","cr":"Euro - €","dm":".si","ph":"+386","ab":"slovene.png","rl":"White Outside - White Inside","sx":["Ulica","Trg","Avenija","Cesta","Pot","Promenada","Most","Galerija","Nabrežje","Ploščad"],"bc":2,"pc":4,"po":1,"fs":["Q8.png","Agip.png","Petrol.png","Hofer.png","AS24.png","Tifon.png","MOL.png","OMV.png","Crodux.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"south-africa":{"c":"Africa","dr":"Left","cr":"South African Rand - R","dm":".za","ph":"+27","ab":"latin.png","rl":"Yellow Outside - White Inside / Red Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":9,"po":1,"fs":["Total.png","Puma.png","Caltex.png","BP.png","Chevron.png","Sasol.png","Engen.png","BP.png","Shell.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"south-korea":{"c":"Asia","dr":"Right","l":"Korean","cr":"South Korean won - ₩","dm":".kr","ph":"+82","ab":"hangul.png","rl":"White Outside - Yellow Inside","sx":["로","길","거리","로","길","거리","산길","길","길","로"],"bc":1,"pc":3,"po":1,"fs":["SKEnergy.png","GSCaltex.png","HyundaiOilbank.png","S-Oil.png","E1.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"spain":{"c":"Europe","dr":"Right","l":"Spanish","cr":"Euro - €","dm":".es","ph":"+34","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["Calle","Avenida","Plaza","Paseo","Carretera","Camino","Boulevard","Ronda","Pueblo","Rambla"],"bc":2,"pc":4,"po":1,"fs":["Avia.png","Tamoil.png","Carrefour.png","AS24.png","E.Leclerc.png","BP.png","Galp.png","Repsol.png","Cepsa.png","Disa.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"sri-lanka":{"c":"Asia","dr":"Left","cr":"Sri Lankan Rupee - Rs, රු","dm":".lk","ph":"+94","ab":"sinhala.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["පාර","පාර","පාර","පාර","පාර","පාර","පාර","පාර","පාර"],"bc":2,"pc":1,"po":1,"fs":["Caltex.png","CeylonPetroleumCorporation.png","LankaIOC.png","Laugfs.png","LitroGasLanka.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"sweden":{"c":"Europe","dr":"Right","l":"Swedish","cr":"Swedish Krona - kr","dm":".se","ph":"+46","ab":"swedish.png","rl":"White Outside - White Inside","sx":["Gatan","Vägen","Platsen","Gränden","Allén","Stråket","Vägen","Torg","Backen"],"bc":5,"pc":4,"po":1,"fs":["Total.png","Ingo.png","Q8.png","CircleK.png","Preem.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"switzerland":{"c":"Europe","dr":"Right","cr":"Swiss franc - CHF","dm":".ch","ph":"+41","ab":"latin.png","rl":"White Outside - White Inside","sx":["Strasse","Weg","Platz","Allee","Ring","Gasse","Promenade","Hauptstrasse","Pfad"],"bc":2,"pc":4,"po":1,"fs":["Esso.png","Eni.png","Agip.png","Socar.png","Avia.png","Tamoil.png","Migrol.png","Agrola.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"taiwan":{"c":"Asia","dr":"Right","l":"Mandarin Chinese","cr":"New Taiwan Dollar - NT$","dm":".tw","ph":"+886","ab":"chinese.png","rl":"White Outside - Yellow Inside","bc":1,"pc":3,"po":1,"fs":["CPCCorporation.png","FormosaPetrochemicalCorp.png","TaiwanSugarCorporation.png","Uni-President.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"thailand":{"c":"Asia","dr":"Left","l":"Thai","cr":"Thai Baht - ฿","dm":".th","ph":"+66","ab":"thai.png","rl":"White Outside - Yellow Inside","sx":["ถนน","ซอย","ตรอก","แยก","แม่น้ำ","ป่า","สะพาน","ทาง","พื้นที่","เขต"],"bc":1,"pc":4,"po":1,"fs":["Caltex.png","PTT.png","Esso.png","Bangchak.png","PTGEnergy.png","Susco.png","Jiffy.png","Pure.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"tunisia":{"c":"Africa","dr":"Right","l":"Arabic","cr":"Tunisian dinar - DT","dm":".tn","ph":"+216","ab":"arabic.png","rl":"White Outside - White Inside","sx":["Rue","Avenue","Boulevard","Place","Voie","Impasse","Quartier","Pont","Carrefour","Passage"],"bc":1,"pc":2,"po":1,"fs":["Total.png","OiLibya.png","Staroil.png","Agil.png","VivoEnergy.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"turkey":{"c":"Europe","dr":"Right","l":"Turkish","cr":"Turkish Lira - ₺","dm":".tr","ph":"+90","ab":"turkish.png","rl":"White Outside - White Inside / White Outside - Yellow Inside / Yellow Outside - Yellow Inside","sx":["Sokak","Cadde","Bulvar","Mahallesi","Caddesi","Sokağı","Köyü","Mevkii","Kavşak","çıkmaz"],"bc":2,"pc":4,"po":1,"fs":["Lukoil.png","Total.png","Opet.png","PetrolOfisi.png","BP.png","MOil.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"uganda":{"c":"Africa","dr":"Left","cr":"Ugandan shilling - USh","dm":".ug","ph":"+256","ab":"latin.png","rl":"White Outside - White Inside / White Outside - Yellow Inside","bc":1,"pc":3,"po":1,"fs":["Total.png","OiLibya.png","Total.png","VivoEnergy.png","OryxEnergies.png","HassPetroleum.png","Petrocity.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"ukraine":{"c":"Europe","dr":"Right","l":"Ukrainian","cr":"Ukrainian Hryvnia - ₴","dm":".ua","ph":"+380","ab":"ukrainian.png","rl":"White Outside - White Inside","sx":["вулиця","площа","проспект","провулок","алея","бульвар","тракт","міст","перехрестя","шосе"],"bc":2,"pc":4,"po":1,"fs":["OKKO.png","WOG.png","Socar.png","KLO.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"united-arab-emirates":{"c":"Asia","dr":"Right","l":"Arabic","cr":"UAE dirham - د.إ","dm":".ae","ph":"+971","ab":"arabic.png","rl":"Yellow Outside - White Inside / Yellow Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":1,"pc":4,"po":1,"fs":["ADNOC.png","ENOC.png","EPPCO.png","Emarat.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"united-kingdom":{"c":"Europe","dr":"Left","l":"English","cr":"Pound Sterling - £","dm":".uk","ph":"+44","ab":"latin.png","rl":"Yellow Outside - White Inside / White Outside - White Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":3,"pc":1,"po":1,"fs":["Esso.png","Texaco.png","Jet.png","Tesco.png","Morrisons.png","AsdaPetrolStations.png","SainsburysPetrolStations.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"united-states":{"c":"North America","dr":"Right","l":"English","cr":"US Dollar - $","dm":".us","ph":"+1","ab":"latin.png","rl":"White Outside - Yellow Inside","sx":["Street","Road","Avenue","Lane","Way","Boulevard","Crescent","Drive","Court","Circle"],"bc":6,"pc":53,"po":1,"fs":["BP.png","Lukoil.png","CircleK.png","Gulf.png","Mobil.png","Costco.png","7-Eleven.png","Irving.png","Pemex.png","Wawa.png","Meijer.png","H-E-B.png","CaseysGeneralStores.png","Kroger.png","Albertsons.png","GiantEagle.png","Safeway.png","Target.png","Walmart.png","BJsWholesaleClub.png","SamsClub.png","MurphyUSA.png","QuikTrip.png","RaceTrac.png","Sheetz.png","HolidayStationstores.png","Maverik.png","KwikTrip.png","CumberlandFarms.png","LovesTravelStops.png","PilotFlyingJ.png","TravelCentersofAmerica.png","Exxon.png","Sunoco.png","Phillips66.png","Valero.png","MarathonPetroleum.png","Tesoro.png","Sinclair.png","Conoco.png","Hy-Vee.png","Mobil.png","RaceTrac.png","Shell.png","ExxonMobil.png","Texaco.png","Chevron.png","Arco.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"uruguay":{"c":"South America","dr":"Right","l":"Spanish","cr":"Uruguayan peso - $U","dm":".uy","ph":"+598","ab":"latin.png","sx":["Calle","Avenida","Pasaje","Camino","Boulevard","Paseo","Senda","Corredor","Rambla"],"bc":1,"pc":3,"po":1,"fs":["Petrobras.png","ANCAP.png","DUCSA.png","Petrobras.png","Esso.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"us-virgin-islands":{"c":"North America","dr":"Left","l":"English","cr":"United States Dollar - $","dm":".vi","ab":"latin.png","rl":"White Outside - Yellow Inside","bc":1,"pc":1,"po":1,"fs":["Total.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]},"vietnam":{"c":"Asia","dr":"Right","l":"Vietnamese","cr":"Vietnamese dong - ₫","dm":".vn","ph":"+84","ab":"vietnamese.png","sx":["đường","Phố","Hẻm","Ngõ","Quận","đường","Hẻm","Quận","Phường","Khu"],"bc":1,"pc":2,"po":1,"fs":["Petrolimex.png","PVOil.png","BinhSonRefiningandPetrochemicalJSC.png","VietNamNationalGasolineCompany.png","DongThapPetroleumTradingImportExportCompany.png"],"sg":["bend","chevron","pedestrian","roundabout","stop","yield"]}};

    function capitalizeWord(str) {
        if (!str) return "";
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function generatePlonkitRewrittenHtml(countryCode, countryName, state) {
        const c = (countryCode || "").toUpperCase();
        const codeLower = c.toLowerCase() || "un";
        const clue = c ? (GEO_CLUES[c] || null) : null;
        const slug = getCountrySlug(countryName, countryCode);
        const capSlug = capitalizeWord(slug);
        const geo = GEOMASTR_DATA[slug] || {};

        // Core metadata (English)
        const drive = (geo.dr || (clue ? clue.drive : "Right")).trim();
        const continent = geo.c || "World";
        const language = geo.l || (clue ? clue.tips : "");
        const currency = geo.cr || "";
        const domain = geo.dm || (clue ? clue.domain : ("." + codeLower));
        const phone = geo.ph || "";
        const cam = clue ? (clue.cam || "Gen 3/4") : "Gen 3/4";

        const isLeft = drive.toLowerCase() === "left";
        const driveColor = isLeft ? "#f59e0b" : "#38bdf8";
        const driveBg = isLeft ? "rgba(245, 158, 11, 0.15)" : "rgba(56, 189, 248, 0.15)";
        const driveBorder = isLeft ? "rgba(245, 158, 11, 0.35)" : "rgba(56, 189, 248, 0.35)";

        // Plonkit Clues (English)
        const bollard = clue ? (clue.bollard || "") : "";
        const plate = clue ? (clue.plate || "") : "";
        const pole = clue ? (clue.pole || "") : "";
        const lines = clue ? (clue.lines || "") : "";
        const tips = clue ? (clue.tips || "") : "";

        // Geomastr Media URLs
        const alphabetImgUrl = geo.ab ? `https://geomastr.com/assets/media/languages/${geo.ab}` : "";
        const roadLinesText = geo.rl || "";
        const suffixes = geo.sx || [];

        // Bollards & Plates counts
        const bollardCount = Math.min(geo.bc || 1, 3);
        const plateCount = Math.min(geo.pc || 1, 4);

        // Sign types
        const hasStop = !geo.sg || geo.sg.includes("stop");
        const hasYield = !geo.sg || geo.sg.includes("yield");
        const hasPedestrian = !geo.sg || geo.sg.includes("pedestrian");
        const hasRoundabout = !geo.sg || geo.sg.includes("roundabout");
        const hasBend = !geo.sg || geo.sg.includes("bend");
        const hasChevron = !geo.sg || geo.sg.includes("chevron");

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
    .badge-cont {
        background: rgba(147, 51, 234, 0.12);
        color: #c084fc;
        border: 1px solid rgba(147, 51, 234, 0.3);
    }
    .badge-phone {
        background: rgba(16, 185, 129, 0.12);
        color: #34d399;
        border: 1px solid rgba(16, 185, 129, 0.3);
        font-family: monospace;
    }
    .badge-curr {
        background: rgba(234, 179, 8, 0.12);
        color: #facc15;
        border: 1px solid rgba(234, 179, 8, 0.3);
    }

    .section-divider {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.8px;
        color: #94a3b8;
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
        background: rgba(255, 255, 255, 0.08);
    }

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

    /* Visual Media & Photo Galleries */
    .visual-gallery {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
        gap: 8px;
        margin-top: 6px;
    }
    .visual-card {
        background: #111827;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 9px;
        padding: 7px;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        box-shadow: 0 4px 10px rgba(0,0,0,0.25);
        transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .visual-card:hover {
        border-color: rgba(56, 189, 248, 0.4);
        transform: translateY(-2px);
    }
    .img-bollard {
        width: 100%;
        height: 115px;
        object-fit: contain;
        background: #090e1a;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.05);
        margin-bottom: 5px;
    }
    .img-plate {
        width: 100%;
        height: 60px;
        object-fit: contain;
        background: #090e1a;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.05);
        margin-bottom: 5px;
    }
    .img-sign {
        width: 100%;
        height: 62px;
        object-fit: contain;
        background: #090e1a;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.05);
        padding: 4px;
        margin-bottom: 5px;
    }
    .img-alphabet {
        width: 100%;
        max-height: 80px;
        object-fit: contain;
        background: #090e1a;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.05);
        padding: 6px;
        margin-top: 6px;
    }
    .img-post {
        width: 100%;
        height: 65px;
        object-fit: contain;
        background: #090e1a;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.05);
        padding: 5px;
        margin-bottom: 5px;
    }
    .img-fuel {
        height: 38px;
        object-fit: contain;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 6px;
        padding: 4px 8px;
    }
    .card-caption {
        font-size: 10px;
        font-weight: 700;
        color: #38bdf8;
    }
    .card-subtext {
        font-size: 9.5px;
        color: #94a3b8;
    }

    /* Suffix Pills */
    .suffix-wrap {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 6px;
    }
    .suffix-pill {
        background: rgba(56, 189, 248, 0.1);
        border: 1px solid rgba(56, 189, 248, 0.25);
        color: #e0f2fe;
        font-size: 11px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 6px;
        font-family: monospace;
    }

    /* Road Line Graphic Simulator */
    .road-sim {
        background: #1e293b;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 10px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 6px;
        height: 48px;
        position: relative;
    }
    .road-edge {
        width: 4px;
        height: 100%;
        background: #ffffff;
        border-radius: 2px;
    }
    .road-center {
        height: 100%;
        border-left: 3px dashed #ffffff;
    }
    .road-label {
        font-size: 11px;
        color: #cbd5e1;
        font-weight: 600;
        text-align: center;
        flex: 1;
        padding: 0 10px;
    }

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
                ${state ? `<div class="state">${state}</div>` : (continent ? `<div class="state">${continent}</div>` : "")}
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
            ${continent ? `<span class="badge badge-cont">🌍 ${continent}</span>` : ""}
            ${phone ? `<span class="badge badge-phone">📞 ${phone}</span>` : ""}
            ${currency ? `<span class="badge badge-curr">💰 ${currency}</span>` : ""}
        </div>

        <!-- 1. PLONKIT CLUES & META SECTION -->
        <div class="section-divider">📖 Plonkit Clues & Meta</div>

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

        <!-- 2. GEOMASTR COMPLETE VISUAL & COUNTRY DETAILS -->
        <div class="section-divider">📸 Geomastr Visual & Country Guide</div>

        <!-- Language & Alphabet -->
        ${(language || alphabetImgUrl) ? `
            <div class="card">
                <div class="card-title">🔤 LANGUAGE & ALPHABET</div>
                <div class="card-body">
                    ${language ? `<div><strong>Official Language:</strong> ${language}</div>` : ""}
                    ${alphabetImgUrl ? `
                        <img class="img-alphabet" src="${alphabetImgUrl}" alt="Alphabet chart" onerror="this.style.display='none'">
                    ` : ""}
                </div>
            </div>
        ` : ""}

        <!-- Common Street Name Suffixes -->
        ${suffixes.length > 0 ? `
            <div class="card">
                <div class="card-title">🏷️ COMMON STREET NAME SUFFIXES</div>
                <div class="suffix-wrap">
                    ${suffixes.map(s => `<span class="suffix-pill">- ${s}</span>`).join("")}
                </div>
            </div>
        ` : ""}

        <!-- Road Lines Visual & Details -->
        ${roadLinesText ? `
            <div class="card">
                <div class="card-title">🛣️ ROAD LINE SYSTEM (GEOMASTR)</div>
                <div class="road-sim">
                    <div class="road-edge"></div>
                    <div class="road-label">${roadLinesText}</div>
                    <div class="road-edge"></div>
                </div>
            </div>
        ` : ""}

        <!-- Authentic Roadside Bollards Gallery -->
        <div class="card">
            <div class="card-title">🪧 AUTHENTIC BOLLARD PHOTOS</div>
            <div class="visual-gallery">
                <div class="visual-card" id="geo-bollard-1">
                    <img class="img-bollard" src="https://geomastr.com/assets/media/bollards/${slug}.jpg" alt="Bollard 1" onerror="document.getElementById('geo-bollard-1').style.display='none'">
                    <div class="card-caption">Bollard 1</div>
                    <div class="card-subtext">Physical roadside</div>
                </div>
                ${bollardCount >= 2 ? `
                    <div class="visual-card" id="geo-bollard-2">
                        <img class="img-bollard" src="https://geomastr.com/assets/media/bollards/${slug}2.jpg" alt="Bollard 2" onerror="document.getElementById('geo-bollard-2').style.display='none'">
                        <div class="card-caption">Bollard 2</div>
                        <div class="card-subtext">Variant type</div>
                    </div>
                ` : ""}
                ${bollardCount >= 3 ? `
                    <div class="visual-card" id="geo-bollard-3">
                        <img class="img-bollard" src="https://geomastr.com/assets/media/bollards/${slug}3.jpg" alt="Bollard 3" onerror="document.getElementById('geo-bollard-3').style.display='none'">
                        <div class="card-caption">Bollard 3</div>
                        <div class="card-subtext">Variant type</div>
                    </div>
                ` : ""}
            </div>
        </div>

        <!-- Authentic License Plates Gallery -->
        <div class="card">
            <div class="card-title">🚘 AUTHENTIC LICENSE PLATES</div>
            <div class="visual-gallery">
                <div class="visual-card" id="geo-plate-1">
                    <img class="img-plate" src="https://geomastr.com/assets/media/licenseplates/${capSlug}.jpg" alt="Plate 1" onerror="document.getElementById('geo-plate-1').style.display='none'">
                    <div class="card-caption">Standard Plate</div>
                    <div class="card-subtext">Vehicle format</div>
                </div>
                ${plateCount >= 2 ? `
                    <div class="visual-card" id="geo-plate-2">
                        <img class="img-plate" src="https://geomastr.com/assets/media/licenseplates/${capSlug}2.jpg" alt="Plate 2" onerror="document.getElementById('geo-plate-2').style.display='none'">
                        <div class="card-caption">Plate Variant</div>
                        <div class="card-subtext">Format 2</div>
                    </div>
                ` : ""}
                ${plateCount >= 3 ? `
                    <div class="visual-card" id="geo-plate-3">
                        <img class="img-plate" src="https://geomastr.com/assets/media/licenseplates/${capSlug}3.jpg" alt="Plate 3" onerror="document.getElementById('geo-plate-3').style.display='none'">
                        <div class="card-caption">Plate Variant</div>
                        <div class="card-subtext">Format 3</div>
                    </div>
                ` : ""}
            </div>
        </div>

        <!-- Official Traffic & Warning Signs -->
        <div class="card">
            <div class="card-title">🚦 TRAFFIC & ROAD SIGNS</div>
            <div class="visual-gallery" style="grid-template-columns: repeat(3, 1fr);">
                ${hasStop ? `
                    <div class="visual-card" id="geo-sign-stop">
                        <img class="img-sign" src="https://geomastr.com/assets/media/streetsigns/stop/${slug}.svg" alt="Stop Sign" onerror="document.getElementById('geo-sign-stop').style.display='none'">
                        <div class="card-caption">Stop Sign</div>
                    </div>
                ` : ""}
                ${hasYield ? `
                    <div class="visual-card" id="geo-sign-yield">
                        <img class="img-sign" src="https://geomastr.com/assets/media/streetsigns/yields/${slug}_1.svg" alt="Yield Sign" onerror="document.getElementById('geo-sign-yield').style.display='none'">
                        <div class="card-caption">Yield Sign</div>
                    </div>
                ` : ""}
                ${hasPedestrian ? `
                    <div class="visual-card" id="geo-sign-ped">
                        <img class="img-sign" src="https://geomastr.com/assets/media/streetsigns/pedestrians/${slug}.svg" alt="Pedestrian Sign" onerror="document.getElementById('geo-sign-ped').style.display='none'">
                        <div class="card-caption">Pedestrian</div>
                    </div>
                ` : ""}
                ${hasRoundabout ? `
                    <div class="visual-card" id="geo-sign-round">
                        <img class="img-sign" src="https://geomastr.com/assets/media/streetsigns/round/${slug}.svg" alt="Roundabout" onerror="document.getElementById('geo-sign-round').style.display='none'">
                        <div class="card-caption">Roundabout</div>
                    </div>
                ` : ""}
                ${hasBend ? `
                    <div class="visual-card" id="geo-sign-bend">
                        <img class="img-sign" src="https://geomastr.com/assets/media/streetsigns/curve/${slug}.svg" alt="Curve Warning" onerror="document.getElementById('geo-sign-bend').style.display='none'">
                        <div class="card-caption">Curve / Bend</div>
                    </div>
                ` : ""}
                ${hasChevron ? `
                    <div class="visual-card" id="geo-sign-chev">
                        <img class="img-sign" src="https://geomastr.com/assets/media/streetsigns/chevrons/${slug}_1.svg" alt="Chevron" onerror="document.getElementById('geo-sign-chev').style.display='none'">
                        <div class="card-caption">Chevron</div>
                    </div>
                ` : ""}
            </div>
        </div>

        <!-- Postal / Utility Infrastructure -->
        <div class="card" id="geo-post-card">
            <div class="card-title">🪵 POSTAL & UTILITY SILHOUETTE</div>
            <div class="visual-gallery" style="grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));">
                <div class="visual-card" id="geo-post-1">
                    <img class="img-post" src="https://geomastr.com/assets/media/post/${slug}.svg" alt="Postal Utility" onerror="document.getElementById('geo-post-card').style.display='none'">
                    <div class="card-caption">Postal / Utility</div>
                    <div class="card-subtext">National design</div>
                </div>
            </div>
        </div>

        <!-- Fuel Station Brands -->
        ${geo.fs && geo.fs.length > 0 ? `
            <div class="card">
                <div class="card-title">⛽ COMMON FUEL STATIONS</div>
                <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px;">
                    ${geo.fs.map(f => `<img class="img-fuel" src="https://geomastr.com/assets/media/companies/${f}" alt="Fuel brand" onerror="this.style.display='none'">`).join("")}
                </div>
            </div>
        ` : ""}

    ` : `
        <div style="text-align: center; padding: 36px 12px; color: #94a3b8;">
            <div style="font-size: 32px; margin-bottom: 10px;">🧭</div>
            <div style="font-size: 14px; font-weight: 700; color: #cbd5e1; margin-bottom: 6px;">Awaiting Round Location...</div>
            <div style="font-size: 11.5px; color: #64748b; line-height: 1.5;">Plonkit textual clues and comprehensive Geomastr visual photos will automatically load as soon as Street View coordinates are detected.</div>
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
        checkPanoramaFailure();
        if (!isMapValid(foundMap)) {
            requestScanForMap(100);
        }
        syncTermsText();
        dismissPartyModalIfNeeded();
    } catch (_) {}
}, 1000);
