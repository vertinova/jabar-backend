const SIMPASKOR_API_URL = process.env.SIMPASKOR_API_URL || 'https://simpaskor.id/api/external';
const SIMPASKOR_API_KEY = process.env.SIMPASKOR_API_KEY || 'SIMPASKOR_API_KEY_2026';

/**
 * Verify a Simpaskor billing code
 * GET /api/simpaskor/verify?billing_id=ABC123
 */
const verifyBilling = async (req, res) => {
  try {
    const { billing_id } = req.query;
    if (!billing_id || !billing_id.trim()) {
      return res.status(400).json({ error: 'billing_id wajib diisi' });
    }

    const url = `${SIMPASKOR_API_URL}/booking_detail.php?api_key=${encodeURIComponent(SIMPASKOR_API_KEY)}&billing_id=${encodeURIComponent(billing_id.trim())}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    const data = await response.json();

    // 404 = billing not found — valid API response, just not found
    if (!response.ok && response.status !== 404) {
      return res.status(502).json({ error: 'Gagal menghubungi server Simpaskor', status: response.status });
    }

    // Return the Simpaskor response to the frontend
    res.json(data);
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return res.status(504).json({ error: 'Server Simpaskor tidak merespon (timeout)' });
    }
    console.error('Simpaskor verify error:', error.message);
    res.status(500).json({ error: 'Gagal memverifikasi billing Simpaskor', detail: error.message });
  }
};

module.exports = { verifyBilling };
