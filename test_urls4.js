require('dotenv').config();

async function test() {
  // The detail page uses this endpoint - different from main API
  const url = 'https://forbasi.or.id/forbasi/php/get_kta_data.php?barcode_id=FORBASI202602081818120122733b5';
  console.log('=== get_kta_data.php response ===');
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const data = await r.json();
  console.log(JSON.stringify(data, null, 2));

  // If there's a full_logo_url, test if IT works
  if (data.data && data.data.full_logo_url) {
    console.log('\n=== Testing full_logo_url ===');
    const r2 = await fetch(data.data.full_logo_url, { method: 'HEAD' });
    console.log('Status:', r2.status, '| Content-Type:', r2.headers.get('content-type'));
  }

  // If there's a kta_pdf_url, test it
  if (data.data && data.data.kta_pdf_url) {
    console.log('\n=== Testing kta_pdf_url from get_kta_data ===');
    const r3 = await fetch(data.data.kta_pdf_url, { method: 'HEAD' });
    console.log('Status:', r3.status, '| Content-Type:', r3.headers.get('content-type'));
  }

  // Also test for nadia's barcode
  console.log('\n=== get_kta_data.php for nadia ===');
  const r4 = await fetch('https://forbasi.or.id/forbasi/php/get_kta_data.php?barcode_id=FORBASI2025121310500201138a698', { headers: { 'Accept': 'application/json' } });
  const data4 = await r4.json();
  console.log(JSON.stringify(data4, null, 2));
  
  if (data4.data && data4.data.full_logo_url) {
    console.log('\n=== Testing nadia full_logo_url ===');
    const r5 = await fetch(data4.data.full_logo_url, { method: 'HEAD' });
    console.log('Status:', r5.status, '| Content-Type:', r5.headers.get('content-type'));
  }
}
test().catch(e => console.error(e));
