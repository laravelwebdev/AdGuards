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

// =================== Plonkit Assistant (Shortcut H) ===================
let plonkitActive = JSON.parse(localStorage.getItem("plonkitActive")) || false;
let autoSyncPlonkit = JSON.parse(localStorage.getItem("autoSyncPlonkit")) !== false;
let plonkitPanelEl = null;
let plonkitCompanionWindow = null;
let lastRenderedSlug = "";

function getFlagEmoji(code) {
    if (!code || code.length !== 2) return "🌍";
    try {
        return String.fromCodePoint(...code.toUpperCase().split("").map(c => 127397 + c.charCodeAt(0)));
    } catch (_) {
        return "🌍";
    }
}

function getPlonkitSlug(countryName, countryCode) {
    if (!countryName && !countryCode) return "";
    const code = (countryCode || "").toUpperCase();
    const codeMap = {
        "US": "united-states", "GB": "united-kingdom", "UK": "united-kingdom",
        "KR": "south-korea", "CZ": "czechia", "RU": "russia", "AE": "united-arab-emirates",
        "DO": "dominican-republic", "NZ": "new-zealand", "ZA": "south-africa", "SZ": "eswatini",
        "MK": "north-macedonia", "CW": "curacao", "LA": "laos", "KG": "kyrgyzstan",
        "TW": "taiwan", "HK": "hong-kong", "SG": "singapore", "MY": "malaysia",
        "ID": "indonesia", "TH": "thailand", "PH": "philippines", "VN": "vietnam",
        "KH": "cambodia", "BD": "bangladesh", "LK": "sri-lanka", "BT": "bhutan",
        "MN": "mongolia", "JP": "japan", "AU": "australia", "BR": "brazil",
        "MX": "mexico", "CO": "colombia", "AR": "argentina", "CL": "chile",
        "PE": "peru", "EC": "ecuador", "BO": "bolivia", "UY": "uruguay",
        "DK": "denmark", "SE": "sweden", "NO": "norway", "FI": "finland",
        "IS": "iceland", "EE": "estonia", "LV": "latvia", "LT": "lithuania",
        "PL": "poland", "DE": "germany", "NL": "netherlands", "BE": "belgium",
        "FR": "france", "ES": "spain", "PT": "portugal", "IT": "italy",
        "CH": "switzerland", "AT": "austria", "IE": "ireland", "GR": "greece",
        "TR": "turkey", "RO": "romania", "BG": "bulgaria", "HU": "hungary",
        "SK": "slovakia", "SI": "slovenia", "HR": "croatia", "RS": "serbia",
        "ME": "montenegro", "AL": "albania", "UA": "ukraine", "IL": "israel",
        "JO": "jordan", "QA": "qatar", "TN": "tunisia", "KE": "kenya",
        "UG": "uganda", "GH": "ghana", "NG": "nigeria", "SN": "senegal",
        "BW": "botswana", "LS": "lesotho", "MD": "moldova", "AD": "andorra",
        "SM": "san-marino", "MT": "malta", "LU": "luxembourg", "FO": "faroe-islands",
        "GL": "greenland", "GU": "guam", "MP": "northern-mariana-islands",
        "AS": "american-samoa", "PR": "puerto-rico", "VI": "us-virgin-islands", "BM": "bermuda"
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

function openPlonkitCompanion(slug) {
    if (!slug) return;
    const targetUrl = "https://www.plonkit.net/" + slug;
    const w = Math.min(520, Math.floor(window.screen.availWidth * 0.42));
    const h = window.screen.availHeight;
    const left = Math.max(0, window.screen.availWidth - w);
    const top = 0;
    try {
        if (plonkitCompanionWindow && !plonkitCompanionWindow.closed) {
            plonkitCompanionWindow.location.href = targetUrl;
            plonkitCompanionWindow.focus();
        } else {
            plonkitCompanionWindow = window.open(
                targetUrl,
                "AdGuardsPlonkitCompanion",
                `width=${w},height=${h},top=${top},left=${left},resizable=yes,scrollbars=yes,status=no`
            );
        }
    } catch (_) {
        window.open(targetUrl, "_blank");
    }
}

function createOrGetPlonkitPanel() {
    let panel = document.getElementById("__adguards_plonkit_panel");
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "__adguards_plonkit_panel";
    panel.style.position = "fixed";
    panel.style.top = "68px";
    panel.style.right = "16px";
    panel.style.width = "340px";
    panel.style.maxWidth = "calc(100vw - 32px)";
    panel.style.zIndex = "2147483640";
    panel.style.background = "rgba(10, 15, 29, 0.94)";
    panel.style.backdropFilter = "blur(14px)";
    panel.style.webkitBackdropFilter = "blur(14px)";
    panel.style.border = "1px solid rgba(56, 189, 248, 0.35)";
    panel.style.borderRadius = "14px";
    panel.style.boxShadow = "0 12px 36px rgba(0, 0, 0, 0.65), 0 0 16px rgba(56, 189, 248, 0.15)";
    panel.style.color = "#f8fafc";
    panel.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    panel.style.fontSize = "13px";
    panel.style.lineHeight = "1.5";
    panel.style.overflow = "hidden";
    panel.style.display = "none";
    panel.style.userSelect = "none";

    (document.body || document.documentElement).appendChild(panel);
    plonkitPanelEl = panel;
    return panel;
}

function updatePlonkitUI() {
    if (!plonkitActive) {
        if (plonkitPanelEl) {
            plonkitPanelEl.style.display = "none";
        }
        return;
    }

    const panel = createOrGetPlonkitPanel();
    panel.style.display = "block";

    const country = globalPlace.country || "";
    const countryCode = globalPlace.countryCode || "";
    const state = globalPlace.state || "";
    const flag = getFlagEmoji(countryCode);
    const slug = getPlonkitSlug(country, countryCode);
    const plonkitUrl = slug ? ("https://www.plonkit.net/" + slug) : "https://www.plonkit.net";

    if (autoSyncPlonkit && slug && slug !== lastRenderedSlug) {
        lastRenderedSlug = slug;
        if (plonkitCompanionWindow && !plonkitCompanionWindow.closed) {
            try {
                plonkitCompanionWindow.location.href = plonkitUrl;
            } catch (_) {}
        }
    }

    panel.innerHTML = `
        <div style="padding: 12px 14px; background: rgba(56, 189, 248, 0.08); border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 20px; line-height: 1;">${flag}</span>
                <div>
                    <div style="font-weight: 700; font-size: 14px; color: #ffffff; letter-spacing: 0.2px;">
                        ${country ? country : "Menunggu Deteksi..."}
                    </div>
                    ${state ? `<div style="font-size: 11px; color: #94a3b8;">${state}</div>` : ""}
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
                <span style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-family: monospace;">[H]</span>
                <button id="__adguards_plonkit_close" style="background: none; border: none; color: #94a3b8; font-size: 16px; cursor: pointer; padding: 0 4px; line-height: 1;" title="Tutup (Tekan H)">✕</button>
            </div>
        </div>
        
        <div style="padding: 14px;">
            ${slug ? `
                <div style="background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 8px 10px; margin-bottom: 12px; font-family: monospace; font-size: 11.5px; color: #38bdf8; word-break: break-all; display: flex; align-items: center; justify-content: space-between;">
                    <span>plonkit.net/${slug}</span>
                </div>

                <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                    <button id="__adguards_open_companion" style="flex: 1; background: #0284c7; border: none; color: #ffffff; font-weight: 600; font-size: 12px; padding: 8px 12px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: background 0.15s; box-shadow: 0 2px 8px rgba(2, 132, 199, 0.4);">
                        <span>📖 Buka Jendela Panduan</span>
                    </button>
                    <a href="${plonkitUrl}" target="_blank" rel="noopener noreferrer" style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.12); color: #f8fafc; font-weight: 600; font-size: 12px; padding: 8px 12px; border-radius: 8px; text-decoration: none; display: flex; align-items: center; justify-content: center;" title="Buka Tab Baru">
                        🔗 Tab
                    </a>
                </div>

                <label style="display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: #cbd5e1; cursor: pointer; margin-bottom: 10px;">
                    <input type="checkbox" id="__adguards_autosync_cb" ${autoSyncPlonkit ? "checked" : ""} style="cursor: pointer; accent-color: #38bdf8;">
                    <span>Auto-sync jendela saat ronde berganti</span>
                </label>

                <div style="border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 10px;">
                    <details style="font-size: 11.5px; color: #94a3b8;">
                        <summary style="cursor: pointer; color: #38bdf8; font-weight: 600; user-select: none;">ℹ️ Tampilkan Iframe di Sini</summary>
                        <div style="margin-top: 8px; background: rgba(0, 0, 0, 0.4); border-radius: 8px; overflow: hidden; position: relative;">
                            <iframe id="__adguards_plonkit_iframe" src="${plonkitUrl}" style="width: 100%; height: 260px; border: none; background: #ffffff;"></iframe>
                            <div style="padding: 8px; font-size: 10.5px; color: #94a3b8; background: rgba(15, 23, 42, 0.95); border-top: 1px solid rgba(255,255,255,0.06); text-align: center;">
                                Jika iframe kosong karena proteksi <code>X-Frame-Options</code> Plonkit, gunakan tombol <strong>Buka Jendela Panduan</strong> di atas.
                            </div>
                        </div>
                    </details>
                </div>
            ` : `
                <div style="text-align: center; padding: 16px 8px; color: #94a3b8;">
                    <div style="font-size: 24px; margin-bottom: 6px;">🧭</div>
                    <div style="font-size: 12px; color: #cbd5e1; margin-bottom: 4px;">Belum ada negara yang terdeteksi</div>
                    <div style="font-size: 11px;">Mulai tebak atau tunggu Street View memuat metadata lokasi...</div>
                </div>
            `}
        </div>
        <div style="padding: 6px 14px 10px; font-size: 10.5px; color: #64748b; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.04);">
            Tekan <strong style="color: #38bdf8;">H</strong> di keyboard untuk menyembunyikan / menampilkan
        </div>
    `;

    const closeBtn = document.getElementById("__adguards_plonkit_close");
    if (closeBtn) {
        closeBtn.onclick = () => {
            plonkitActive = false;
            try { localStorage.setItem("plonkitActive", "false"); } catch (_) {}
            updatePlonkitUI();
        };
    }

    const openBtn = document.getElementById("__adguards_open_companion");
    if (openBtn) {
        openBtn.onclick = () => {
            openPlonkitCompanion(slug);
        };
    }

    const autoSyncCb = document.getElementById("__adguards_autosync_cb");
    if (autoSyncCb) {
        autoSyncCb.onchange = (e) => {
            autoSyncPlonkit = e.target.checked;
            try { localStorage.setItem("autoSyncPlonkit", JSON.stringify(autoSyncPlonkit)); } catch (_) {}
        };
    }
}

function togglePlonkitPanel() {
    plonkitActive = !plonkitActive;
    try { localStorage.setItem("plonkitActive", JSON.stringify(plonkitActive)); } catch (_) {}
    updatePlonkitUI();
}

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
