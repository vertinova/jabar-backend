require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Forbasi Jabar API running on port ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`📅 Started at ${new Date().toISOString()}`);
});
