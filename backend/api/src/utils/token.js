const crypto = require("crypto");

const TOKEN_TTL_SECONDS = 60 * 60 * 12;
const secret = process.env.SESSION_SECRET || "qaira-dev-secret";

const base64url = (value) => Buffer.from(value).toString("base64url");

const signValue = (value) => {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
};

exports.hashPassword = (password) => {
  return crypto.createHash("sha256").update(password).digest("hex");
};

exports.createToken = (user) => {
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name || null,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  };

  const encoded = base64url(JSON.stringify(payload));
  const signature = signValue(encoded);

  return `${encoded}.${signature}`;
};

exports.verifyToken = (token) => {
  if (!token || !token.includes(".")) {
    throw new Error("Invalid token");
  }

  const [encoded, signature] = token.split(".");
  const expected = signValue(encoded);

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("Invalid token");
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));

  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }

  return payload;
};
