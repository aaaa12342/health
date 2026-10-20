# 云同步验证

- 保留本地 key daily-health:v1；云端使用独立 health_journals，Reading 的两张表没有被代码引用。
- Node 测试覆盖云/本地分离、首次并发创建、更新版本冲突、读取失败禁止写入、网络失败不回退、切换账号时丢弃旧读取/写入返回、迁移去重及冲突取消、禁止管理员 key。
- 原有 Edge 浏览器完整本地流程通过，含营养/备注/锻炼/身体、导入导出及响应式布局。
- tests/cloud-browser.cjs 使用明确的模拟 SDK 和共享假数据库，覆盖登录、显式迁移、两设备冲突、重新同步、失败输入保留、退出回本机和账号切换。不代表真实 Supabase 云权限验收。
- 真实只读探测 auth/v1/settings HTTP 200；health_journals HTTP 404 / PGRST205，尚未建表，不能宣称云同步已可用。

- tests/sql-permissions.cjs 已在隔离 PGlite/Postgres 执行原 SQL 两次，验证匿名禁止、本人读写、跨账号读写禁止、账号身份锁、首次/更新版本冲突和无效 payload 事务回滚。该测试不是远程 Supabase 验收。
