# 🛡️ AdGuards - Bookmarklet Edition

Versi Bookmarklet dari `popups-block.js` yang dapat dijalankan langsung di browser apa pun tanpa perlu memasang extension atau mengaktifkan Developer Mode.

## 🌐 Alamat GitHub Pages
- **Web App / Landing Page**: [https://laravelwebdev.github.io/AdGuards/bookmarklet/](https://laravelwebdev.github.io/AdGuards/bookmarklet/)
- **Remote Script File**: [https://laravelwebdev.github.io/AdGuards/bookmarklet/popups-block.js](https://laravelwebdev.github.io/AdGuards/bookmarklet/popups-block.js)
- **Minified Script File**: [https://laravelwebdev.github.io/AdGuards/bookmarklet/popups-block.min.js](https://laravelwebdev.github.io/AdGuards/bookmarklet/popups-block.min.js)

---

## 📌 Kode Bookmarklet

### 1. Remote Loader (Direkomendasikan)
Script akan otomatis ditarik dari GitHub Pages setiap kali dijalankan. Setiap perubahan script di repository akan langsung aktif tanpa perlu membuat bookmarklet baru.

```javascript
javascript:(function(){if(window.__ADGUARDS_POPUPS_BLOCK_ACTIVE__){if(typeof window.__ADGUARDS_SHOW_TOAST__==='function'){window.__ADGUARDS_SHOW_TOAST__('AdGuards sudah aktif di tab ini!','info');}else{alert('AdGuards sudah aktif!');}return;}var s=document.createElement('script');s.src='https://laravelwebdev.github.io/AdGuards/bookmarklet/popups-block.js?t='+Date.now();s.onload=function(){console.log('[AdGuards] Remote script loaded');};document.head.appendChild(s);})();
```

### 2. Standalone Offline (Kebal CSP)
Seluruh kode tertanam langsung di URL bookmarklet. Tidak memerlukan koneksi ke GitHub Pages saat dijalankan dan kebal terhadap Content-Security-Policy (CSP). Lihat kode lengkapnya di file [`bookmarklet.txt`](file:///c:/Users/MUHLIS%20ABDI/Documents/GitHub/AdGuards/bookmarklet/bookmarklet.txt).

---

## 🎭 Cara Pemasangan & Penyamaran sebagai YouTube (Stealth)

### Metode 1: Penyamaran 100% Sempurna (Mendapatkan Favicon Asli Merah YouTube)
1. Buka situs [youtube.com](https://www.youtube.com) di tab baru.
2. Tekan `Ctrl + D` (atau `Cmd + D` di Mac) untuk mem-bookmark YouTube (browser otomatis mengunduh icon resmi YouTube).
3. Klik kanan bookmark YouTube di Bookmarks Bar Anda &rarr; pilih **Edit (Ubah)**.
4. Ganti kolom **URL** dengan kode Bookmarklet AdGuards di atas.
5. Klik **Save**.
6. Sekarang bookmarklet Anda berlogo resmi YouTube dan bernama `YouTube`!

### Metode 2: Drag & Drop dari GitHub Pages
1. Buka landing page: [https://laravelwebdev.github.io/AdGuards/bookmarklet/](https://laravelwebdev.github.io/AdGuards/bookmarklet/)
2. Tarik langsung tombol merah **YouTube** ke Bookmarks Bar Anda.

---

## 🎮 Cara Menggunakan

1. Buka game GeoGuessr di browser Anda.
2. Saat ronde dimulai, klik bookmark **🛡️ AdGuards** di Bookmarks Bar.
3. Notifikasi toast akan muncul di pojok kanan atas: `🛡️ AdGuards Bookmarklet Aktif!`.
4. Kontrol:
   - **Tekan `G`**: Mengaktifkan bantuan titik (`Terms` berubah menjadi `Map Terms`).
   - **Klik Tengah Mouse**: Melakukan *human-like pan & gradual zoom* ke target lokasi.
   - **Tahan Klik Kanan**: Menampilkan titik biru (marker) tepat di koordinat ronde.
   - **Scroll + Tahan Tombol Tengah**: Zoom cepat terfokus ke target koordinat.
