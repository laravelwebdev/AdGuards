/**
 * AdGuards - Popups & Geo Tracker Bookmarklet Script
 * Hosted via GitHub Pages: https://laravelwebdev.github.io/AdGuards/bookmarklet/popups-block.js
 * Repo: https://github.com/laravelwebdev/AdGuards
 *
 * Jalankan via Bookmarklet browser tanpa memerlukan ekstensi.
 */

(function () {
    "use strict";

    // Mencegah script dijalankan dobel jika bookmarklet diklik lebih dari sekali (Mode Siluman - Silent)
    if (window.__ADGUARDS_POPUPS_BLOCK_ACTIVE__) {
        return;
    }
    window.__ADGUARDS_POPUPS_BLOCK_ACTIVE__ = true;

    // =================== Notification Toast (Mode Siluman) ===================
    // Dikosongkan agar murni Mode Siluman tanpa ada notifikasi/toast apa pun di layar
    function showAdGuardsToast() {}
    window.__ADGUARDS_SHOW_TOAST__ = showAdGuardsToast;

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
    let isRightMouseDown = false;
    let currentAttachedDiv = null;

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
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        if (
            method && method.toUpperCase() === "POST" && typeof url === "string" &&
            (url.startsWith("https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetMetadata") ||
             url.startsWith("https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/SingleImageSearch"))
        ) {
            this.addEventListener("load", function () {
                const interceptedResult = this.responseText;
                if (!interceptedResult) return;
                const pattern = /-?\d+\.\d+,-?\d+\.\d+/g;
                const countryPattern = /"[A-Z]{2}"/g;
                const statePattern = /"([^"]+?)"\s*,\s*"en"\s*\](?!\s*,)/;

                const match = interceptedResult.match(pattern)?.[0];
                if (!match) return;

                const [lat, lng] = match.split(",").map(Number);
                if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

                checkGameReset();

                // 1. Cek jika koordinat ini adalah ronde yang sudah selesai dimainkan sebelumnya
                if (isAlreadyPlayed(lat, lng)) {
                    return;
                }

                // 2. Deteksi transisi ronde (jarak > 500m dari ronde aktif saat ini menandakan ronde baru)
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
                    try {
                        globalPlace.country = new Intl.DisplayNames(["en"], { type: "region" }).of(countryMatch.replace(/"/g, ""));
                    } catch (_) {}
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
        if (!newHint || newHint.trim() === "" || newHint.length < 2) return false;
        const current = location.hash ? location.hash.substring(1) : "";
        if (!current || current.length < 2) return true;
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
        if (isMapValid(foundMap)) {
            attachMapListeners();
            return;
        }

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

    // MutationObserver memantau DOM agar saat ronde baru me-remount map, otomatis re-bind
    const mapObserver = new MutationObserver(() => {
        if (!isMapValid(foundMap)) {
            scanForMap();
        }
    });
    if (document.body) {
        mapObserver.observe(document.body, { childList: true, subtree: true });
    }

    // Jalankan scan segera jika document sudah siap
    if (document.readyState === "complete" || document.readyState === "interactive") {
        scanForMap();
    } else {
        window.addEventListener("load", () => scanForMap());
    }

    // =================== Event Listeners Rebind Management ===================
    let touchTimer = null;
    let touchStartPos = { x: 0, y: 0 };
    let isTouching = false;
    let lastTouchEndTime = 0;

    function handleMapTouchStart(e) {
        if (!dotAdded || !isMapValid(foundMap)) return;
        if (e.touches && e.touches.length > 1) {
            if (touchTimer) clearTimeout(touchTimer);
            return;
        }

        const touch = e.touches[0];
        touchStartPos = { x: touch.clientX, y: touch.clientY };
        isTouching = true;

        // Double-tap: Human Pan and Zoom (pengganti Klik Tengah di Android)
        const now = Date.now();
        if (now - lastTouchEndTime < 300) {
            if (touchTimer) clearTimeout(touchTimer);
            lastTouchEndTime = 0;
            if (globalCoordinates.lat && globalCoordinates.lng) {
                humanPanAndZoom(foundMap, globalCoordinates.lat, globalCoordinates.lng);
            }
            return;
        }

        // Long Press: Tahan ~350ms untuk lihat titik (pengganti Klik Kanan di Android)
        if (touchTimer) clearTimeout(touchTimer);
        touchTimer = setTimeout(() => {
            if (isTouching && dotAdded && globalCoordinates.lat && globalCoordinates.lng) {
                isRightMouseDown = true;
                showMarkerAt(globalCoordinates.lat, globalCoordinates.lng);
            }
        }, 350);
    }

    function handleMapTouchMove(e) {
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
    }

    function handleMapTouchEnd() {
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
    }

    function attachMapListeners() {
        if (!isMapValid(foundMap)) return;
        const targetEl = foundMap.getDiv();
        if (!targetEl || targetEl === currentAttachedDiv) return;

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

        targetEl.addEventListener("wheel", handleWheelZoom, { passive: false });
        targetEl.addEventListener("mousedown", handleMouseDown);
        targetEl.addEventListener("mouseup", handleMouseUp);
        targetEl.addEventListener("mouseleave", handleMouseLeave);
        targetEl.addEventListener("contextmenu", handleContextMenu);

        // Touch listener khusus Android / touchscreen
        targetEl.addEventListener("touchstart", handleMapTouchStart, { passive: true });
        targetEl.addEventListener("touchmove", handleMapTouchMove, { passive: true });
        targetEl.addEventListener("touchend", handleMapTouchEnd, { passive: true });
        targetEl.addEventListener("touchcancel", handleMapTouchEnd, { passive: true });
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
        if (!isMapValid(map) || isNaN(targetLat) || isNaN(targetLng)) return;

        stopCurrentAction();

        const startCenter = map.getCenter();
        if (!startCenter) return;

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
        }

        currentPanAnimId = requestAnimationFrame(panFrame);
    }

    function stepZoomPerlahan(map, targetLat, targetLng, targetZoom, offsetX, offsetY) {
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
    }

    // =================== Wheel Zoom Handler ===================
    function handleWheelZoom(e) {
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
    }

    // =================== Mouse Click Handlers ===================
    function handleMouseDown(e) {
        if (!isMapValid(foundMap)) return;

        // Klik Tengah (Geser Dulu, Lalu Zoom Perlahan)
        if (e.button === 1 && dotAdded) {
            e.preventDefault();
            e.stopPropagation();
            if (globalCoordinates.lat && globalCoordinates.lng) {
                humanPanAndZoom(foundMap, globalCoordinates.lat, globalCoordinates.lng);
            }
            return;
        }

        // Klik Kanan (Tampilkan Titik Marker Target)
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

    // =================== Marker Management ===================
    function showMarkerAt(lat, lng) {
        if (!isMapValid(foundMap) || !lat || !lng) return;

        clearMarker();
        if (!isRightMouseDown) return;

        // Prioritas google.maps.Marker bawaan
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
                        scale: 2,
                        fillColor: "#0088ff",
                        fillOpacity: 1.0,
                        strokeColor: "#ffffff",
                        strokeWeight: 1,
                    }
                });
                return;
            }
        } catch (err) {
            console.warn("[AdGuards] google.maps.Marker fallback:", err);
        }

        // Fallback ke AdvancedMarkerElement jika didukung
        try {
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
        } catch (err) {
            console.error("[AdGuards] AdvancedMarkerElement gagal:", err);
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
    }

    // =================== Terms Interceptor (Aktivasi / Deaktivasi) ===================
    function isTermsElement(target) {
        if (!target) return false;
        const a = target.closest ? target.closest("a") : (target.tagName === "A" ? target : null);
        if (!a) return false;
        const text = (a.textContent || "").trim();
        const href = (a.getAttribute("href") || "").toLowerCase();
        return text.includes("Terms") || text.includes("Map Terms") || text.includes("Persyaratan") || href.includes("terms_maps") || href.includes("help/terms");
    }

    function syncTermsText() {
        const links = Array.from(document.querySelectorAll("a")).filter(isTermsElement);
        links.forEach(link => {
            // Hapus atribut link agar browser TIDAK BISA membuka halaman Google sama sekali (di Android & PC)
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
        });
    }

    function handleTermsTrigger(e) {
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
    }

    // Capture di window & document agar mendahului listener Google Maps
    window.addEventListener("click", handleTermsTrigger, true);
    window.addEventListener("touchend", handleTermsTrigger, true);
    window.addEventListener("pointerdown", handleTermsTrigger, true);
    document.addEventListener("click", handleTermsTrigger, true);
    document.addEventListener("touchend", handleTermsTrigger, true);
    document.addEventListener("pointerdown", handleTermsTrigger, true);

    // =================== PC Keyboard Listener (Tekan G untuk Aktifkan) ===================
    document.addEventListener("keydown", (e) => {
        const key = e.key ? e.key.toLowerCase() : "";

        // Tekan 'G' untuk MENGAKTIFKAN fitur (Terms berubah jadi Map Terms)
        if (key === "g") {
            dotAdded = true;
            syncTermsText();
        } else if (key !== " " && !isRightMouseDown) {
            // Tekan tombol selain spasi untuk MEMATIKAN fitur (Map Terms kembali jadi Terms)
            dotAdded = false;
            syncTermsText();
            clearMarker();
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
        syncTermsText();
        dismissPartyModalIfNeeded();
    }, 1000);
})();
