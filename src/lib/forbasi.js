/**
 * FORBASI API Integration Service
 * Fetches pengda & pengcab data from forbasi.or.id
 */

const FORBASI_API_URL = process.env.FORBASI_API_URL || 'https://forbasi.or.id/forbasi/php/api_pengcab_jabar.php';
const FORBASI_API_KEY = process.env.FORBASI_API_KEY || '';

/**
 * Fetch all pengcab Jawa Barat from FORBASI API
 */
async function fetchPengcabFromForbasi() {
  const url = `${FORBASI_API_URL}?action=accounts&role=pengcab&per_page=100&api_key=${encodeURIComponent(FORBASI_API_KEY)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`FORBASI API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(`FORBASI API returned error: ${result.error || 'Unknown error'}`);
  }

  return {
    total: result.total,
    data: result.data || []
  };
}

/**
 * Fetch detail of a specific pengcab account by username (v3.0)
 */
async function fetchPengcabDetail(username) {
  const url = `${FORBASI_API_URL}?action=account&username=${encodeURIComponent(username)}&api_key=${encodeURIComponent(FORBASI_API_KEY)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`FORBASI API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(`FORBASI API returned error: ${result.error || 'Unknown error'}`);
  }

  return result.data || result.user || null;
}

/**
 * Verify login credentials against FORBASI API (v3.0)
 * Returns user data if login is successful, null if failed
 */
async function verifyForbasiLogin(username, password) {
  const url = `${FORBASI_API_URL}?action=login`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': FORBASI_API_KEY
    },
    body: JSON.stringify({ username, password })
  });

  // API may return non-200 for invalid credentials
  const result = await response.json().catch(() => null);
  if (!result || !result.success) {
    return null; // Login failed
  }

  return result.user || result.data || null;
}

/**
 * Fetch all accounts from FORBASI API (v3.0)
 * Fetches ALL pages to get complete data
 * @param {Object} options - { role, search, page, per_page }
 */
async function fetchForbasiAccounts(options = {}) {
  const allAccounts = [];
  let page = 1;
  let hasMore = true;
  
  while (hasMore) {
    const params = new URLSearchParams({ action: 'accounts', api_key: FORBASI_API_KEY });
    if (options.role) params.append('role', options.role);
    if (options.search) params.append('search', options.search);
    params.append('page', page);
    params.append('per_page', options.per_page || 200);

    const response = await fetch(`${FORBASI_API_URL}?${params}`);
    const result = await response.json().catch(() => null);
    
    if (!result || !result.success || !result.data || result.data.length === 0) {
      hasMore = false;
    } else {
      allAccounts.push(...result.data);
      // Check if we got less than per_page (last page) or reached total
      if (result.data.length < (options.per_page || 200)) {
        hasMore = false;
      } else {
        page++;
      }
    }
  }
  
  return allAccounts;
}

/**
 * Fetch single account detail from FORBASI API (v3.0)
 */
async function fetchForbasiAccount(identifier) {
  const param = typeof identifier === 'number' ? `id=${identifier}` : `username=${encodeURIComponent(identifier)}`;
  const url = `${FORBASI_API_URL}?action=account&${param}&api_key=${encodeURIComponent(FORBASI_API_KEY)}`;

  const response = await fetch(url);
  const result = await response.json().catch(() => null);
  if (!result || !result.success) return null;
  return result.data || result.user || null;
}

/**
 * Update profile via FORBASI API (v3.0)
 * @param {number} id - FORBASI user ID
 * @param {Object} fields - { club_name, email, phone, address, school_name }
 */
async function updateForbasiProfile(id, fields) {
  const url = `${FORBASI_API_URL}?action=update_profile`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': FORBASI_API_KEY },
    body: JSON.stringify({ id, ...fields })
  });
  const result = await response.json().catch(() => null);
  return result;
}

/**
 * Change password via FORBASI API (v3.0)
 */
async function changeForbasiPassword(id, oldPassword, newPassword) {
  const url = `${FORBASI_API_URL}?action=change_password`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': FORBASI_API_KEY },
    body: JSON.stringify({ id, old_password: oldPassword, new_password: newPassword })
  });
  const result = await response.json().catch(() => null);
  return result;
}

/**
 * Map FORBASI API data to our Pengcab model format
 */
function mapForbasiToPengcab(apiData) {
  return {
    forbasiId: apiData.id,
    nama: apiData.club_name,
    kota: apiData.city_name || apiData.region || '',
    email: apiData.email || null,
    phone: apiData.phone || null,
    username: apiData.username || null,
    status: 'AKTIF',
  };
}

/**
 * Fix FORBASI file URLs — API returns paths missing /uploads/ directory.
 * e.g. .../forbasi/php/kta_files/... → .../forbasi/php/uploads/kta_files/...
 */
function fixForbasiFileUrl(url) {
  if (!url || typeof url !== 'string') return url;
  // Skip if already has /uploads/ in path
  if (url.includes('/uploads/')) return url;
  return url.replace(
    /\/forbasi\/php\/(kta_files|generated_kta|generated_kta_pb|generated_kta_pengda)\//g,
    '/forbasi/php/uploads/$1/'
  );
}

/**
 * Fetch KTA data for a FORBASI user
 * @param {number|string} identifier - user_id or username
 */
async function fetchForbasiKta(identifier) {
  const param = typeof identifier === 'number' ? `user_id=${identifier}` : `username=${encodeURIComponent(identifier)}`;
  const url = `${FORBASI_API_URL}?action=kta&${param}&api_key=${encodeURIComponent(FORBASI_API_KEY)}`;

  const response = await fetch(url);
  const result = await response.json().catch(() => null);
  if (!result || !result.success) return { total_kta: 0, kta: [] };

  // Fix file URLs in KTA data
  const kta = (result.kta || []).map(k => ({
    ...k,
    logo_url: fixForbasiFileUrl(k.logo_url),
    kta_pdf_url: fixForbasiFileUrl(k.kta_pdf_url),
  }));

  return { user: result.user || null, total_kta: result.total_kta || 0, kta };
}

module.exports = {
  fetchPengcabFromForbasi,
  fetchPengcabDetail,
  verifyForbasiLogin,
  fetchForbasiAccounts,
  fetchForbasiAccount,
  fetchForbasiKta,
  fixForbasiFileUrl,
  updateForbasiProfile,
  changeForbasiPassword,
  mapForbasiToPengcab,
  FORBASI_API_URL,
  FORBASI_API_KEY
};
