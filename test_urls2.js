require('dotenv').config();

async function test() {
  // Check KTA detail page fully
  console.log('=== KTA detail page content ===');
  const r = await fetch('https://forbasi.or.id/forbasi/php/view_kta_details.php?barcode_id=FORBASI202602081818120122733b5');
  const body = await r.text();
  
  // Look for any image tags
  const imgMatches = body.match(/src=['"][^'"]+['"]|<img[^>]+>/gi);
  console.log('\nAll images found:');
  if (imgMatches) imgMatches.forEach(m => console.log(' ', m));
  
  // Look for any href with file extensions
  const hrefMatches = body.match(/href=['"][^'"]+\.(pdf|jpg|jpeg|png|gif)[^'"]*['"]|download/gi);
  console.log('\nFile links found:');
  if (hrefMatches) hrefMatches.forEach(m => console.log(' ', m));
  
  // Look for "download" or "unduh" text
  const downloadMatches = body.match(/.{0,50}(download|unduh|cetak|print).{0,50}/gi);
  console.log('\nDownload-related text:');
  if (downloadMatches) downloadMatches.forEach(m => console.log(' ', m.trim()));

  // Check for API calls or fetch in JS
  const apiMatches = body.match(/.{0,80}(api_pengcab|fetch|axios|kta_files|generated_kta).{0,80}/gi);
  console.log('\nAPI/fetch references:');
  if (apiMatches) apiMatches.forEach(m => console.log(' ', m.trim()));

  // Also try the FORBASI API for a file download action
  const KEY = process.env.FORBASI_API_KEY;
  const API = process.env.FORBASI_API_URL;
  
  console.log('\n=== Testing API actions ===');
  // Maybe there's a download action?
  for (const action of ['download_kta', 'kta_download', 'kta_pdf', 'file']) {
    const url = `${API}?action=${action}&kta_id=1227&api_key=${encodeURIComponent(KEY)}`;
    const r2 = await fetch(url);
    const ct = r2.headers.get('content-type');
    console.log(`action=${action}: ${r2.status} ${ct}`);
    if (r2.status === 200 && ct && ct.includes('json')) {
      const d = await r2.json();
      console.log('  ', JSON.stringify(d).substring(0, 200));
    }
  }
}
test().catch(e => console.error(e));
