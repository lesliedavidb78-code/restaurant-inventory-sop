<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 库存项目长期验收规则

- 默认在此原项目目录修改；不得复制新项目目录，除非用户明确要求。
- 选择商品、供应商、原料等使用一个可搜索选择控件；不得另加独立搜索框。必须用稳定 ID 区分重名。
- 长列表全部分页，并保证页码覆盖完整数据；不得对 SQL 截断子集宣称真实总数。
- 切换页面保留未保存草稿；单行保存、导入刷新不得覆盖其他未保存输入。
- 保存、修改、删除、受阻操作提供当前屏幕可见的反馈；Electron 不使用原生 window.confirm/alert 处理破坏性操作，以免焦点挂起。
- 盘点空白代表未盘点，不代表 0；只有明确填 0 才能确认零库存。导入全体归属/重复/数值校验必须在服务端完成，并用一个事务提交。
- 盘点确认自动保存当前输入；期间流水或单位变化必须阻止旧差额入账，显式重新核对时点后才能确认。
- 历史收货退货使用原收货换算/成本快照，不得使用当前包装比例。
- 门店业务日期按 Asia/Shanghai；不要用 UTC 日期截取作为默认当天。
- 采购写操作防双击并携带幂等键；请求失败保留输入。请求错误不得当正常页面数据使用。
- 业务测试必须指定 RESTAURANT_DATA_DIR 到 .review-temp 隔离账本，禁止读写用户实际账本。
- 修改交付须生成覆盖补丁。统一构建目录，验证载荷 package 版本、源码指纹、BUILD_ID、关键 API；文件名或 SHA-256 不能替代内容核验。
- 发补丁前跑全套测试、类型检查、隔离启动与关键接口验收；未跑的验收项如实说明，不能宣称全部完成。
