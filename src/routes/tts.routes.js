/**
 * Narasi suara Bahasa Indonesia untuk popup live arena voting — proksi ke
 * Edge Read Aloud. Disalin dari Simpaskor (backend/src/routes/tts.ts).
 *
 * Kenapa di server: Web Speech API peramban hanya bisa memakai suara yang
 * terpasang di mesin penonton, dan Windows polos hanya membawa suara en-US —
 * teks Indonesia jadi dibacakan dengan fonetik Inggris. Suara id-ID yang bagus
 * (Gadis, Ardi) ada di Edge Read Aloud, dan hasilnya sama di semua peramban.
 *
 * Bukan jalur yang dijamin: endpoint Microsoft ini tidak berdokumen resmi dan
 * bisa diblokir jaringan. Kegagalannya tidak fatal — frontend (useAIVoice)
 * kembali memakai Web Speech API.
 */
const crypto = require('crypto');
const router = require('express').Router();
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const SUARA = {
  female: 'id-ID-GadisNeural',
  male: 'id-ID-ArdiNeural',
};

/* Endpoint ini publik (halaman voting memang publik), jadi teks dibatasi
   supaya tidak dipakai sebagai mesin TTS gratis. Narasi terpanjang yang sah —
   sambutan atau baris pesan pembeli — jauh di bawah angka ini. */
const MAKS_HURUF = 300;
const BATAS_WAKTU_MS = 12_000;

/* Teks yang sama berulang terus (sambutan, nama nominee); tanpa singgahan
   tiap pemutaran berarti satu websocket baru ke Microsoft. */
const SINGGAHAN_MAKS = 200;
const singgahan = new Map();

const ambilSinggahan = (kunci) => {
  const ada = singgahan.get(kunci);
  if (!ada) return null;
  // Disentuh = dipakai lagi: pindahkan ke ekor.
  singgahan.delete(kunci);
  singgahan.set(kunci, ada);
  return ada;
};

const simpanSinggahan = (kunci, isi) => {
  singgahan.set(kunci, isi);
  while (singgahan.size > SINGGAHAN_MAKS) {
    const tertua = singgahan.keys().next().value;
    if (tertua === undefined) break;
    singgahan.delete(tertua);
  }
};

const rangkaiSuara = async (teks, suara) => {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(suara, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(teks);

  return new Promise((selesai, gagal) => {
    const potongan = [];
    const pewaktu = setTimeout(() => {
      gagal(new Error(`Edge TTS tidak menjawab dalam ${BATAS_WAKTU_MS} ms`));
    }, BATAS_WAKTU_MS);
    const tutup = () => clearTimeout(pewaktu);

    audioStream.on('data', (d) => potongan.push(d));
    audioStream.on('end', () => {
      tutup();
      const isi = Buffer.concat(potongan);
      // Aliran tanpa isi bukan keberhasilan: frontend akan menyimpan berkas
      // 0 byte dan mengira TTS beres — diam total tanpa jatuh ke cadangan.
      if (isi.length === 0) gagal(new Error('Edge TTS mengembalikan audio kosong'));
      else selesai(isi);
    });
    audioStream.on('error', (e) => {
      tutup();
      gagal(e);
    });
  });
};

/* GET /api/tts?teks=...&suara=female|male — membalas MP3. Kegagalan dibalas
   502 supaya frontend tahu harus memakai cadangan. */
router.get('/', async (req, res) => {
  try {
    const teks = String(req.query.teks ?? '').trim();
    if (!teks) return res.status(400).json({ error: 'Parameter `teks` wajib diisi' });
    if (teks.length > MAKS_HURUF) {
      return res.status(400).json({ error: `Teks terlalu panjang (maksimal ${MAKS_HURUF} huruf)` });
    }

    const namaSuara = SUARA[req.query.suara === 'male' ? 'male' : 'female'];
    const kunci = crypto.createHash('sha256').update(`${namaSuara}::${teks}`).digest('hex');

    let isi = ambilSinggahan(kunci);
    if (!isi) {
      isi = await rangkaiSuara(teks, namaSuara);
      simpanSinggahan(kunci, isi);
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(isi.length));
    // Kunci singgahan memuat teks dan suaranya, jadi isinya tidak pernah berubah.
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    return res.send(isi);
  } catch (galat) {
    // Kegagalan di sini wajar (jaringan memblokir, Microsoft membatasi) dan
    // frontend punya cadangan; cukup peringatan, bukan galat.
    console.warn(`[tts] gagal merangkai suara: ${galat?.message || galat}`);
    return res.status(502).json({ error: 'Layanan suara sedang tidak tersedia' });
  }
});

module.exports = router;
