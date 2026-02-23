require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { fixForbasiFileUrl } = require('./src/lib/forbasi');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: { avatar: { not: null } },
    select: { id: true, avatar: true }
  });
  
  for (const u of users) {
    const fixed = fixForbasiFileUrl(u.avatar);
    if (fixed !== u.avatar) {
      await prisma.user.update({ where: { id: u.id }, data: { avatar: fixed } });
      console.log('Fixed user', u.id, ':', u.avatar, '->', fixed);
    } else {
      console.log('OK user', u.id, ':', u.avatar);
    }
  }
  
  if (users.length === 0) console.log('No users with avatar found');
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
