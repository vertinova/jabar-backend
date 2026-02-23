const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const hashed = await bcrypt.hash('forbasi123', 10);
  const user = await prisma.user.update({
    where: { id: 1 },
    data: { password: hashed }
  });
  console.log('Password reset OK for', user.email, '-> forbasi123');

  // Verify login works
  const valid = await bcrypt.compare('forbasi123', user.password);
  console.log('Verify bcrypt compare:', valid);

  await prisma.$disconnect();
})();
