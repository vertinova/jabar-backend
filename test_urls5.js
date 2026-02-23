async function test() {
  // API gives: .../forbasi/php/kta_files/... (500)
  // Correct:   .../forbasi/php/uploads/kta_files/... (200)
  
  // Test logo with /uploads/ prefix
  const logoFixed = 'https://forbasi.or.id/forbasi/php/uploads/kta_files/kta_logo_6970438fcedc2_3163.jpg';
  let r = await fetch(logoFixed, { method: 'HEAD' });
  console.log('Logo (with /uploads/):', r.status, r.headers.get('content-type'));
  
  // Test PDF with /uploads/ prefix
  const pdfFixed = 'https://forbasi.or.id/forbasi/php/uploads/generated_kta_pb/KTA_PB_BRIPASSTRICK_1227.pdf';
  r = await fetch(pdfFixed, { method: 'HEAD' });
  console.log('PDF (with /uploads/):', r.status, r.headers.get('content-type'));

  // Test nadia's logo and PDF
  const nadiaLogo = 'https://forbasi.or.id/forbasi/php/uploads/kta_files/kta_logo_6936a55726666_1000343891.jpg';
  r = await fetch(nadiaLogo, { method: 'HEAD' });
  console.log('Nadia logo (with /uploads/):', r.status, r.headers.get('content-type'));

  const nadiaPdf = 'https://forbasi.or.id/forbasi/php/uploads/generated_kta_pb/KTA_PB_SMKN_14__1138.pdf';
  r = await fetch(nadiaPdf, { method: 'HEAD' });
  console.log('Nadia PDF (with /uploads/):', r.status, r.headers.get('content-type'));

  // Also test the account-level logo_url (used for avatar)
  // Account API returns: https://forbasi.or.id/forbasi/php/kta_files/kta_logo_xxx.jpg
  // Should be: https://forbasi.or.id/forbasi/php/uploads/kta_files/kta_logo_xxx.jpg
  const acctLogo = 'https://forbasi.or.id/forbasi/php/uploads/kta_files/kta_logo_6908288dabf73_WhatsApp_Image_2025-11-03_at_10.43.23.jpeg';
  r = await fetch(acctLogo, { method: 'HEAD' });
  console.log('Account logo (with /uploads/):', r.status, r.headers.get('content-type'));
}
test().catch(e => console.error(e));
