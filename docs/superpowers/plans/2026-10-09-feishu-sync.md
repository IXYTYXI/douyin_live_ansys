# Feishu Sync Implementation Plan

Goal: 实现已确认的单向飞书同步，以本次真实直播验收。
Architecture: 独立 worker 读取 review API 与原始采样；CLI 用户身份更新独立 Base；原子 JSON 状态和文件锁保障串行重试，不依赖 SQLite。
Tech Stack: Python unittest、psycopg、lark-cli、systemd timer。

- [ ] 新建 backend/tests/test_lark_sync.py：验证缺失/零人数、整场/时段隔离、未知写入结果重试不重复、分页与重复键拒绝、时间精度。
- [ ] 运行 python3 -m unittest backend.tests.test_lark_sync，确认缺少实现导致失败。
- [ ] 新建 backend/lark_sync.py：纯投影、CLI 读写适配、幂等同步与安全状态保存。
- [ ] 新建 backend/lark_sync_service.py：加载明确配置、只读 source、锁、单次运行及退出码。
- [ ] 新建部署 service/timer 模板与操作文档；不改变正在运行服务。
- [ ] 运行相关单元测试、检查 diff、commit，push GitLab 与已有 GitHub；服务器只拉取版本。
- [ ] 核对飞书字段，首次同步当前真实场次，二次同步验证不重复；建立今日/待复盘/异常/按主播视图。
- [ ] 启用独立五分钟 timer，检查状态并报告链接与限制。
