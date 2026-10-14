import { seedDatabase } from "../lib/db/seed";

seedDatabase().then(() => {
  console.log("示例门店演示数据已就绪");
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
