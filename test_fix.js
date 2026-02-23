require('dotenv').config();
const { fetchForbasiKta, fixForbasiFileUrl } = require('./src/lib/forbasi');

async function test() {
  // Test fixForbasiFileUrl
  console.log('=== fixForbasiFileUrl tests ===');
  console.log(fixForbasiFileUrl('https://forbasi.or.id/forbasi/php/kta_files/kta_logo_test.jpg'));
  console.log(fixForbasiFileUrl('https://forbasi.or.id/forbasi/php/generated_kta_pb/KTA_PB_test.pdf'));
  console.log(fixForbasiFileUrl(null));
  console.log(fixForbasiFileUrl('https://forbasi.or.id/forbasi/php/uploads/kta_files/already_correct.jpg'));

  // Test fetchForbasiKta with fix applied
  console.log('\n=== KTA for user 4681 (BRIPASSTRICK) ===');
  const kta1 = await fetchForbasiKta(4681);
  if (kta1.kta && kta1.kta[0]) {
    console.log('logo_url:', kta1.kta[0].logo_url);
    console.log('kta_pdf_url:', kta1.kta[0].kta_pdf_url);
    
    // Verify they actually work
    let r = await fetch(kta1.kta[0].logo_url, { method: 'HEAD' });
    console.log('Logo accessible:', r.status);
    r = await fetch(kta1.kta[0].kta_pdf_url, { method: 'HEAD' });
    console.log('PDF accessible:', r.status);
  }

  console.log('\n=== KTA for user 4495 (nadia) ===');
  const kta2 = await fetchForbasiKta(4495);
  if (kta2.kta && kta2.kta[0]) {
    console.log('logo_url:', kta2.kta[0].logo_url);
    console.log('kta_pdf_url:', kta2.kta[0].kta_pdf_url);
    
    let r = await fetch(kta2.kta[0].logo_url, { method: 'HEAD' });
    console.log('Logo accessible:', r.status);
    r = await fetch(kta2.kta[0].kta_pdf_url, { method: 'HEAD' });
    console.log('PDF accessible:', r.status);
  }
}
test().catch(e => console.error(e));
