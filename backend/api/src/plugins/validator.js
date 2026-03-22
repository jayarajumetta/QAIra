// Input sanitization utilities
const sanitizeString = (value) => {
  if (typeof value !== "string") return value;
  // Remove null bytes and other dangerous characters
  return value
    .replace(/\0/g, "")
    .trim()
    .substring(0, 10000); // Limit string length
};

const sanitizeEmail = (email) => {
  if (typeof email !== "string") return email;
  const sanitized = email.toLowerCase().trim().substring(0, 255);
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(sanitized)) {
    throw new Error("Invalid email format");
  }
  return sanitized;
};

const sanitizeInput = (data, schema) => {
  const sanitized = {};
  
  for (const [key, value] of Object.entries(data)) {
    if (!schema[key]) continue; // Ignore unknown fields
    
    const rules = schema[key];
    
    if (rules.type === "string") {
      sanitized[key] = sanitizeString(value);
    } else if (rules.type === "email") {
      sanitized[key] = sanitizeEmail(value);
    } else if (rules.type === "number") {
      const num = Number(value);
      if (isNaN(num)) continue;
      sanitized[key] = num;
    } else if (rules.type === "boolean") {
      sanitized[key] = Boolean(value);
    } else if (rules.type === "array") {
      if (Array.isArray(value)) {
        sanitized[key] = value.map(item => 
          rules.items === "string" ? sanitizeString(item) : item
        );
      }
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
};

module.exports = async function (fastify) {
  fastify.decorate("sanitize", sanitizeInput);
  return fastify;
};
