export type PackageSpecification = {
  purchaseUom: string;
  stockUom: string;
  unitsPerPurchase: number;
  unitNetContent: number;
  contentUom: string;
};

const countUnits = "袋|包|盒|瓶|桶|罐|条|支|片|块|只|个";
const contentUnits = "kg|千克|公斤|斤|两|g|克|ml|毫升|l|升";

function normalizedContentUom(value: string) {
  const unit = value.trim().toLocaleLowerCase();
  if (["kg", "千克", "公斤"].includes(unit)) return "kg";
  if (["g", "克"].includes(unit)) return "g";
  if (["l", "升"].includes(unit)) return "L";
  if (["ml", "毫升"].includes(unit)) return "ml";
  return value.trim();
}

/**
 * 从门店常见规格中识别“每袋净含量 / 每件含多少袋”。
 * 例如 `5KG/4袋` 与 `4袋×5kg` 均会识别成：1 件 = 4 袋，每袋 5 kg。
 */
export function parsePackageSpecification(specification: string, fallbackPurchaseUom = "件", fallbackStockUom = "件"): PackageSpecification | null {
  const raw = specification.trim();
  if (!raw) return null;
  const text = raw.toLocaleLowerCase().replace(/[×＊*]/g, "x").replace(/[（）()]/g, "").replace(/^约/, "").replace(/\s+/g, "");
  const numeric = "(\\d+(?:\\.\\d+)?)";
  const content = `(${contentUnits})`;
  const count = `(${countUnits})`;
  const separator = "(?:/|x)";
  let match = text.match(new RegExp(`^${numeric}${content}${separator}${numeric}${count}(?:/件|/箱)?$`, "i"));
  let firstIsContent = true;
  if (!match) {
    match = text.match(new RegExp(`^${numeric}${count}${separator}${numeric}${content}(?:/件|/箱)?$`, "i"));
    firstIsContent = false;
  }
  // 如“20kg/袋”：表示一件里只有一袋，也明确记录每袋净含量。
  let singleCount = false;
  if (!match) {
    match = text.match(new RegExp(`^${numeric}${content}${separator}${count}(?:/件|/箱)?$`, "i"));
    firstIsContent = true;
    singleCount = true;
  }
  if (!match) return null;

  const unitNetContent = Number(firstIsContent ? match[1] : match[3]);
  const contentUom = normalizedContentUom(firstIsContent ? match[2] : match[4]);
  const unitsPerPurchase = singleCount ? 1 : Number(firstIsContent ? match[3] : match[1]);
  const stockUom = firstIsContent ? (singleCount ? match[3] : match[4]) : match[2];
  if (!Number.isFinite(unitNetContent) || unitNetContent <= 0 || !Number.isFinite(unitsPerPurchase) || unitsPerPurchase <= 0) return null;

  return {
    purchaseUom: fallbackPurchaseUom || "件",
    stockUom: stockUom || fallbackStockUom || "件",
    unitsPerPurchase,
    unitNetContent,
    contentUom,
  };
}
