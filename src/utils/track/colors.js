// track/colors.js — stable presentation colours for track documents

export const BRIGHT_COLORS = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#e67e22",
  "#9b59b6",
  "#1abc9c",
  "#e91e63",
  "#f1c40f",
  "#00bcd4",
  "#ff5722",
];

const hashString = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/** Deterministic palette colour for a document id. */
export function colorForId(id) {
  const hash = hashString(String(id ?? ""));
  return BRIGHT_COLORS[hash % BRIGHT_COLORS.length];
}

/** Fill missing document colours in place, keeping existing colours stable. */
export function assignTrackColors(docs) {
  const used = new Set(
    docs.map((doc) => doc?.color).filter((color) => typeof color === "string"),
  );

  for (const doc of docs) {
    if (doc?.color) continue;

    const available = BRIGHT_COLORS.find((color) => !used.has(color));
    const color = available ?? colorForId(doc?.id);
    doc.color = color;
    used.add(color);
  }

  return docs;
}
