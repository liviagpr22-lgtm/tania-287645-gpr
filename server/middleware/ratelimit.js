// Rate limiter em memoria (por IP) para rotas de autenticacao.
// Isento para localhost e redes locais, para nao travar o uso normal/diagnostico.
const buckets = new Map();

function isLocalOrPrivate(ip) {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost') return true;
  // IPv4 privado
  const m = ip.match(/^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  const parts = m ? [m[1], m[2], m[3], m[4]] : ip.split('.');
  if (parts.length === 4 && parts.every(function (x) { return /^\d+$/.test(x); })) {
    const a = Number(parts[0]), b = Number(parts[1]);
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function rateLimit({ windowMs = 15 * 60 * 1000, max = 100 } = {}) {
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
    if (isLocalOrPrivate(ip)) return next();

    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || now - b.start > windowMs) { b = { start: now, count: 0 }; buckets.set(ip, b); }
    b.count += 1;

    if (b.count > max) {
      const retryAfter = Math.ceil((windowMs - (now - b.start)) / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ erro: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.' });
      return;
    }
    next();
  };
}

module.exports = { rateLimit };
