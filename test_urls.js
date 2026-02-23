require('dotenv').config();
const KEY = process.env.FORBASI_API_KEY;

async function test() {
  const logoUrl = 'https://forbasi.or.id/forbasi/php/kta_files/kta_logo_6970438fcedc2_3163.jpg';
  const pdfUrl = 'https://forbasi.or.id/forbasi/php/generated_kta_pb/KTA_PB_BRIPASSTRICK_1227.pdf';

  // Test 1: With api_key as query param
  console.log('=== With api_key query param ===');
  let r = await fetch(logoUrl + '?api_key=' + encodeURIComponent(KEY));
  console.log('Logo:', r.status, r.headers.get('content-type'));
  r = await fetch(pdfUrl + '?api_key=' + encodeURIComponent(KEY));
  console.log('PDF:', r.status, r.headers.get('content-type'));

  // Test 2: With Referer header
  console.log('\n=== With Referer header ===');
  r = await fetch(logoUrl, { headers: { 'Referer': 'https://forbasi.or.id/' } });
  console.log('Logo:', r.status, r.headers.get('content-type'));

  // Test 3: Get HTML body to see the error
  console.log('\n=== Error body from logo URL ===');
  r = await fetch(logoUrl);
  const body = await r.text();
  console.log(body.substring(0, 500));

  // Test 4: Check the kta_detail_url (this one returned 200)
  console.log('\n=== KTA detail page (barcode link) ===');
  r = await fetch('https://forbasi.or.id/forbasi/php/view_kta_details.php?barcode_id=FORBASI202602081818120122733b5');
  const detailBody = await r.text();
  const pdfMatch = detailBody.match(/href=['"]([^'"]*\.pdf[^'"]*)/i);
  if (pdfMatch) console.log('PDF link found in detail page:', pdfMatch[1]);
  else console.log('No PDF link in detail page');
  const imgMatch = detailBody.match(/src=['"]([^'"]*kta_logo[^'"]*)/i);
  if (imgMatch) console.log('Logo found in detail page:', imgMatch[1]);
  else console.log('No logo in detail page');
  console.log('Detail page length:', detailBody.length, 'chars');
  console.log('First 300 chars:', detailBody.substring(0, 300));
}
test().catch(e => console.error(e));
