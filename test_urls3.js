require('dotenv').config();

async function test() {
  const r = await fetch('https://forbasi.or.id/forbasi/php/view_kta_details.php?barcode_id=FORBASI202602081818120122733b5');
  const body = await r.text();
  
  // Find the script section and look for API_URL and full_logo_url
  const scriptMatch = body.match(/<script[\s\S]*?<\/script>/gi);
  if (scriptMatch) {
    scriptMatch.forEach((s, i) => {
      if (s.includes('API_URL') || s.includes('fetch') || s.includes('logo') || s.includes('pdf')) {
        console.log(`=== Script block ${i} ===`);
        console.log(s.substring(0, 3000));
        console.log('...');
      }
    });
  }
}
test().catch(e => console.error(e));
