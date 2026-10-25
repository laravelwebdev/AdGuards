Setelah menelusuri langsung ke dalam bundle JavaScript resmi GeoGuessr (Next.js chunks) serta menguji langsung endpoint API-nya menggunakan sesi login Anda, berikut adalah hasil pengujian lengkap mengenai request fetch yang dieksekusi dan cara GeoGuessr memunculkan clue tersebut ke layar:

1. fetch Apa yang Dilakukan Saat Tombol Diklik?
Ketika tombol "Detect all clues" atau sistem clue diaktifkan pada akhir ronde, frontend GeoGuessr mengeksekusi request ke API v4 resmi GeoGuessr:

A. Fetch Clue Spesifik Panorama
http
GET https://www.geoguessr.com/api/v4/clues/{panoId}
Fungsi: Mengambil data penanda visual (bounding coordinates, heading, pitch) untuk objek petunjuk yang ada di panorama Street View tempat ronde tersebut berlangsung.
B. Fetch Clue Negara Target
http
GET https://www.geoguessr.com/api/v4/clues/country/{countryCode}?count=5
Fungsi: Mengambil daftar petunjuk khas negara tersebut dari database edukasi resmi GeoGuessr.
Contoh Data JSON Asli yang Dikembalikan Server: (Hasil uji coba langsung pada ronde Prancis fr dan Brasil br akun Anda):
json
[
  {
    "id": "fr-road-sign-borders-01",
    "countryCode": "FR",
    "countryName": "France",
    "category": "country",
    "type": "road-signs",
    "title": "Road Sign Borders",
    "description": "Regulatory signs have a red border with a narrow white outline; white sub-signs with black text often attached below.",
    "imagePath": "clueimage/a92328ae797a2aa683d41ba81e408c87.jpg",
    "complexity": 2
  },
  {
    "id": "br-blue-kilometre-markers-01",
    "countryCode": "BR",
    "countryName": "Brazil",
    "category": "country",
    "type": "road-signs",
    "title": "Blue Kilometre Markers",
    "description": "Small blue roadside posts show the route number and current kilometre.",
    "imagePath": "clueimage/9131773f64de2d07e296beb506c04e8f.jpg",
    "complexity": 3
  }
]
C. Fetch Perbandingan (Comparison)
http
GET https://www.geoguessr.com/api/v4/clues/{panoId}/comparison?target={guessedCountry}
Fungsi: Jika tebakan Anda salah (misalnya Anda menebak Spanyol padahal lokasinya di Prancis), API ini mengembalikan komparasi mengapa lokasi tersebut adalah Prancis dan bukan Spanyol.
2. Bagaimana GeoGuessr Memunculkan Clue-nya di Layar?
Berdasarkan modul React resmi GeoGuessr (static/chunks/65867 dan static/chunks/14295), GeoGuessr memunculkannya melalui 3 tahap UI:

mermaid
flowchart TD
    A[Klik 'Detect All Clues' / Toggle Clues] --> B[Fetch Data /api/v4/clues]
    B --> C[1. React Portal Membuka Panorama Street View]
    C --> D[2. Pin Marker 3D di Koordinat Objek]
    C --> E[3. Render Kartu / Bubble Edukasi Iris AI]
Re-mount Street View via React Portal (clue-focus_slot): GeoGuessr membuka kembali tampilan 360° Street View di jendela hasil ronde melalui komponen clue-focus_map.
Menempelkan Marker Icon (clueMarker & clueMarkerIcon): Komponen clueMarkerPos dan clueTitleOverlay menempelkan ikon penanda (SVG clue-icon.4ba29c8e.svg) langsung di atas objek di Street View (misalnya tepat di atas tiang listrik atau marka jalan yang menjadi petunjuk).
Kartu & Bubble Penjelasan (iris-message-bubble): Di bagian bawah/samping layar, asisten AI GeoGuessr (Iris) menampilkan kartu berisi:
Tipe petunjuk: road-signs, license-plates, architecture, language, dll.
Gambar contoh: https://www.geoguessr.com/images/auto/128/128/ce/0/plain/{imagePath}
Deskripsi & Complexity level: Panduan teks cara membedakan petunjuk tersebut.
