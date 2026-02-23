const { PrismaClient } = require('@prisma/client');
const { fetchForbasiKta, fetchForbasiAccounts } = require('./src/lib/forbasi');

const prisma = new PrismaClient();

async function main() {
  // 1. Check users with forbasiId
  const users = await prisma.user.findMany({
    where: { forbasiId: { not: null } },
    select: { id: true, name: true, email: true, forbasiId: true, role: true, avatar: true }
  });
  console.log('=== Users with forbasiId ===');
  console.log(JSON.stringify(users, null, 2));

  // 2. Try fetching KTA for each
  for (const u of users) {
    console.log(`\n=== KTA for ${u.name} (forbasiId: ${u.forbasiId}) ===`);
    const kta = await fetchForbasiKta(u.forbasiId);
    console.log(JSON.stringify(kta, null, 2));
  }

  // 3. Also check accounts list from FORBASI to see logo_url
  console.log('\n=== FORBASI Accounts (first 3) ===');
  const accounts = await fetchForbasiAccounts();
  const sample = accounts.slice(0, 3);
  sample.forEach(a => {
    console.log(`ID: ${a.id}, Name: ${a.name}, Logo: ${a.logo_url}`);
  });

  // 4. Test if logo_url is accessible
  if (users.length > 0 && users[0].avatar) {
    console.log(`\n=== Testing avatar URL: ${users[0].avatar} ===`);
    try {
      const resp = await fetch(users[0].avatar, { method: 'HEAD' });
      console.log(`Status: ${resp.status} ${resp.statusText}`);
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
