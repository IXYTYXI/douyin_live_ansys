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
首次选择或填写与插件一致的主播名，获取固定 OBS 自定义服务器与推流密钥。
使用 H.264/AAC、2秒关键帧间隔；核对画面后手动开始 OBS 直播。后续插件重新开始采集无需换密钥；三分钟内重连续接原场，超过三分钟则自动新建场。

服务器接收 RTMPS 1936，约60秒完成一个录像片段，再分45秒音频提交公司ASR（独立队列，并发1、每分钟至多30次请求）。
网页通过 `/api/sessions` 和 `/api/sessions/:id` 查看不同场次，每10秒刷新已完成数据；视频分段连续播放。
直播期间分析完整10分钟窗口，停播后补尾段；分析会等待相应人数上传和转写完成。断流与未知人数不会补造。
推流场次以服务器首段接收时刻为零点，并非抖音平台实际开播时刻。

部署入口为 `.venv-review/bin/python backend/deploy/install_live.py`，支持传入官方归档路径（仍校验固定SHA256）。
`diting-stream.service` 只接收和录制，`diting-live.service` 处理音频与公司ASR；凭证不进入Git。
原始音频仅通过时效签名的 `/asr-audio/media/...wav` 提供给ASR，复盘录像仍需网页登录。
录像暂未自动删除，请按实际直播时长规划磁盘留存。异常断电留下的未完成录像会保留，需核验后恢复。

实现参考：[MediaMTX OBS 接入](https://mediamtx.org/docs/publish/obs-studio)、[录制钩子](https://mediamtx.org/docs/features/hooks)。

### 固定 OBS 入口与自动建场

打开 `/live-setup`，首次选择或填写与插件一致的主播名，将固定服务器及密钥填入 OBS。以后无需手动建任务或按采集批次换密钥。旧批次密钥仍兼容；要启用自动分场，请换成此页面提供的新固定密钥。

录像首次完成片段时自动建场。断流后 180 秒内重连续接原场，超过 180 秒新建场；停止并处理完片段后关闭场次。原始人数按主播名及捕获时间关联，允许延迟上传和插件重新开始。当前插件只有主播名称身份，名称必须一致且不同主播不能同名。无人数数据时不伪造人数，分析仍等待采集覆盖。

迁移使用 `backend/deploy/install_live.py`，新增 006_channels，不修改历史 ASR 表；部署前先确认没有进行中的推流。


### 网页录像加载优化

复盘播放器按场次和录像文件识别资源，后台每 10 秒刷新签名不再重置同一段视频；加载过久或失败可点击“重新加载录像”。

拉取本次代码后运行 `.venv-review/bin/python backend/deploy/install_playback.py`，启动独立 `diting-playback.service`。它每 30 秒扫描已提交的录像行，用 FFmpeg stream copy 生成索引前置的 MP4 副本，不重新编码，不修改原文件、ASR 输入或时间轴。`media/` 下副本约额外占用一份视频空间；磁盘不足时不发布副本，原录像继续可用。处理状态查看 `journalctl -u diting-playback.service`。

仅重载 `diting-review.service` 以启用回放副本查询；不必重启 OBS、采集插件、MediaMTX 或 ASR 收流服务。旧录像会补处理，新录像在完成入库后自动处理；副本完成前接口仍返回原录像。停止新 worker 并回退本次代码即可恢复原路径，原录像始终保留。

### 音轨静音兜底

新收到的音频在入库时检测音量，检测结果与 ASR 状态分开保存。连续约 60 秒的静音或极低音量会在复盘页顶部提示检查 OBS 音源；提示不依赖 ASR 返回，不自动停流或删除录像。声音恢复后保留历史异常记录。有声音不等于有可识别语音，检测也不能判断锁屏、重启等具体原因。

检测使用 16kHz 单声道 PCM 的一秒峰值，阈值 -60 dBFS；仅合并连续已收到的范围，不用无音频的间隙凑满告警时长。依赖已完成的录像片段，正常情况下页面提示可能滞后约 1—2 分钟。复盘页必须保持打开才能看到提示，目前没有桌面或飞书主动通知。时段总结和整场分析会携带静音、未检测及空转写说明，不把 ASR 完成等同于语音完整。

已有部署先执行 `.venv-review/bin/python -m backend.deploy.upgrade_audio_quality` 添加 nullable JSONB 字段，再加载新代码。可加 `--backfill-session <sessionId>` 检测指定历史场次；直播处理服务还会分批补检测旧的直播音频。检测失败保持未知状态，不伪报正常。整个过程不修改原始录像、ASR 文本或运营笔记。


### 静音提醒与直播源刷新

[下载 Chrome 插件 0.4.3（Mac / Windows 同包）](releases/diting-anchor-collector-0.4.3.zip)。覆盖原插件目录后重新加载，避免卸载造成缓存丢失。
在 OBS 采集的主播大屏中打开插件，展开“OBS 直播源”并绑定当前页；在同机同一浏览器打开公网复盘页。
直播中的静音弹窗可请求刷新此源页面；不刷新复盘页、不主动上传数据。历史回放仅提示缺失，不能补回原始声音。
具体步骤及限制见 [插件说明](anchor-collector/README.md#043-静音提醒刷新直播源)。
