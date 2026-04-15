const p = require('./src/lib/prisma');
p.pengcab.findMany({ select: { id: true, nama: true, kota: true, username: true, forbasiId: true } })
  .then(d => console.log(JSON.stringify(d, null, 2)))
  .finally(() => p.$disconnect());
