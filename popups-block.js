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

// =================== Plonkit Clue Assistant (Shortcut H) ===================
const GEO_CLUES = {
"DK": {
    "drive": "Kanan",
    "cam": "Gen 3/4 (Low Cam)",
    "domain": ".dk",
    "bollard": "Putih strip merah atas, bagian belakang putih polos",
    "pole": "Tiang kayu/beton persegi panjang polos",
    "plate": "Plat putih strip biru EU kiri, border merah tipis (plat kuning = komersial)",
    "lines": "Garis tepi putih putus-putus pendek rapat",
    "tips": "Huruf æ, ø, å. Nama jalan -vej/-gade. Topografi sangat datar, banyak sepeda."
},
"SE": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".se",
    "bollard": "Putih reflektor oranye depan, putih belakang",
    "pole": "Tiang kayu dengan isolator kaca/keramik",
    "plate": "Plat putih strip biru EU, format 3 huruf 3 angka/huruf",
    "lines": "Garis tepi putih putus-putus pendek, garis tengah putih",
    "tips": "Huruf ä, ö, å. Rumah cat merah Falu red, hutan birch/pinus, bergelombang."
},
"NO": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".no",
    "bollard": "Putih dengan reflektor strip putih depan dan belakang",
    "pole": "Tiang kayu dengan pengait isolator di pucuk",
    "plate": "Plat putih strip bendera Norwegia (plat hijau = komersial)",
    "lines": "Garis tengah KUNING, garis tepi putih solid",
    "tips": "Huruf æ, ø, å. Jalan 'veg'. Fjord, pegunungan terjal, terowongan panjang."
},
"FI": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".fi",
    "bollard": "Reflektor persegi panjang putih/oranye, tiang salju oranye/kayu",
    "pole": "Tiang kayu silang, banyak tiang penanda salju",
    "plate": "Plat putih strip EU, format 3 huruf - 3 angka (tanpa border bendera)",
    "lines": "Garis tengah putih, garis tepi putih solid",
    "tips": "Bahasa Finno-Ugric vokal ganda (aa, ee, ii, oo, uu, ä, ö). Danau & hutan pohon birch."
},
"IS": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".is",
    "bollard": "Kuning cerah silinder dengan strip reflektor hitam/putih",
    "pole": "Tiang kayu kokoh dengan palang horizontal",
    "plate": "Plat putih strip bendera Islandia, huruf biru",
    "lines": "Garis tengah putih putus-putus, tepi putih",
    "tips": "Lansekap vulkanik tanpa pohon, lumut tebal, jalan kerikil, huruf ð, þ, æ."
},
"EE": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".ee",
    "bollard": "Putih dengan reflektor oranye depan, putih belakang",
    "pole": "Tiang beton persegi dengan tiang penopang diagonal (A-frame)",
    "plate": "Plat putih strip biru EU",
    "lines": "Garis tepi putih putus-putus jarang",
    "tips": "Huruf õ, ä, ö, ü. Mirip Finlandia tapi arsitektur & tiang listrik ala Soviet/Eropa Timur."
},
"LV": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".lv",
    "bollard": "Putih bulat dengan reflektor oranye/putih",
    "pole": "Tiang beton silinder dengan lubang melingkar atau penyangga A",
    "plate": "Plat putih strip biru EU, format 2 huruf - 4 angka",
    "lines": "Garis tepi putih putus-putus panjang",
    "tips": "Huruf diakritik ā, ē, ī, ū, č, ģ, ķ, ļ, ņ, š, ž. Jalan tanah liat merah/pasir."
},
"LT": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".lt",
    "bollard": "Putih reflektor merah/oranye depan, putih belakang",
    "pole": "Tiang beton trapesium/silinder Soviet",
    "plate": "Plat putih strip biru EU, stiker uji emisi bulat di tengah",
    "lines": "Garis tepi putih solid atau putus-putus",
    "tips": "Huruf ą, č, ę, ė, į, š, ų, ū, ž. Akhiran nama kota/jalan -as, -is, -us."
},
"GB": {
    "drive": "Kiri",
    "cam": "Gen 2/3/4",
    "domain": ".uk/.co.uk",
    "bollard": "Reflektor merah belakang/kiri, putih depan",
    "pole": "Tiang kayu tebal dengan plat logam strip kuning bertuliskan nomor",
    "plate": "Plat PUTIH di depan, KUNING di belakang",
    "lines": "Garis zigzag putih di penyeberangan jalan, garis tepi kuning ganda",
    "tips": "Setir KIRI. Huruf 'Give Way' di jalan, arsitektur bata merah, jalan sempit berpagar tanaman."
},
"IE": {
    "drive": "Kiri",
    "cam": "Gen 3/4",
    "domain": ".ie",
    "bollard": "Silinder putih dengan reflektor putih/merah",
    "pole": "Tiang kayu sering ada kotak sekring trafo kecil",
    "plate": "Plat putih depan & belakang dengan strip biru EU dan nama county Gaelic di atas",
    "lines": "Garis tepi kuning putus-putus (khas Irlandia!), garis tengah putih",
    "tips": "Rambu dwibahasa Inggris & Gaelic (tulisan miring). Pagar batu khas bukit hijau."
},
"FR": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".fr",
    "bollard": "Putih bulat silinder dengan tutup atas miring putih (chapeau blanc)",
    "pole": "Tiang kayu dengan fitting logam melengkung ke atas / tiang beton berpola tangga",
    "plate": "Plat strip biru di KEDUA ujung (kiri bendera EU, kanan logo region)",
    "lines": "Garis tepi putih putus-putus panjang (interval 13m)",
    "tips": "Tanda panah rambu panah berujung lancip. Kode jalan D (Departementale) & N (Nationale)."
},
"DE": {
    "drive": "Kanan",
    "cam": "Gen 4 (banyak Blur/Gen 3 lama)",
    "domain": ".de",
    "bollard": "Putih dengan strip miring hitam tebal & reflektor putih panjang",
    "pole": "Sangat sedikit tiang listrik (kabel bawah tanah), jika ada tiang kayu gelap",
    "plate": "Plat putih strip EU kiri dengan segel bulat Bundesland di tengah",
    "lines": "Garis tepi putih solid, garis tengah putih putus-putus",
    "tips": "Banyak rumah diblur privasi (khas Jerman). Tanda jalan kotak biru dengan font DIN 1451."
},
"NL": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".nl",
    "bollard": "Hitam reflektor merah / merah-putih",
    "pole": "Hampir semua kabel tertanam di bawah tanah",
    "plate": "Plat KUNING depan dan belakang dengan strip EU biru",
    "lines": "Garis hijau di tengah jalan (jalan 100km/h), lajur sepeda merah bata",
    "tips": "Paving blok bata merah di trotoar/jalan, sangat tertata rapi, kanal air, kincir."
},
"BE": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".be",
    "bollard": "Putih reflektor merah/oranye",
    "pole": "Lampu jalan tiang beton tinggi melengkung di jalan tol",
    "plate": "Plat putih dengan teks dan bingkai warna MERAH HATI (Burgundy/Crimson)",
    "lines": "Garis tepi putih solid",
    "tips": "Kualitas aspal lebih kasar dari Belanda. Bahasa Prancis (selatan) & Belanda (utara)."
},
"ES": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".es",
    "bollard": "Putih dengan reflektor kuning/oranye vertikal",
    "pole": "Tiang beton persegi dengan lubang silang/tangga atau tiang kayu",
    "plate": "Plat putih strip biru EU kiri",
    "lines": "Garis tepi putih solid, garis tengah putih",
    "tips": "Pagar pembatas jalan berkaki bulat. Pohon zaitun, tanah merah kering, huruf ñ."
},
"PT": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".pt",
    "bollard": "Putih reflektor persegi panjang",
    "pole": "Tiang beton berongga tangga (ladder poles) khas Semenanjung Iberia",
    "plate": "Plat strip biru EU di kiri (mobil lama ada strip kuning di kanan)",
    "lines": "Garis tepi putih, garis tengah putih",
    "tips": "Huruf ã, õ, ç. Rumah berkeramik (azulejos), trotoar batu mosaik kecil hitam-putih."
},
"IT": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".it",
    "bollard": "Putih dengan strip hitam atas dan reflektor oranye depan, putih belakang",
    "pole": "Tiang kayu gelap dengan isolator atau beton silang",
    "plate": "Plat DEPAN KECIL (khas Italia!) dan strip biru di kedua sisi",
    "lines": "Garis tepi putih solid, garis tengah putih",
    "tips": "Plat depan pendek/mini adalah kunci instan Italia. Pohon cemara pensil (cypress)."
},
"CH": {
    "drive": "Kanan",
    "cam": "Gen 3/4 (Low Cam)",
    "domain": ".ch",
    "bollard": "Putih dengan reflektor strip vertikal hitam",
    "pole": "Tiang kayu bersih dengan isolator logam",
    "plate": "Plat depan kecil, plat belakang ada lambang kanton & bendera Swiss",
    "lines": "Garis kuning di tempat penyeberangan pejalan kaki (zebra cross kuning khas!)",
    "tips": "Kamera agak rendah (Low Cam). Rambu warna biru/hijau terbalik (Tol hijau, utama biru)."
},
"AT": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".at",
    "bollard": "Putih melengkung atas dengan reflektor merah di dalam lekukan",
    "pole": "Tiang kayu tunggal atau beton",
    "plate": "Plat putih strip biru EU dengan lambang negara bagian Austria di tengah, bingkai merah",
    "lines": "Garis tepi putih solid",
    "tips": "Pegunungan Alpen, rumah kayu chalet dengan bunga di jendela. Mirip Jerman tapi tidak diblur."
},
"PL": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".pl",
    "bollard": "Putih dengan strip MERAH vertikal tebal dan reflektor (khas Polandia!)",
    "pole": "Tiang beton bulat berlubang-lubang lingkaran sepanjang tiang (khas Polandia!)",
    "plate": "Plat putih strip biru EU kiri",
    "lines": "Garis tepi putih solid / putus-putus",
    "tips": "Tiang listrik berlubang lingkaran = 100% Polandia. Huruf ł, ą, ę, ś, ć, ż, ź."
},
"CZ": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".cz",
    "bollard": "Putih reflektor oranye depan, putih belakang dengan leher hitam",
    "pole": "Tiang beton dengan sambungan palang besi",
    "plate": "Plat putih strip biru EU, huruf kedua adalah kode region (misal: B=Brno, A=Praha)",
    "lines": "Garis tepi putih solid",
    "tips": "Huruf ř, ů, ě, č, š, ž. Tanda belokan panah hitam di atas latar putih berbingkai merah."
},
"SK": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".sk",
    "bollard": "Putih reflektor oranye depan, putih belakang",
    "pole": "Tiang beton persegi Soviet",
    "plate": "Plat putih strip biru EU dengan lambang salib ganda Slovakia",
    "lines": "Garis tepi putih solid",
    "tips": "Huruf ä, ô, ĺ, ŕ, č, š, ž. Arsitektur kastil dan pegunungan Tatra."
},
"HU": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".hu",
    "bollard": "Putih reflektor merah/oranye depan, putih belakang",
    "pole": "Tiang beton berlubang persegi panjang atau silinder",
    "plate": "Plat putih strip biru EU",
    "lines": "Garis tepi putih putus-putus",
    "tips": "Huruf ő, ű (garis kutip dua miring), á, é, í, ó, ú. Nama jalan berakhiran 'utca' atau 'út'."
},
"RO": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".ro",
    "bollard": "Putih reflektor oranye depan, merah belakang",
    "pole": "Tiang beton bercat putih di bagian bawah (khas pedesaan Rumania!)",
    "plate": "Plat putih strip biru EU",
    "lines": "Garis tepi putih solid",
    "tips": "Pangkal tiang dicat putih. Huruf ă, â, î, ș, ț. Rumah dengan cerobong asap seng lancip."
},
"BG": {
    "drive": "Kanan",
    "cam": "Gen 3 (Winter Cam)",
    "domain": ".bg",
    "bollard": "Putih reflektor merah/oranye",
    "pole": "Tiang beton persegi Soviet",
    "plate": "Plat putih strip biru EU",
    "lines": "Garis tengah putih, tepi putih",
    "tips": "Aksara Kiril (Cyrillic) dengan plat EU. Banyak kamera musim dingin (Winter Cam berdaun gugur)."
},
"GR": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".gr",
    "bollard": "Putih reflektor merah belakang, putih depan",
    "pole": "Tiang kayu dengan sambungan isolator porselen bulat",
    "plate": "Plat putih strip biru EU",
    "lines": "Garis tengah putih solid ganda, sering jalan berbatu putih",
    "tips": "Aksara Yunani (Greek: Ω, Σ, Δ, Φ, Γ). Pohon zaitun, tanah tandus berkapur, gereja berkubah biru."
},
"TR": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".tr",
    "bollard": "Putih dengan reflektor strip vertikal merah",
    "pole": "Tiang kisi baja besi segitiga atau beton silinder",
    "plate": "Plat putih strip biru kiri (tanpa lambang bintang EU, hanya TR)",
    "lines": "Garis tengah putih putus-putus panjang, tepi putih",
    "tips": "Huruf ı (i tanpa titik), ğ, ş, ç, ö, ü. Masjid dengan menara pensil lancip di tiap desa."
},
"HR": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".hr",
    "bollard": "Putih reflektor merah/oranye",
    "pole": "Tiang beton silinder atau kayu",
    "plate": "Plat putih strip biru EU dengan lambang catur merah-putih Kroasia di tengah",
    "lines": "Garis tepi putih solid",
    "tips": "Pesisir pantai berbatu Laut Adriatik, pohon pinus pantai, atap genteng merah terakota."
},
"RS": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".rs",
    "bollard": "Putih reflektor merah",
    "pole": "Tiang beton Soviet",
    "plate": "Plat putih strip biru kiri lambang SRB",
    "lines": "Garis tengah putih",
    "tips": "Dwibahasa: Aksara Latin & Kiril secara bersamaan di rambu petunjuk jalan."
},
"UA": {
    "drive": "Kanan",
    "cam": "Gen 2/3 (Kamera bergaris merah)",
    "domain": ".ua",
    "bollard": "Putih strip hitam bawah dan reflektor merah",
    "pole": "Tiang beton Soviet sering dicat putih di bawah",
    "plate": "Plat putih strip bendera Ukraina biru-kuning di kiri",
    "lines": "Garis tengah putih",
    "tips": "Aksara Kiril dengan huruf khas: і, ї, є (tidak ada di bahasa Rusia). Mobil Google ada antena merah."
},
"RU": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".ru",
    "bollard": "Putih dengan strip miring hitam dan reflektor",
    "pole": "Tiang beton tebal Soviet",
    "plate": "Plat putih dengan kode region 2-3 angka di kanan dan bendera Rusia kecil di bawahnya",
    "lines": "Garis tengah putih / kuning di beberapa wilayah",
    "tips": "Aksara Kiril (huruf ы, э, ъ). Pipa gas kuning menyilang di atas jalan perumahan."
},
"JP": {
    "drive": "Kiri",
    "cam": "Gen 3/4 (Low Cam)",
    "domain": ".jp",
    "bollard": "Tiang putih dengan reflektor bundar/strip oranye dan stiker kuning",
    "pole": "Tiang beton bulat bertingkat dengan pijakan besi panjat dan plat nomor kuning",
    "plate": "Plat PUTIH (pribadi besar), KUNING (kei car mini), HIJAU (komersial)",
    "lines": "Garis tengah KUNING, garis tepi putih solid",
    "tips": "Setir KIRI. Kamera rendah (Low Cam). Tulisan Kanji/Hiragana/Katakana. Cermin cembung tikungan."
},
"KR": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".kr",
    "bollard": "Silinder putih dengan strip reflektor oranye/kuning",
    "pole": "Tiang beton silinder dengan strip nomor kuning/hitam bergradasi",
    "plate": "Plat putih panjang dengan aksara Hangul di tengah",
    "lines": "Garis tengah kuning ganda, garis tepi putih solid",
    "tips": "Aksara Hangul (kotak & lingkaran). Rambu nomor rute berbentuk oval biru atau perisai."
},
"TW": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".tw",
    "bollard": "Putih reflektor oranye",
    "pole": "Bagian bawah tiang dicat STRIP KUNING-HITAM diagonal miring (khas Taiwan!)",
    "plate": "Plat putih format ABC-1234 atau 123-AB",
    "lines": "Garis tengah kuning ganda",
    "tips": "Garis kuning-hitam di tiang listrik = 99% Taiwan. Aksara Hanzi Tradisional."
},
"HK": {
    "drive": "Kiri",
    "cam": "Gen 3/4",
    "domain": ".hk",
    "bollard": "Bollard bergaya kolonial Inggris",
    "pole": "Tiang lampu jalan hijau tua / abu-abu bergaya Inggris",
    "plate": "Plat PUTIH di depan, KUNING di belakang (seperti Inggris)",
    "lines": "Garis jalan gaya Inggris, tulisan 'SLOW' atau 'LOOK LEFT' di aspal",
    "tips": "Setir KIRI. Dwibahasa Inggris & Kanton tradisional. Gedung pencakar langit super rapat."
},
"SG": {
    "drive": "Kiri",
    "cam": "Gen 3/4",
    "domain": ".sg",
    "bollard": "Bollard hitam-putih reflektor merah",
    "pole": "Tiang lampu hijau tua rapi dengan tanaman rambat terawat",
    "plate": "Plat HITAM dengan teks putih (depan) dan plat KUNING/HITAM (belakang)",
    "lines": "Garis tepi putih putus-putus, garis tengah putih ganda",
    "tips": "Setir KIRI. Kota sangat hijau, bersih, modern, rambu bahasa Inggris formal."
},
"ID": {
    "drive": "Kiri",
    "cam": "Gen 3/4",
    "domain": ".id",
    "bollard": "Patok batas jalan hitam-putih zebra",
    "pole": "Tiang beton bulat dengan 3 kabel paralel atau tiang baja melengkung",
    "plate": "Plat HITAM teks putih (mobil baru putih teks hitam) dengan masa berlaku pajak",
    "lines": "Garis tengah kuning putus-putus / solid, garis tepi putih",
    "tips": "Setir KIRI. Bahasa Indonesia (Jl., Gg., RT/RW, Warung, Indomaret/Alfamart, SPBU Pertamina)."
},
"MY": {
    "drive": "Kiri",
    "cam": "Gen 3/4",
    "domain": ".my",
    "bollard": "Putih dengan reflektor merah",
    "pole": "Tiang beton persegi atau tiang hitam dengan nomor putih vertikal",
    "plate": "Plat HITAM teks putih di depan dan belakang tanpa garis bulan/tahun pajak",
    "lines": "Garis tengah putih putus-putus tebal, garis tepi putih solid",
    "tips": "Setir KIRI. Rambu 'JALAN', 'BERHENTI', 'IKUT KIRI'. Nomor rute jalan di dalam kotak kuning."
},
"TH": {
    "drive": "Kiri",
    "cam": "Gen 3/4",
    "domain": ".th",
    "bollard": "Tonggak beton tebal putih bulat atau patok kilometer besar bertuliskan angka Thai",
    "pole": "Tiang listrik PERSEGI BERONGGA 4 LUBANG (khas Thailand!)",
    "plate": "Plat putih teks hitam dengan aksara Thai (plat kuning = komersial/truk)",
    "lines": "Garis tengah kuning ganda atau putus-putus",
    "tips": "Setir KIRI. Aksara Thai bulat berlekuk. Tiang listrik berlubang persegi = kunci Thailand."
},
"PH": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".ph",
    "bollard": "Patok semen putih dengan kilometer penanda",
    "pole": "Tiang kayu/beton penuh kabel semrawut bergaya Amerika Serikat",
    "plate": "Plat putih strip hijau di bawah (mobil lama) atau plat putih bersih",
    "lines": "Garis tengah kuning, garis tepi putih",
    "tips": "Satu-satunya negara Asia Tenggara berkendara di KANAN yang pakai bahasa Inggris/Tagalog. Jeepney, tricycle."
},
"KH": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".kh",
    "bollard": "Patok beton merah-putih",
    "pole": "Tiang beton bulat Soviet",
    "plate": "Plat putih strip biru-merah dengan aksara Khmer di atas",
    "lines": "Garis tengah kuning putus-putus",
    "tips": "Aksara Khmer (berlekuk tajam dengan topi). Berkendara di sisi KANAN. Tanah berpasir kemerahan."
},
"BD": {
    "drive": "Kiri",
    "cam": "Gen 3/4",
    "domain": ".bd",
    "bollard": "Patok beton merah-putih atau hitam-putih",
    "pole": "Tiang beton atau baja dengan palang melengkung",
    "plate": "Plat hijau dengan teks Bengali (CNG/taksi) atau hitam/putih",
    "lines": "Garis tengah putih/kuning jarang ada",
    "tips": "Setir KIRI. Aksara Bengali (garis horizontal di atas huruf). Becak rickshaw warna-warni."
},
"LK": {
    "drive": "Kiri",
    "cam": "Gen 3/4",
    "domain": ".lk",
    "bollard": "Patok beton putih dengan ujung hitam",
    "pole": "Tiang beton cor kasar dengan banyak lubang kecil",
    "plate": "Plat putih depan, kuning belakang dengan huruf provinsi kecil di kiri (misal WP = Western Province)",
    "lines": "Garis tengah putih putus-putus",
    "tips": "Setir KIRI. Aksara Sinhala (bulat seperti apel/lingkaran) & Tamil. Pohon kelapa lebat."
},
"BT": {
    "drive": "Kiri",
    "cam": "Gen 3/4",
    "domain": ".bt",
    "bollard": "Patok beton merah-putih",
    "pole": "Tiang kayu di jalan pegunungan",
    "plate": "Plat MERAH TEKS PUTIH (khas Bhutan!)",
    "lines": "Garis tengah putih jarang",
    "tips": "Setir KIRI. Plat merah = 100% Bhutan! Pegunungan Himalaya, arsitektur kayu berukir ornamen naga."
},
"MN": {
    "drive": "Kanan",
    "cam": "Gen 3 (Mobil Camping / Tenda Merah)",
    "domain": ".mn",
    "bollard": "Sangat jarang ada bollard",
    "pole": "Tiang beton silinder dengan kabel kendur",
    "plate": "Plat putih aksara Kiril",
    "lines": "Hampir tidak ada garis jalan di padang rumput",
    "tips": "Mobil Google bawa tenda merah / bagasi camping di atap (Roof Rack khas Mongolia). Padang rumput stepa luas."
},
"KG": {
    "drive": "Kanan",
    "cam": "Gen 3 (Roof Rack besi khas)",
    "domain": ".kg",
    "bollard": "Patok semen putih bergaris hitam miring",
    "pole": "Tiang beton persegi Soviet",
    "plate": "Plat putih dengan bendera Kirgizstan (matahari kuning pada latar merah) di kiri",
    "lines": "Garis tengah putih",
    "tips": "Mobil Google punya roof rack besi di atap. Pegunungan bersalju Tian Shan. Aksara Kiril."
},
"AU": {
    "drive": "Kiri",
    "cam": "Gen 2/3/4",
    "domain": ".au/.com.au",
    "bollard": "Putih dengan reflektor MERAH di kiri, PUTIH di kanan (khas Australia)",
    "pole": "Tiang kayu tebal alami (sering pohon eukaliptus tanpa dihaluskan)",
    "plate": "Plat putih/kuning beragam tergantung negara bagian",
    "lines": "Garis tengah putih putus-putus, garis tepi putih solid",
    "tips": "Setir KIRI. Tanah merah kering (outback), pohon eucalyptus/gum tree, rambu peringatan kanguru/wombat."
},
"NZ": {
    "drive": "Kiri",
    "cam": "Gen 2/3/4",
    "domain": ".nz/.co.nz",
    "bollard": "Putih reflektor merah di sisi kiri, putih di kanan dengan strip merah melingkar penuh di tiang",
    "pole": "Tiang beton berongga atau tiang kayu dengan nomor putih vertikal",
    "plate": "Plat putih bersih tanpa strip biru format ABC123",
    "lines": "Garis tengah putih putus-putus atau kuning ganda di tanjakan/tikungan",
    "tips": "Setir KIRI. Bukit hijau berumput sangat subur, pohon pakis perak (silver fern), tiang reflektor strip penuh."
},
"US": {
    "drive": "Kanan",
    "cam": "Gen 2/3/4",
    "domain": ".com/.us",
    "bollard": "Bollard jarang di jalan raya, reflektor kuning/putih di pagar besi",
    "pole": "Tiang kayu gelap dengan kabel kusut & trafo kaleng silinder",
    "plate": "Plat belakang wajib, plat pendek format negara bagian (motif warna-warni khas tiap state)",
    "lines": "Garis tengah KUNING (putus-putus untuk salip, solid ganda dilarang salip), tepi putih",
    "tips": "Tanda 'SPEED LIMIT', rambu kuning belah ketupat, kotak pos di pinggir jalan, truk pikap besar."
},
"CA": {
    "drive": "Kanan",
    "cam": "Gen 2/3/4",
    "domain": ".ca",
    "bollard": "Tiang kayu dengan reflektor hijau/oranye",
    "pole": "Tiang kayu mirip AS dengan trafo silinder",
    "plate": "Plat nomor tiap provinsi (Quebec bahasa Prancis, Ontario putih biru, NW Territories bentuk beruang)",
    "lines": "Garis tengah kuning, garis tepi putih",
    "tips": "Rambu kecepatan bertuliskan 'MAXIMUM' (bukan Speed Limit), satuan km/h, daun maple."
},
"MX": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".mx",
    "bollard": "Tonggak beton putih dengan reflektor oranye",
    "pole": "Tiang beton persegi dengan lubang silang atau tiang kayu",
    "plate": "Plat nomor dengan desain grafis negara bagian Meksiko di latar belakang",
    "lines": "Garis tengah putih (sering kali putih di jalan tol) atau kuning",
    "tips": "Tanda 'ALTO' untuk stop sign (bukan STOP/PARE). Tiang lampu jalan bercat putih di bawah. Pohon kaktus."
},
"BR": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".br",
    "bollard": "Patok beton putih dengan reflektor merah",
    "pole": "Tiang beton bertingkat dengan tangga pijakan (Ladder Pole khas Brazil!)",
    "plate": "Plat Mercosur strip biru di atas atau plat abu-abu lama",
    "lines": "Garis tengah kuning solid ganda, garis tepi putih",
    "tips": "Punggung rambu lalu lintas dicat HITAM di belakangnya! Bahasa Portugis (Rua, Rodovia, Posto). Tanah merah."
},
"AR": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".ar",
    "bollard": "Putih reflektor oranye",
    "pole": "Tiang beton atau tiang kayu tipis",
    "plate": "Plat hitam lama teks putih atau plat Mercosur strip biru tengah titik putih",
    "lines": "Garis tengah kuning putus-putus, tepi putih",
    "tips": "Punggung rambu lalu lintas TIDAK dicat hitam (polos seng abu-abu). Pohon poplar/pampa datar luas."
},
"CL": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".cl",
    "bollard": "Putih reflektor oranye/merah",
    "pole": "Tiang beton silinder atau kayu, sering ada stiker garis putih-hitam di tiang",
    "plate": "Plat putih polos huruf hitam format 4 huruf 2 angka (tanpa strip biru)",
    "lines": "Garis tengah putih di jalan tol, kuning di jalan pedesaan",
    "tips": "Garis putih jalan tol sangat terawat. Pegunungan Andes menjulang tinggi di sisi timur."
},
"CO": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".co",
    "bollard": "Patok putih reflektor merah",
    "pole": "Tiang beton silinder dengan isolator pin ganda",
    "plate": "Plat KUNING CERAH untuk mobil pribadi dan plat putih untuk taksi/publik",
    "lines": "Garis tengah kuning, garis tepi putih",
    "tips": "Hampir semua mobil pribadi berplat KUNING! Gunung hijau tropis sangat terjal, pohon kopi/bambu."
},
"PE": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".pe",
    "bollard": "Patok beton garis diagonal hitam-putih",
    "pole": "Tiang beton dengan sambungan palang T kayu atau beton",
    "plate": "Plat putih strip bendera Peru di kiri atas atau strip kuning di atas",
    "lines": "Garis tengah kuning ganda",
    "tips": "Punggung rambu lalu lintas dicat KUNING-HITAM diagonal! Bukit pasir gersang pantai atau pegunungan Andes."
},
"EC": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".ec",
    "bollard": "Putih strip merah",
    "pole": "Tiang beton persegi Soviet/Amerika Latin",
    "plate": "Plat putih strip bendera Ekuador kecil di atas",
    "lines": "Garis tengah kuning, garis tepi putih",
    "tips": "Rambu nomor jalan raya nasional ada gambar burung Kondor (khas Ekuador). Pegunungan hijau vulkanik."
},
"BO": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".bo",
    "bollard": "Batu pembatas putih",
    "pole": "Tiang kayu tipis atau beton kasar",
    "plate": "Plat putih dengan strip bendera Bolivia di kiri atas",
    "lines": "Garis tengah kuning putus-putus",
    "tips": "Dataran tinggi Altiplano gersang, bangunan bata merah tanpa plester/semen luar."
},
"UY": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".uy",
    "bollard": "Patok kayu/beton putih reflektor merah",
    "pole": "Tiang beton bulat dengan tiang segitiga",
    "plate": "Plat Mercosur strip biru atas dengan tulisan URUGUAY",
    "lines": "Garis tengah putih/kuning",
    "tips": "Sangat datar dan berumput hijau, jalanan tenang, pohon palem Capitata (Palmar de Castillos)."
},
"ZA": {
    "drive": "Kiri",
    "cam": "Gen 2/3/4",
    "domain": ".za/.co.za",
    "bollard": "Reflektor merah/putih",
    "pole": "Tiang kayu dengan palang isolator logam",
    "plate": "Plat putih/kuning tergantung provinsi (Gauteng putih biru, Western Cape putih hitam)",
    "lines": "Garis tepi KUNING dan garis tengah PUTIH (kebalikan dari AS!)",
    "tips": "Setir KIRI. Garis tepi jalan warna KUNING = khas Afrika Selatan. Rambu font DIN 1451."
},
"BW": {
    "drive": "Kiri",
    "cam": "Gen 3/4",
    "domain": ".bw",
    "bollard": "Patok kayu/beton reflektor merah",
    "pole": "Tiang kayu tebal",
    "plate": "Plat biru muda/putih depan dan kuning belakang",
    "lines": "Garis tepi kuning, garis tengah putih",
    "tips": "Setir KIRI. Sangat datar dan kering (Gurun Kalahari). Pohon akasia berduri, keledai liar di jalan."
},
"KE": {
    "drive": "Kiri",
    "cam": "Gen 3 (Mobil Snorkel Hitam)",
    "domain": ".ke",
    "bollard": "Patok beton putih ujung hitam",
    "pole": "Tiang kayu kasar alami",
    "plate": "Plat putih depan, kuning belakang (mirip Inggris)",
    "lines": "Garis tengah kuning putus-putus",
    "tips": "Setir KIRI. Mobil Google punya pipa SNORKEL HITAM di pilar depan kanan! Tanah merah marun."
},
"UG": {
    "drive": "Kiri",
    "cam": "Gen 3 (Mobil Spion Putih)",
    "domain": ".ug",
    "bollard": "Patok putih ujung merah",
    "pole": "Tiang kayu",
    "plate": "Plat putih depan dan belakang",
    "lines": "Garis tengah kuning",
    "tips": "Setir KIRI. Mobil Google terlihat kap depan putih atau spion putih. Bukit sangat hijau subur dan lembap."
},
"GH": {
    "drive": "Kanan",
    "cam": "Gen 3 (Roof Rack Lakban Hitam)",
    "domain": ".gh",
    "bollard": "Patok beton merah-putih",
    "pole": "Tiang kayu",
    "plate": "Plat kuning/putih format GT-1234",
    "lines": "Garis tengah kuning",
    "tips": "Roof rack mobil Google diikat LAKBAN HITAM tebal di salah satu kakinya! Bahasa Inggris."
},
"NG": {
    "drive": "Kanan",
    "cam": "Gen 3 (Mobil Polisi Pengawal)",
    "domain": ".ng",
    "bollard": "Bollard jarang",
    "pole": "Tiang beton bulat",
    "plate": "Plat putih teks biru/hijau",
    "lines": "Garis tengah kuning",
    "tips": "Sering terlihat mobil polisi patroli pengawal (Police Escort Car) di depan atau belakang mobil Google."
},
"SN": {
    "drive": "Kanan",
    "cam": "Gen 3 (Roof Rack Palang)",
    "domain": ".sn",
    "bollard": "Patok semen putih",
    "pole": "Tiang beton",
    "plate": "Plat nomor BIRU TUA dengan teks putih (khas Senegal!)",
    "lines": "Garis tengah putih",
    "tips": "Plat warna BIRU TUA. Pohon Baobab raksasa, pasir pantai Sahara, bahasa Prancis & Wolof."
},
"IL": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".il",
    "bollard": "Putih dengan strip hitam dan reflektor oranye",
    "pole": "Tiang beton bulat tebal dengan kotak logam",
    "plate": "Plat KUNING TERANG dengan strip biru EU palsu di kiri (khas Israel!)",
    "lines": "Garis tengah putih putus-putus ganda, trotoar cat merah-putih/biru-putih",
    "tips": "Aksara Ibrani (Hebrew). Plat kuning terang di semua mobil sipil. Trotoar belang merah-putih."
},
"AE": {
    "drive": "Kanan",
    "cam": "Gen 3/4",
    "domain": ".ae",
    "bollard": "Reflektor modern",
    "pole": "Tiang lampu jalan super megah dan tinggi",
    "plate": "Plat putih teks hitam dengan tulisan emirate (Dubai, Abu Dhabi)",
    "lines": "Garis tengah kuning, tepi putih",
    "tips": "Jalan tol lebar 6-8 lajur sangat mulus, gurun pasir bersih, mobil mewah, dwibahasa Arab-Inggris."
},
"JO": {
    "drive": "Kanan",
    "cam": "Gen 3 (Roof Rack Hitam tebal)",
    "domain": ".jo",
    "bollard": "Patok putih reflektor oranye",
    "pole": "Tiang beton silinder",
    "plate": "Plat putih pendek format 2 angka - 5 angka",
    "lines": "Garis putih putus-putus",
    "tips": "Mobil Google beratap roof rack hitam tebal. Bukit bebatuan gurun cokelat kemerahan, aksara Arab."
},
"TN": {
    "drive": "Kanan",
    "cam": "Gen 3 (Roof Rack tanpa bar)",
    "domain": ".tn",
    "bollard": "Patok putih dengan ujung merah",
    "pole": "Tiang beton Soviet",
    "plate": "Plat HITAM TEKS PUTIH dengan tulisan bahasa Arab 'تونس' di tengah (khas Tunisia!)",
    "lines": "Garis tengah putih",
    "tips": "Satu-satunya negara Arab di Afrika Utara dengan Street View resmi penuh. Plat hitam tulisan Arab 'Tunisia'."
}
};

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
    panel.style.top = "64px";
    panel.style.right = "16px";
    panel.style.width = "360px";
    panel.style.maxWidth = "calc(100vw - 32px)";
    panel.style.maxHeight = "calc(100vh - 90px)";
    panel.style.zIndex = "2147483640";
    panel.style.background = "rgba(10, 15, 29, 0.95)";
    panel.style.backdropFilter = "blur(16px)";
    panel.style.webkitBackdropFilter = "blur(16px)";
    panel.style.border = "1px solid rgba(56, 189, 248, 0.35)";
    panel.style.borderRadius = "14px";
    panel.style.boxShadow = "0 12px 36px rgba(0, 0, 0, 0.75), 0 0 20px rgba(56, 189, 248, 0.15)";
    panel.style.color = "#f8fafc";
    panel.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    panel.style.fontSize = "12.5px";
    panel.style.lineHeight = "1.5";
    panel.style.overflowY = "auto";
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
    const countryCode = (globalPlace.countryCode || "").toUpperCase();
    const state = globalPlace.state || "";
    const flag = getFlagEmoji(countryCode);
    const slug = getPlonkitSlug(country, countryCode);
    const plonkitUrl = slug ? ("https://www.plonkit.net/" + slug) : "https://www.plonkit.net";
    const clue = countryCode ? (GEO_CLUES[countryCode] || null) : null;

    if (autoSyncPlonkit && slug && slug !== lastRenderedSlug) {
        lastRenderedSlug = slug;
        if (plonkitCompanionWindow && !plonkitCompanionWindow.closed) {
            try {
                plonkitCompanionWindow.location.href = plonkitUrl;
            } catch (_) {}
        }
    }

    let cluesHtml = "";
    if (clue) {
        const driveIsLeft = clue.drive && clue.drive.toLowerCase().includes("kiri");
        const driveBadgeColor = driveIsLeft ? "#f59e0b" : "#38bdf8";
        const driveBg = driveIsLeft ? "rgba(245, 158, 11, 0.15)" : "rgba(56, 189, 248, 0.15)";
        const driveBorder = driveIsLeft ? "rgba(245, 158, 11, 0.35)" : "rgba(56, 189, 248, 0.35)";

        cluesHtml = `
            <!-- Quick Badges Strip -->
            <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px;">
                <div style="background: ${driveBg}; border: 1px solid ${driveBorder}; color: ${driveBadgeColor}; padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 11px;">
                    🚗 Lajur: ${clue.drive}
                </div>
                <div style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); color: #cbd5e1; padding: 3px 8px; border-radius: 6px; font-size: 11px;">
                    📷 ${clue.cam || "Gen 3/4"}
                </div>
                <div style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); color: #38bdf8; font-family: monospace; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600;">
                    🌐 ${clue.domain || ("." + countryCode.toLowerCase())}
                </div>
            </div>

            <!-- Clue Details List -->
            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px;">
                ${clue.bollard ? `
                    <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 8px 10px;">
                        <div style="font-weight: 700; color: #38bdf8; font-size: 11px; margin-bottom: 2px;">🪧 BOLLARD & REFLEKTOR</div>
                        <div style="color: #e2e8f0; font-size: 12px;">${clue.bollard}</div>
                    </div>
                ` : ""}

                ${clue.plate ? `
                    <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 8px 10px;">
                        <div style="font-weight: 700; color: #38bdf8; font-size: 11px; margin-bottom: 2px;">🚘 PLAT NOMOR</div>
                        <div style="color: #e2e8f0; font-size: 12px;">${clue.plate}</div>
                    </div>
                ` : ""}

                ${clue.pole ? `
                    <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 8px 10px;">
                        <div style="font-weight: 700; color: #38bdf8; font-size: 11px; margin-bottom: 2px;">🪵 TIANG LISTRIK</div>
                        <div style="color: #e2e8f0; font-size: 12px;">${clue.pole}</div>
                    </div>
                ` : ""}

                ${clue.lines ? `
                    <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 8px 10px;">
                        <div style="font-weight: 700; color: #38bdf8; font-size: 11px; margin-bottom: 2px;">🛣️ MARKA JALAN</div>
                        <div style="color: #e2e8f0; font-size: 12px;">${clue.lines}</div>
                    </div>
                ` : ""}

                ${clue.tips ? `
                    <div style="background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; padding: 8px 10px;">
                        <div style="font-weight: 700; color: #38bdf8; font-size: 11px; margin-bottom: 2px;">💡 PETUNJUK KUNCI (META)</div>
                        <div style="color: #f1f5f9; font-size: 12px;">${clue.tips}</div>
                    </div>
                ` : ""}
            </div>
        `;
    } else if (country) {
        cluesHtml = `
            <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 12px; margin-bottom: 12px; text-align: center;">
                <div style="color: #cbd5e1; font-size: 12px; margin-bottom: 4px;">Panduan ringkas langsung di Plonkit:</div>
                <div style="font-family: monospace; color: #38bdf8; font-size: 12px;">plonkit.net/${slug}</div>
            </div>
        `;
    }

    panel.innerHTML = `
        <div style="padding: 12px 14px; background: rgba(56, 189, 248, 0.08); border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; background: rgba(10, 15, 29, 0.98); z-index: 2;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 22px; line-height: 1;">${flag}</span>
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
            ${country ? `
                ${cluesHtml}

                <div style="margin-bottom: 10px;">
                    <button id="__adguards_open_companion" style="width: 100%; background: #0284c7; border: none; color: #ffffff; font-weight: 600; font-size: 12px; padding: 9px 14px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: background 0.15s; box-shadow: 0 2px 8px rgba(2, 132, 199, 0.4);">
                        <span>📖 Buka Foto & Panduan Plonkit (Jendela Samping)</span>
                    </button>
                </div>

                <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: #94a3b8; cursor: pointer;">
                    <input type="checkbox" id="__adguards_autosync_cb" ${autoSyncPlonkit ? "checked" : ""} style="cursor: pointer; accent-color: #38bdf8;">
                    <span>Auto-sync jendela pendamping saat ronde berganti</span>
                </label>
            ` : `
                <div style="text-align: center; padding: 20px 8px; color: #94a3b8;">
                    <div style="font-size: 26px; margin-bottom: 8px;">🧭</div>
                    <div style="font-size: 13px; font-weight: 600; color: #cbd5e1; margin-bottom: 4px;">Menunggu Lokasi Ronde...</div>
                    <div style="font-size: 11.5px; color: #64748b; line-height: 1.5;">Clue otomatis muncul di sini begitu Street View memuat koordinat negara.</div>
                </div>
            `}
        </div>
        <div style="padding: 6px 14px 10px; font-size: 10px; color: #64748b; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.04);">
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
