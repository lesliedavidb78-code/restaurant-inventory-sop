import { describe, expect, it } from "vitest";
import { calculateProductMargin } from "@/lib/domain/product-margin";
import { extractDocxTables } from "@/lib/docx";

function storedZip(name: string, content: string) {
  const nameBuffer = Buffer.from(name); const data = Buffer.from(content);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuffer.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuffer.length, 28); central.writeUInt32LE(0, 42);
  const body = Buffer.concat([local, nameBuffer, data]); const directory = Buffer.concat([central, nameBuffer]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, directory, end]);
}

describe("单品毛利公式", () => {
  it("按净料价、出品分量和运费计算每份成本", () => {
    expect(calculateProductMargin({ sellingPriceCents: 2800, purchasePriceCents: 3250, auxiliaryCostCents: 230, portionQty: 0.3, yieldRate: 1.48, freightCents: 20 })).toEqual({
      netMaterialPriceCents: 2351,
      costCents: 725,
      grossProfitCents: 2075,
      grossMargin: 2075 / 2800,
    });
  });

  it("拒绝售价或净料率为零", () => {
    expect(() => calculateProductMargin({ sellingPriceCents: 0, purchasePriceCents: 100 })).toThrow("售价必须大于");
    expect(() => calculateProductMargin({ sellingPriceCents: 1000, purchasePriceCents: 100, yieldRate: 0 })).toThrow("净料率必须大于");
  });
});

describe("Word 表格读取", () => {
  it("从 docx 正文提取结构化表格", () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>品名</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>售价</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>鲜椒牛肉</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>28</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
    expect(extractDocxTables(storedZip("word/document.xml", xml))).toEqual([[ ["品名", "售价"], ["鲜椒牛肉", "28"] ]]);
  });
});
