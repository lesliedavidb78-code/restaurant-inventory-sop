import { STORE_ID } from "@/lib/db/seed";

/** 单机进销存版固定使用默认门店，不需要注册、登录或角色选择。 */
export const localStore = {
  storeId: STORE_ID,
  actor: "本地操作员",
  role: "storekeeper",
} as const;
