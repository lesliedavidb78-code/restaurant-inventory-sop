import { getDashboard } from "@/lib/services";
import { InventoryDesk } from "@/components/inventory-desk";
import { localStore } from "@/lib/local-store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getDashboard(localStore.storeId, "2026-06");
  return <InventoryDesk initialData={data} />;
}
