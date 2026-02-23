const { PrismaClient } = require('@prisma/client');
const { fetchForbasiKta, fetchForbasiAccounts } = require('./src/lib/forbasi');

const prisma = new PrismaClient();

async function main() {
  // 1. Check users with forbasiId
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, forbasiId: true }
  });
  console.log('=== Users in DB ===');
  console.log(JSON.stringify(users, null, 2));

  // 2. Check FORBASI accounts to get actual user IDs
  console.log('\n=== FORBASI Accounts ===');
  const accounts = await fetchForbasiAccounts();
  if (accounts && accounts.length > 0) {
    accounts.slice(0, 5).forEach(a => {
      console.log(`  ID: ${a.id}, Username: ${a.username}, Name: ${a.name}, Logo: ${a.logo_url || 'none'}`);
    });
    
    // 3. Test KTA with first account that has an ID
    const testId = accounts[0].id;
    console.log(`\n=== KTA for user_id=${testId} ===`);
    const ktaResult = await fetchForbasiKta(testId);
    console.log(JSON.stringify(ktaResult, null, 2));

    // Test with another user if available
    if (accounts.length > 1) {
      const testId2 = accounts[1].id;
      console.log(`\n=== KTA for user_id=${testId2} ===`);
      const ktaResult2 = await fetchForbasiKta(testId2);
      console.log(JSON.stringify(ktaResult2, null, 2));
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
