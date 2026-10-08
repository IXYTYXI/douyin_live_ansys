# 固定主播推流入口与自动建场
用户已确认首次绑定、固定密钥、自动建场的方案。

实现：channels 保存唯一主播名与固定 UUID。新推流路径 channel-UUID；保留旧 UUID 路径兼容。最终录像段按录制时间自动分配场次，120 秒内重连归原场，超过则新建。segment 映射事务持久化保证重试不新建场。只有音视频已持久化后更新结束时间。停止并处理完队列后延迟120秒关闭场次。

人数按已绑定主播名与该场录像时间范围动态查询，允许采集批次变化和延迟上传。当前插件身份只有主播名，界面要求与插件一致；不以最新全局批次关联。旧场保持run_id查询。

执行步骤：
1. backend/tests/test_live.py 添加固定路径鉴权、重连边界及导入路由失败测试。
2. backend/migrations/006_channels.sql 增加channels、segments映射与sessions可空channel_id/media_end，保留旧run_id唯一。
3. backend/live.py 添加频道创建、事务注册片段、完成标记、时段人数查询；live_service/live_hook 支持新路径和原路径。
4. hosted_review提供主播列表与同源POST绑定；live-setup改为首次选择主播，保留密码遮罩复制。
5. install_live执行增量迁移和最小权限授予、接收器路径扩展；README更新。
6. 本地单元/前端测试，通过后commit/push。远端pull，先检查无进行中推流再部署。隔离测试频道推流，检验自动建场、固定凭据、ASR及旧接口，避免写业务数据。
