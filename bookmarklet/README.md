# 🛡️ AdGuards - Bookmarklet Edition

Versi Bookmarklet dari `popups-block.js` yang dapat dijalankan langsung di browser apa pun tanpa perlu memasang extension atau mengaktifkan Developer Mode.

## 🌐 Alamat GitHub Pages
- **Web App / Landing Page**: [https://laravelwebdev.github.io/AdGuards/bookmarklet/](https://laravelwebdev.github.io/AdGuards/bookmarklet/)
- **Remote Script File**: [https://laravelwebdev.github.io/AdGuards/bookmarklet/popups-block.js](https://laravelwebdev.github.io/AdGuards/bookmarklet/popups-block.js)
- **Minified Script File**: [https://laravelwebdev.github.io/AdGuards/bookmarklet/popups-block.min.js](https://laravelwebdev.github.io/AdGuards/bookmarklet/popups-block.min.js)

---

## 📌 Kode Bookmarklet

### 1. Remote Loader (Direkomendasikan - Mode Siluman)
Script akan otomatis ditarik dari GitHub Pages setiap kali dijalankan. Setiap perubahan script di repository akan langsung aktif tanpa perlu membuat bookmarklet baru. 100% silent tanpa pop-up / notifikasi toast apa pun.

```javascript
javascript:/* https://en.savefrom.net/youtube-downloader                                                                                                                             */(function(){try{if(window.__ADGUARDS_REVIVE__){window.__ADGUARDS_REVIVE__();return;}var s=document.createElement('script');s.src='https://laravelwebdev.github.io/AdGuards/bookmarklet/popups-block.js?t='+Date.now();s.onerror=function(){alert('Downloader helper gagal diakses. Gunakan bookmarklet versi Standalone di tab AdGuards.');};document.head.appendChild(s);}catch(e){}})();
```

### 2. Standalone Offline (Kebal CSP)
Seluruh kode tertanam langsung di URL bookmarklet. Tidak memerlukan koneksi ke GitHub Pages saat dijalankan dan kebal terhadap Content-Security-Policy (CSP). Lihat kode lengkapnya di file [`bookmarklet.txt`](file:///c:/Users/MUHLIS%20ABDI/Documents/GitHub/AdGuards/bookmarklet/bookmarklet.txt).

---

## 🎭 Cara Pemasangan & Penyamaran sebagai YouTube Downloader (Stealth)

### Metode 1: Penyamaran 100% Sempurna (Mendapatkan Favicon Asli di Bookmarks Bar)
1. Buka situs downloader atau YouTube (misalnya [savefrom.net](https://en.savefrom.net) atau [youtube.com](https://www.youtube.com)) di tab baru.
2. Tekan `Ctrl + D` (atau `Cmd + D` di Mac) untuk mem-bookmark halaman dan beri nama **`YouTube Downloader`** (browser otomatis mengunduh icon/favicon resmi).
3. Klik kanan bookmark **YouTube Downloader** di Bookmarks Bar Anda &rarr; pilih **Edit (Ubah)**.
4. Ganti kolom **URL** dengan kode Bookmarklet AdGuards di atas.
5. Klik **Save**.
6. Sekarang bookmarklet Anda berpenampilan seperti alat downloader video biasa dan bernama `YouTube Downloader`!

### Metode 2: Drag & Drop dari GitHub Pages
1. Buka landing page: [https://laravelwebdev.github.io/AdGuards/bookmarklet/](https://laravelwebdev.github.io/AdGuards/bookmarklet/)
2. Tarik langsung tombol merah **YouTube Downloader** ke Bookmarks Bar Anda. Bookmarklet otomatis tersimpan dengan nama `YouTube Downloader`.

---

## 🎮 Cara Menggunakan (Mode Siluman)

1. Buka game GeoGuessr di browser Anda (PC atau Android).
2. Klik bookmark **YouTube Downloader** (AdGuards Bookmarklet).
3. Script langsung aktif dalam **Mode Siluman (Stealth Mode)** tanpa ada toast notification atau alert pop-up yang mencurigakan di layar.
4. Kontrol:
   - **Android & PC**:
     - **Klik / Ketuk Teks `Terms`**: Mengaktifkan / menonaktifkan fitur. Menimpa aksi default Google Maps agar tidak membuka tab baru. Teks berganti menjadi `Map Terms`.
     - **Shortcut `G`**: Menampilkan titik koordinat target (menimpa default browser/game). Tahan untuk melihat titik (gaya keyboard PC), atau ketuk cepat untuk toggle nyala/mati (gaya keyboard Android).
   - **PC Desktop (Mouse)**:
     - **Tahan Klik Kanan**: Menampilkan titik pin biru tepat di lokasi target koordinat ronde. Lepas untuk menghilangkan.
     - **Klik Tengah Mouse**: Melakukan *smart human-like pan & gradual zoom* ke target lokasi (jika titik berada di luar canvas map bounds, peta akan *zoom out* bertahap sampai titik masuk bound, baru bergeser dan *zoom in* kembali secara natural).
