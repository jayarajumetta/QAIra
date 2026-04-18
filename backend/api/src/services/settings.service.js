const db = require("../db");

const LOCALIZATION_SETTINGS_KEY = "localization_strings";

const normalizeLocalizationStrings = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input)
      .filter(([key, value]) => typeof key === "string" && key.trim() && typeof value === "string")
      .map(([key, value]) => [key.trim(), value])
  );
};

exports.getLocalizationStrings = async () => {
  const row = await db.prepare(`
    SELECT value
    FROM app_settings
    WHERE key = ?
  `).get(LOCALIZATION_SETTINGS_KEY);

  return normalizeLocalizationStrings(row?.value);
};

exports.updateLocalizationStrings = async (strings) => {
  const normalizedStrings = normalizeLocalizationStrings(strings);

  await db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `).run(LOCALIZATION_SETTINGS_KEY, normalizedStrings);

  return {
    updated: true,
    strings: normalizedStrings
  };
};
