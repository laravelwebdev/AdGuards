let globalCoordinates = JSON.parse(localStorage.getItem("globalCoordinates")) || { lat: 0, lng: 0 };
let globalPlace = JSON.parse(localStorage.getItem("globalPlace")) || { country: "", state: "" };

let mode = "text"

let savedMap = null;
let currentMarker = null;

function saveCoordinates() {
    localStorage.setItem("globalCoordinates", JSON.stringify(globalCoordinates));
    localStorage.setItem("globalPlace", JSON.stringify(globalPlace));
}

function extractLatLng(url) {
        try {
            let u = new URL(url, window.location.origin);
            let lat = u.searchParams.get("lat");
            let lng = u.searchParams.get("long");
            if (lat && lng) {
            globalCoordinates.lat = parseFloat(lat);
            globalCoordinates.lng = parseFloat(lng);
            reverseGeocode(lat, lng).then(place => {
                globalPlace.country = place.country;
                globalPlace.state = place.state;
            });
            saveCoordinates();
            }
        } catch (e) {
            // bukan URL valid
        }
    }

    // tunggu iframe muncul dulu
function initObserver() {
    let container = document.body; // kalau tahu parent spesifik iframe, ganti ke parent tsb
    if (!container) return false;

    // observer untuk mendeteksi penambahan/penghapusan anak (iframe baru)
    const containerObserver = new MutationObserver(() => {
        let iframe = document.querySelector("iframe.svframe");
        if (iframe && !iframe.dataset.observed) {
            iframe.dataset.observed = "true";
            observeIframe(iframe);
        }
    });

    containerObserver.observe(container, { childList: true, subtree: true });

    // cek awal, kalau iframe sudah ada
    let iframe = document.querySelector("iframe.svframe");
    if (iframe && !iframe.dataset.observed) {
        iframe.dataset.observed = "true";
        observeIframe(iframe);
    }

    return true;
}

function observeIframe(iframe) {
    const obs = new MutationObserver(muts => {
        for (let m of muts) {
            if (m.type === "attributes" && m.attributeName === "src") {
              if (currentMarker) {
                // hapus marker lama
                savedMap.removeLayer(currentMarker);
                currentMarker = null;       
            }  
                extractLatLng(m.target.src);
            }
        }
    });

    obs.observe(iframe, { attributes: true });
    extractLatLng(iframe.src); // panggil sekali waktu baru ditemukan
}

// tunggu sampai halaman siap lalu mulai
let interval = setInterval(() => {
    if (initObserver()) {
        clearInterval(interval);
    }
}, 500);
        function hookLeaflet() {

        if (typeof L !== "undefined" && typeof L.Map === "function") {
            const OriginalMap = L.Map;

            L.Map = function(...args) {
                const map = new OriginalMap(...args);

                // Simpan map instance untuk digunakan saat klik tengah
                savedMap = map;

                return map;
            };

            L.Map.prototype = OriginalMap.prototype;
            L.Map.prototype.constructor = L.Map;
        }
    }

    // ----------------- Tunggu Leaflet siap -----------------
    const intervalLeaflet = setInterval(() => {
        if (typeof L !== "undefined" && typeof L.Map === "function") {
            clearInterval(intervalLeaflet);
            hookLeaflet();
        }
    }, 500);



// ====================================Splash Function====================================

function showSplash(message) {
    let splash = document.getElementById("geoguessr-splash");
    if (!splash) {
        splash = document.createElement("div");
        splash.id = "geoguessr-splash";
        splash.style.position = "fixed";
        splash.style.bottom = "0px";
        splash.style.right = "0px";
        splash.style.background = "rgba(0, 0, 0, 0.9)";
        splash.style.color = "#fff";
        splash.style.padding = "2px 5px";
        splash.style.borderRadius = "1px";
        splash.style.fontSize = "8px";
        splash.style.zIndex = "9999";
        splash.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
        splash.style.maxWidth = "600px";
        splash.style.wordWrap = "break-word";
        splash.style.pointerEvents = "none";
        document.body.appendChild(splash);
    }

    splash.innerText = message;
    splash.style.opacity = "1";
    splash.style.transition = "opacity 0.5s ease";

    setTimeout(() => {
        splash.style.opacity = "0";
        setTimeout(() => {
            if (splash && splash.parentNode) {
                splash.parentNode.removeChild(splash);
            }
        }, 500);
    }, 3000);
}

function speak(text, lang) {
    const msg = new SpeechSynthesisUtterance(text);
    msg.lang = lang;
    window.speechSynthesis.speak(msg);
}  

// ====================================Popup Map Function====================================

function showMapPopup(lat = 0, lng = 0) {
    
 if (!savedMap) return; // Map belum siap

        if (currentMarker) {
                // hapus marker lama
                savedMap.removeLayer(currentMarker);
                currentMarker = null;       
            } else {
                currentMarker = L.circleMarker(
                    [lat, lng],
                    { radius: 1, color: 'green', fillColor: 'green', fillOpacity: 1 }
                ).addTo(savedMap);

                // pastikan marker terlihat
                savedMap.setView([lat, lng], savedMap.getZoom());
            }
}

function showHint() {
    let { country, state } = globalPlace;
    if (mode === "voice") {
        speak(`${country}, ${state}`, "id-ID");
    } else {
        showSplash(`${country}, ${state}`);
    }
}

async function reverseGeocode(lat, lng) {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
    const data = await res.json();

    if (data.address?.country_code === 'id') {
        return {
            country: data.address.state || "Tidak diketahui",
            state: data.address.county || data.address.city || data.address.town || "Tidak diketahui"
        };
    } else {
        return {
            country: data.address?.country || "Tidak diketahui",
            state: data.address?.state || data.address?.county || data.address?.city || data.address?.town || "Tidak diketahui"
        };
    }
}


// ====================================Keybind====================================
let onKeyDown = (e) => {
    if (e.key === "Control") {
        e.stopImmediatePropagation();
        mode = (mode === "voice") ? "text" : "voice";
        showSplash("Mode:" + mode);
    }

};

window.addEventListener("contextmenu", function(e) {
    e.preventDefault();
     showHint();
});

window.addEventListener("auxclick", function(e) {
    if (e.button === 1) {
        e.preventDefault();        
        showMapPopup(globalCoordinates.lat, globalCoordinates.lng);
    }
});

window.addEventListener("keydown", onKeyDown);

