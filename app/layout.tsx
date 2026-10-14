import type { Metadata } from "next";
import "./globals.css";
import "./reconciliation.css";

export const metadata: Metadata = {
  title: "门店进销存系统",
  description: "单机版门店进货、销售出库与库存管理系统",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
