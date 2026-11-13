/** Open piece sets. Names are ours; the drawings are not from chess.com. */
export const PIECE_STYLES = [
  { id: "cburnett", name: "Classic" },
  { id: "merida", name: "Merida" },
  { id: "chessnut", name: "Chessnut" },
  { id: "celtic", name: "Celtic" },
  { id: "fantasy", name: "Fantasy" },
  { id: "firi", name: "Firi" },
  { id: "pirouetti", name: "Pirouetti" },
  { id: "papercut", name: "Papercut" },
  { id: "neon", name: "Neon" },
  { id: "woodland", name: "Woodland" },
];

const IDS = new Set(PIECE_STYLES.map((s) => s.id));

export function validStyle(id) {
  return IDS.has(id) ? id : "cburnett";
}

export function pieceFile(style, color, type) {
  const letter = String(type || "").toUpperCase();
  return `pieces/sets/${validStyle(style)}/${color}${letter}.svg`;
}
