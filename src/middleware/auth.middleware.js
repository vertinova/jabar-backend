const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token tidak ditemukan' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token tidak valid atau sudah expired' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Akses ditolak. Hanya admin yang bisa mengakses.' });
  }
  next();
};

const isPengcab = (req, res, next) => {
  if (req.user.role !== 'PENGCAB') {
    return res.status(403).json({ error: 'Akses ditolak. Hanya pengcab yang bisa mengakses.' });
  }
  next();
};

const isPenyelenggara = (req, res, next) => {
  if (req.user.role !== 'PENYELENGGARA') {
    return res.status(403).json({ error: 'Akses ditolak. Hanya penyelenggara event yang bisa mengakses.' });
  }
  next();
};

module.exports = { authenticate, isAdmin, isPengcab, isPenyelenggara };
