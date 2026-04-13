/** 柯布西耶建筑多色板 (Polychromie Architecturale) - 精选色用于 Agent 头像背景 */
export const CORBUSIER_COLORS: string[] = [
  "#0e2d58", // bleu outremer foncé
  "#4e6498", // bleu outremer 31
  "#366c8e", // bleu céruéléen 31
  "#2c695a", // vert anglais
  "#39774f", // vert foncé
  "#559778", // vert 59
  "#a4aa35", // vert olive vif
  "#de6433", // orange
  "#d15c32", // orange vif
  "#9c2128", // rouge vermillon 31
  "#811c35", // rouge carmin
  "#a33a29", // rouge vermillon 59
  "#6c2b3b", // le rubis
  "#884333", // l'ocre rouge
  "#5d3833", // terre sienne brûlée 31
  "#395a8e", // bleu outremer 59
  "#616f74", // gris 59
  "#4a535b", // gris foncé 59
  "#f4bd48", // le jaune vif
  "#96b4c9", // outremer moyen
];

/** 根据名称 hash 选取颜色索引 */
export function colorIndexForName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h << 5) - h + name.charCodeAt(i);
  return Math.abs(h) % CORBUSIER_COLORS.length;
}

/** hex 颜色亮度 (0-1)，用于决定文字用白还是深色 */
export function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
