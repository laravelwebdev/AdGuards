            return "🌍";
        }
    }

    // =================== Translation Cache & Resolver (GeoGuessr i18n) ===================
    const translationCache = {};

    function formatFallbackClueKey(key) {
        if (!key || typeof key !== "string") return "";
        if (!key.startsWith("clue.")) return key;
        let clean = key.replace(/^clue\./, "");
        clean = clean.replace(/-(title|description)$/, "");
        clean = clean.replace(/^[a-z]{2}-/, "");
        clean = clean.replace(/[-_]/g, " ");
        clean = clean.replace(/\b\w/g, c => c.toUpperCase());
        return clean.trim();
    }

    function resolveTranslation(key) {
        if (!key || typeof key !== "string") return Promise.resolve("");
        if (!key.startsWith("clue.")) return Promise.resolve(key);
        if (translationCache[key]) return Promise.resolve(translationCache[key]);

        return fetch("/api/v3/translations/key/" + encodeURIComponent(key), { credentials: "omit" })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data && Array.isArray(data.phrases) && data.phrases.length > 0) {
                    const en = data.phrases.find(p => p.language === "en" || p.locale === "en_US") || data.phrases[0];
                    if (en && en.phrase) {
                        translationCache[key] = en.phrase;
                        return en.phrase;
                    }
                }
                const fallback = formatFallbackClueKey(key);
                translationCache[key] = fallback;
                return fallback;
            })
            .catch(() => {
                const fallback = formatFallbackClueKey(key);
                translationCache[key] = fallback;
                return fallback;
            });
    }

    function getClueText(key, defaultText) {
        if (!key) return defaultText || "";
        if (!key.startsWith("clue.")) return key;
        if (translationCache[key]) return translationCache[key];
        resolveTranslation(key).then(() => {
            if (plonkitActive && typeof updatePlonkitUI === "function") {
                updatePlonkitUI();
            }
        });
        return formatFallbackClueKey(key);
    }

    function fetchZoomedImage(pano, clue) {
        if (!pano || !clue) return Promise.resolve(null);
        if (clue.image && (clue.image.startsWith("http") || clue.image.startsWith("data:"))) {
            return Promise.resolve(clue.image);
        }
        let query = "";
        if (typeof clue.heading === "number") {
            query = "heading=" + encodeURIComponent(clue.heading) +
                    "&pitch=" + encodeURIComponent(clue.pitch || 0) +
                    "&fov=" + encodeURIComponent(clue.fov || 60);
        } else if (clue.cell) {
            query = "cell=" + encodeURIComponent(clue.cell);
        } else {
            return Promise.resolve(null);
        }

        return fetch("/api/v4/game-analysis/zoomed-image/" + encodeURIComponent(pano) + "?" + query, { credentials: "include" })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                const img = data?.payload?.image || data?.image || null;
                if (img) {
                    clue.image = img;
                }
                return img;
            })
            .catch(() => null);
    }

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
        // 1. Fetch official GeoGuessr country educational clues (/api/v4/clues/country/{countryCode}?count=8)
        if (cc) {
            tasks.push(
                fetch("/api/v4/clues/country/" + encodeURIComponent(cc) + "?count=8", { credentials: "include" })
                    .then(res => res.ok ? res.json() : null)
                    .then(data => {
                        let list = [];
                        if (Array.isArray(data)) {
                            list = data;
                        } else if (data && Array.isArray(data.clues)) {
                            list = data.clues;
                        }
                        cachedGeoGuessrClues.countryClues = list;
                        list.forEach(item => {
                            if (item.title && item.title.startsWith("clue.")) resolveTranslation(item.title);
                            if (item.description && item.description.startsWith("clue.")) resolveTranslation(item.description);
                        });
                    })
                    .catch(() => {})
            );
        }

        // 2. Fetch official GeoGuessr panorama-specific visual clues (/api/v4/clues/{panoId})
        if (pano) {
            tasks.push(
                fetch("/api/v4/clues/" + encodeURIComponent(pano), { credentials: "include" })
                    .then(res => res.ok ? res.json() : null)
                    .then(async data => {
                        let list = [];
                        if (Array.isArray(data)) {
                            list = data;
                        } else if (data && Array.isArray(data.clues)) {
                            list = data.clues;
                        }

                        // Fallback to scout-clues if empty
                        if (list.length === 0) {
                            try {
                                const scoutRes = await fetch("/api/v4/game-analysis/scout-clues/" + encodeURIComponent(pano), { credentials: "include" });
                                if (scoutRes.ok) {
                                    const scoutData = await scoutRes.json();
                                    const payload = scoutData?.payload || scoutData;
                                    if (Array.isArray(payload)) list = payload;
                                    else if (Array.isArray(payload?.clues)) list = payload.clues;
                                }
                            } catch (_) {}
                        }

                        cachedGeoGuessrClues.panoClues = list;

                        const subTasks = [];
                        list.forEach(item => {
                            if (item.title && item.title.startsWith("clue.")) {
                                subTasks.push(resolveTranslation(item.title));
                            }
                            if (item.description && item.description.startsWith("clue.")) {
                                subTasks.push(resolveTranslation(item.description));
                            }
                            if (!item.image && (typeof item.heading === "number" || item.cell)) {
                                subTasks.push(fetchZoomedImage(pano, item));
                            }
                        });
                        if (subTasks.length > 0) {
                            await Promise.all(subTasks);
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

function getCountrySlug(countryName, countryCode) {
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