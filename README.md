# 谛听 · 抖音直播复盘

现有开发代码快照，包含复盘页面与 Chrome 插件联调版本。

## 当前状态

- 复盘 UI：30 分钟区间、默认 10 分钟前后跳转、曲线与文字联动、16 字以内主题编辑、关键词增删、本机浏览器草稿。
- 真实数据模型：支持秒级开播起点、部分转写、缺失在线序列，不把整场均值当作时段曲线。
- 插件：现有罗盘采集逻辑与全自动开关设置。自动调度、抖音主播后台采集、Mac 桥接尚未完成。
- 新增 `backend/`：完成录制文件导入、FFmpeg 切音频、公司 ASR 适配、持久化队列和复盘查询 API。见 [运行说明](backend/README.md)。已完成单段45秒音频的公司 ASR 真实联调与逐句展示；OBS 实时接流、完整视频回放与正式自动总结尚未集成。

## 本地启动

需要 Node.js 及 Python 3，无前端依赖安装。

```sh
python3 -m http.server 18771 --bind 127.0.0.1 --directory review-demo/dist
```

打开 http://127.0.0.1:18771/ 。公开版本默认展示模拟数据。

```sh
node --test tests/*.test.mjs review-demo/*.test.mjs
```

## 目录

- `review-demo/dist`：静态页面与数据模型。
- `diting-auto-test/extension`：Chrome 扩展现有源码。
- `diting-auto-test/native`：Windows 桥接安装、卸载脚本。
- `tests`：全自动设置与消息处理测试。
- `docs`：当前开发计划。

## 公开版本与本地测试环境的区别

真实直播快照、Sites 部署配置、登录凭据及 Windows EXE 未提交。`anchor-fixture.mjs` 为 null 占位；页面保留真实数据适配能力。飞书测试表地址和标识已替换为 `REPLACE_WITH_TEST_*`，必须配置独立测试表后才能联调。安装包缺少 EXE，不能直接作为完整安装包运行；原桥接二进制没有对应源码。

本次发布为代码备份，不代表全自动直播采集或 OBS-ASR 链路已交付。不要将测试配置指向业务表。

### 已部署的独立采集入口

插件批量上传地址：`https://live-ansys.ai.lab.yc345.tv/api/metrics/batches`。
在插件「上传设置」中填入管理员提供的上传专用令牌并授权此域名。
令牌不包含在源码或插件包中；它只能上传，不能读取复盘数据。
每10秒采样、每5分钟发送最多300条，收到相同批次的数据库确认后才移除本地记录。
切换接口前若有未确认批次，请先完成原批次上传，不要删除本地队列。

服务器在拉取本分支后运行 `.venv-review/bin/python backend/deploy/install_ingest.py`。
脚本沿用已有独立数据库 `diting_plugin_test_20261008`，增加 `diting-ingest.service`
（仅监听127.0.0.1:18777）和Nginx精确上传路由。重复部署保留上传凭证；配置仅存于
root可读的 `/etc/diting-ingest.env`。此入口只保存原始采样，不猜测与旧录像的场次关联。

### OBS 推流与正式场次

打开 `https://live-ansys.ai.lab.yc345.tv/live-setup`（使用复盘网页登录）。
先在插件开始采集并「立即上传」，再选择对应主播和时间的采集批次，获取 OBS 自定义服务器与推流密钥。
使用 H.264/AAC、2秒关键帧间隔；核对画面后手动开始 OBS 直播。每次插件重新开始采集会生成新批次，需要重新获取对应推流配置；同一密钥断线重连归入同场。

服务器接收 RTMPS 1936，约60秒完成一个录像片段，再分45秒音频提交公司ASR（独立队列，并发1、每分钟至多30次请求）。
网页通过 `/api/sessions` 和 `/api/sessions/:id` 查看不同场次，每10秒刷新已完成数据；视频分段连续播放。
直播期间分析完整10分钟窗口，停播后补尾段；分析会等待相应人数上传和转写完成。断流与未知人数不会补造。
推流场次以服务器首段接收时刻为零点，并非抖音平台实际开播时刻。

部署入口为 `.venv-review/bin/python backend/deploy/install_live.py`，支持传入官方归档路径（仍校验固定SHA256）。
`diting-stream.service` 只接收和录制，`diting-live.service` 处理音频与公司ASR；凭证不进入Git。
原始音频仅通过时效签名的 `/asr-audio/media/...wav` 提供给ASR，复盘录像仍需网页登录。
录像暂未自动删除，请按实际直播时长规划磁盘留存。异常断电留下的未完成录像会保留，需核验后恢复。

实现参考：[MediaMTX OBS 接入](https://mediamtx.org/docs/publish/obs-studio)、[录制钩子](https://mediamtx.org/docs/features/hooks)。
