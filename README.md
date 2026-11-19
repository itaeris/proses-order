# Proses order

Dashboard antrian gudang untuk order Shopify yang sudah dibayar dan belum terpenuhi. Order dikelompokkan ke Indocolite, Biteship, atau DHL. Label, packing, dan validasi resi dicatat di sini. Resi Indocolite, Biteship, dan DHL bisa dibuat dari halaman order.

Kurir tidak boleh ditandai siap pickup sebelum checklist kurir selesai dan nomor resi divalidasi.

Token Shopify hanya dibaca di server. Status proses disimpan di Supabase, terpisah dari data order, supaya sync tidak menghapus langkah yang sudah dikerjakan.

## Alur

Sync menarik order dengan filter Shopify: pembayaran **Paid**, fulfillment **Unfulfilled** atau **Partial**, status **Open**. Sync jalan sekitar setiap 2 menit, dan bisa dipaksa lewat tombol Segarkan. Order yang sudah fulfilled keluar dari antrian.

Channel diisi otomatis:

- Negara kirim selain Indonesia, atau metode kirim yang mengandung `DHL`, masuk DHL.
- Domestik mengikuti tab **Metode kirim**. Awalnya JNE, Lion, Ninja, SiCepat, J&T, dan Anteraja masuk Biteship. POS masuk Indocolite.
- Yang tidak cocok tetap di **Perlu dipilih** sampai seseorang memilih channel.

Memilih channel secara manual mengunci order itu. Mengganti channel mengulang langkah kurir dan membatalkan validasi resi. Menyimpan metode kirim hanya menggeser order yang masih di antrian dan belum dikunci.

Dua jalur harus selesai:

1. **Gudang:** print label, packing, lalu validasi resi. Nomor resi dari Shopify hanya isian awal. Petugas tetap harus menandai resi itu valid, dan hanya setelah packing selesai.
2. **Kurir,** berupa checklist:
   - Indocolite harus dipilih dulu, manual atau otomatis. Manual: antrian lalu pengiriman manual. Otomatis: antrian, form pengiriman, lalu konfirmasi.
   - Biteship: antrian, kirim pesanan, import dari Shopify, lanjut pembayaran, bayar.
   - DHL: antrian, lalu print dan close.

**Siap pickup** hanya menyala kalau channel sudah ditunjuk, checklist kurir selesai, packing selesai, dan resi sudah divalidasi.

Order Indocolite mode otomatis bisa dibuatkan resi dari panel detail lewat API Pakeet, memakai tarif termurah dari kurir yang sudah dipilih di Shopify. Kalau kurir itu tidak ada di Pakeet, yang dipakai tarif termurah dari semua kurir yang tersedia. Channel tidak bisa diganti dari sini. Tombol Manual memakai tarif termurah dari semua kurir. Gudang asal dibaca dari `.env`. Kelurahan gudang dan penerima dipilih otomatis dari kode pos. Saldo dompet Pakeet terpotong saat resi dibuat. Pickup tetap tombol terpisah. Berat paket memakai `PAKEET_DEFAULT_WEIGHT_KG` karena Shopify tidak mengirim berat barang.

Order Biteship memakai API yang sama polanya. Ongkir dihitung dari kode pos gudang dan penerima. Kurir mengikuti Shopify, dan yang dipakai tarif termurah dari kurir itu. Kalau tarifnya tidak ada, yang dipakai tarif termurah dari semua kurir. Manual juga memakai tarif termurah dari semua kurir. Saldo dompet tampil di panel. Tombol Buat resi membuat resi dan memotong saldo itu. Nomor resi mengisi checklist kurir sampai langkah bayar. Validasi resi di gudang tetap terpisah. Isi `BITESHIP_API_KEY`. Alamat gudang dan berat paket memakai variabel `PAKEET_SENDER_*` dan `PAKEET_DEFAULT_WEIGHT_KG`.

Order DHL memakai MyDHL API. Ongkir dihitung dari alamat gudang dan penerima, lalu yang dipakai produk termurah. Tombol Buat resi membuat kiriman di akun DHL dan menyimpan nomor resi. Label PDF bisa diunduh dari kartu yang sama. Pickup tidak diajukan otomatis. Validasi resi di gudang tetap terpisah. Isi `DHL_API_KEY`, `DHL_API_SECRET`, dan `DHL_ACCOUNT_NUMBER`. Alamat gudang dan berat paket memakai variabel `PAKEET_SENDER_*` dan `PAKEET_DEFAULT_WEIGHT_KG`.

Order yang lewat batas kirim, atau sudah lebih dari 24 jam dan belum siap pickup, ditandai terlambat. Antrian bawaan menyembunyikan order yang sudah siap pickup.

Antrian hanya terbuka setelah masuk. Admin pertama adalah `it@aerisbeaute.com`. Nama, email, nomor, dan kata sandi bisa diganti dari menu Pengaturan, dan admin bisa menambah serta mengubah pengguna dari menu yang sama. Nama petugas mengikuti akun yang sedang masuk. Tombol Proses dan validasi resi tercatat atas nama itu. Klik baris order membuka halaman `/manage-order` untuk order itu, bukan panel samping.

## Menjalankan

Perlu Node.js 22.

```bash
npm install
npm run dev
```

Buka http://127.0.0.1:5173. API berjalan di http://127.0.0.1:8787.

Tanpa kredensial Shopify, dashboard memakai data contoh. Tanpa tabel Supabase, API menolak permintaan sampai skema dijalankan.

`npm run build` membuat `client/dist`. `npm start` menjalankan server, yang juga menyajikan hasil build itu.

## Menyambungkan Shopify

1. Buat app di Dev Dashboard. Matikan "Embed app in Shopify admin". App URL boleh `https://shopify.dev/apps/default-app-home`.
2. Scopes: `read_orders`, `read_fulfillments`, `read_merchant_managed_fulfillment_orders`. Release versinya, lalu pasang app ke toko yang sama.
3. Salin `.env.example` menjadi `.env` di root proyek, sejajar dengan `package.json`. `SHOPIFY_SHOP` adalah subdomain toko, tanpa `.myshopify.com`.

```bash
SHOPIFY_SHOP=nama-toko
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
SHOPIFY_API_VERSION=2026-10
PORT=8787
SYNC_INTERVAL_MS=120000
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=
```

4. Jalankan ulang `npm run dev`, lalu tekan Segarkan. Server menukar client ID dan secret dengan access token, lalu memperbaruinya sebelum 24 jam habis.

## Supabase

Jalankan `server/src/schema.sql` sekali di SQL Editor project. Publishable key cukup untuk aplikasi ini karena kebijakan tabel mengizinkan peran itu. Isi `SUPABASE_SECRET_KEY` hanya kalau tabel dikunci dari akses anon. Server memakai secret key itu bila ada.

Saat pertama kali tabel masih kosong dan file SQLite lama ada di `data/`, server menyalin order dan status proses ke Supabase. Penyalinan itu hanya jalan di mesin lokal.

## Vercel

Root proyek ini satu project Vercel dengan dua service: `client` (halaman Vite, publik di `/`) dan `server` (Express, publik di `/api`). Keduanya tertulis di `vercel.json`. Dashboard memanggil `/api` dari browser lewat domain yang sama, jadi tidak ada binding internal antar service. Variabel di `.env.example` diisi di pengaturan Environment Variables, bukan lewat file `.env`.

Di Vercel tidak ada proses yang hidup terus, jadi sync tiap 2 menit hanya berlaku untuk `npm run dev`. Di sana sync jalan saat fungsi pertama kali bangun, lewat tombol Segarkan, dan lewat Cron sekali sehari pada `GET /api/sync`. Jadwal di `vercel.json` mengikuti batas paket Hobby. Paket Pro bisa dipersempit, misalnya setiap 15 menit.

Buka dashboard sekali setelah deploy supaya sync pertama menarik order.

