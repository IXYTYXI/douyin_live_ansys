# 飞书业务副本

单向：数据库和网页为主，飞书内容由同步覆盖。当前使用显式主播白名单与日期筛选；新增主播需修改配置。所有字段由后台维护，不在飞书直接编辑运营结论。当前每五分钟最终一致，不是网页保存后即时推送。无权修改飞书高级权限时，单向约定不是字段级只读权限。

先创建独立三表及字段，填入 `backend/deploy/feishu-sync.example.json` 的真实表 ID，保存 `/etc/diting-feishu-sync.json` 为 0600。不得将密钥写入该 JSON。worker 使用 `/etc/diting-review.env` 现有只读查询身份。飞书通过服务器已有 lark-cli `--as user` 访问，需要 `base:app:read base:table:read base:field:read base:record:read base:record:create base:record:update` 权限与目标资源访问权限。用户授权过期需重新授权，不能降级成应用身份或删除状态掩盖失败。

按本地测试、push、服务器 ff-only pull 顺序发布。验证 `python -m backend.lark_sync_service --config /etc/diting-feishu-sync.json` 两次，确认记录不重复后，将 service/timer 模板安装至 `/etc/systemd/system/`，daemon-reload 后 enable --now diting-feishu-sync.timer。该操作不重启其他业务服务。root 运行是为了复用服务器已授权 CLI 与受限环境；后续如分离服务用户，须重新配置该用户飞书身份，不复制桌面用户凭据。

状态：`/var/lib/diting-feishu-sync/status.json`，日志：`journalctl -u diting-feishu-sync`。失败下轮重试，不阻塞直播；系统 timer 活跃不代表写入成功，必须看 status 的 ok 与 checkedAt。暂停：`systemctl stop diting-feishu-sync.timer`。完整源数据保留于 PostgreSQL，飞书行数配额需监控（每主播每小时约360条明细）；当前没有自动删行或归档策略。

防重复使用远端同步键完整分页读取、单机文件锁、写后保存哈希。未知写入结果下一轮重新读取远端；已有重复键直接失败，避免任意覆盖。仅支持一台服务器运行此配置，不能在另一台同时启动。删除远端镜像行会在后续同步重建；不删除源数据。每次循环先同步父场次再建立真实关联。

人数明细保留真实采样 ID、采样/接收时间。空值保持空，0保持0。时间字段在飞书显示到分钟，底层传入秒；同一分钟多个记录是正常10秒采样。缺失音频是否完整由复盘状态展示；飞书不存媒体文件或有签名凭据的URL，仅存复盘站点链接。

时段表默认同步10分钟总结，同时保留网页已保存的其他范围（例如30分钟）的人工笔记，单独一行以起止时间区分，不把半小时笔记复制到各10分钟段。
