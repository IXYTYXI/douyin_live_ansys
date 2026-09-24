# 录制片段 → ASR → 复盘查询

这是独立测试后端，Python 3.11+、psycopg、PostgreSQL + FFmpeg，可在 Mac / Windows 运行。已实现文件处理与公司 ASR 接口适配；不是已上线的 OBS 推流服务，也尚未连接部署中的复盘 UI。

## 处理流

```text
OBS / MediaMTX 完成一个录制片段
  → ingest(场次、真实开播时间、片段第一帧时间、文件)
  → 留存原文件 / FFmpeg 单声道 16kHz PCM16
  → 默认 45 秒音频块（与人数 10 秒采样独立）
  → PostgreSQL queued → submitted → done / failed
  → 公司 Qwen ASR submit → query → result
  → GET /api/sessions/{id}?start=0&end=1800
```

时间全部以实际开播为零点，单位秒。晚两分钟录制的第一条文字从 120 秒开始，不把缺失的两分钟压缩掉。每个录制片段独立传 recorded-at，断流后的空白保留。现阶段文字时间精度为音频块，`timing=chunk`，不是逐字时间。区间查询返回与区间重叠的块，保留完整文字及原始起止，不裁剪或复制伪造文字。

## 1. 导入已完成的文件（不调用外部服务）

在仓库根目录运行，确保 ffmpeg 在 PATH：

```sh
python3 -m backend ingest /path/to/completed.mp4 --session test-001 --started-at 2026-09-22T20:00:00+08:00 --recorded-at 2026-09-22T20:02:00+08:00
python3 -m backend review test-001
```

Windows 可把 `python3` 替换为 `python`，文件参数使用 Windows 路径。不要导入正在写入的 OBS 文件；上游 MediaMTX 的片段完成 hook 可调用该命令。此仓库尚未提供 RTMP 服务和自动 hook 安装。优先使用浏览器支持的 MP4/H.264/AAC；原文件只留存不做视频转码，MKV 不保证网页可播。

## 2. 配置环境变量

将以下变量设置到运行环境（程序不自动加载 .env）。密钥至少 24 字符，自己生成，不要提交 Git。

- `REVIEW_API_KEY`：读取业务 API 的 Bearer 密钥。
- `MEDIA_SIGNING_KEY`：签发限时音频/视频 URL 的独立密钥。
- `PUBLIC_BASE_URL`：本服务可被 ASR 服务访问的 HTTPS 地址。需要部署或反向代理；本机 localhost 不能被远端 ASR 访问。
- `COMPANY_ASR_URL`：公司 ASR 服务地址，无内置生产地址。
- `COMPANY_ASR_HOST`：可选虚拟 Host。
- `COMPANY_ASR_UID`：测试用户标识。
- `COMPANY_ASR_BEARER`：如网关需要 Bearer 认证才设置。
- `ASR_DATABASE_URL`：PostgreSQL 连接串，必填；可与指标库共用数据库，使用独立业务 schema `diting_asr_douyin`。
- `DATA_DIR`：音视频文件持久目录，默认 `private-data/asr`；数据库不保存视频二进制。所有 worker 必须访问同一媒体目录。

先只启动查询服务，再显式启用真实 ASR：

```sh
python3 -m backend serve
python3 -m backend serve --worker
```

两条命令二选一，不同时占同一端口。默认仅监听 127.0.0.1:18772。外部部署应使用 HTTPS 反向代理；不要把 Python 标准库 HTTP 服务直接暴露公网。不会自动上传到飞书或业务表。

API：`GET /api/sessions/test-001?start=120&end=720`，请求头 `Authorization: Bearer <REVIEW_API_KEY>`。返回片段任务状态、文字以及录制文件的签名 URL。URL 支持单段字节 Range 用于播放器拖动。前端定位：`video.currentTime = 目标直播相对秒 - recording.start`，仅在该录制片段覆盖的时间范围内播放。当前静态页面尚未连接此 API；不得把 API 密钥硬编码进公开前端。

## 重试与恢复

任务与结果存 PostgreSQL，重启可继续轮询已提交任务。每步异常指数退避，累计 5 次失败停止；24 小时未完成也停止。可执行 `python3 -m backend retry test-001` 重试失败任务。对于已过 24 小时的远端任务，需要运营核查远端状态，retry 不会重新创建远端任务。

相同场次、片段起点和内容哈希重复导入不重复建任务。新任务使用确定性 UUID 作为 X-Api-Request-Id；迁移的旧任务保留原远端 ID。网络中断发生于提交成功但本地落库前时可能重发，依赖上游同 ID 幂等语义，未真实验证，不能宣称 exactly-once。锁租约 180 秒，单个 HTTP 请求 30 秒超时。媒体暂不自动删除，须规划保留期限与磁盘容量。原文件与提取音频时长可能存在偏差，生产需结合源流时间校准。

## 验证

```sh
python3 -m unittest discover -s backend/tests -v
node --test tests/*.test.mjs review-demo/*.test.mjs
```

测试包括真实 FFmpeg 提取、尾片、偏移、重复导入、重启恢复、失败不造字、HTTP ASR 契约、鉴权和 Range。ASR 测试使用本机模拟服务器，没有调用真实公司服务，也没有以静音识别结果冒充真实识别准确率。

## 参考

公司 ASR 协议参考用户提供的 [OBS-ASR 分支](https://github.com/IXYTYXI/tbjdasr.ailab/tree/codex/obs-asr-backend)，核对版本 `2ba3cb949d9d4c3c4aa5db85b93fbdbd289382e0` 的 `app/providers.py` 和契约测试。没有复制其生产地址、账号或密钥。

## 共用公司 ASR，独立处理抖音业务

淘宝和抖音是不同音频，分别转写。此后端只管理抖音本地队列，不修改淘宝服务，不控制公司其他调用方。

- `ASR_BUSINESS=douyin`：新录制任务哈希包含业务标识；每个业务使用独立 PostgreSQL schema；首次连接自动建表，需要对应建表权限。不同业务必须使用不同 DATA_DIR。
- `COMPANY_ASR_UID`：CLI 默认 `diting-douyin`，仅作请求业务标识，不是权限或额度隔离机制；公司如何使用 uid 需按其规范确认。
- `ASR_MAX_INFLIGHT=2`：限制本队列已提交或待确认重试的任务，优先轮询已有任务再补新任务。它不是公司的总并发上限。
- `ASR_REQUESTS_PER_MINUTE=60`：单个服务进程内平滑限制所有 submit/query/result HTTP 请求，含轮询。支持 6–6000。当前部署方式是单个 worker 进程；多实例时该 HTTP 限速不共享，不能把它当集群总额度。
- `ASR_POLL_SECONDS=5`：每个任务轮询间隔。上述参数均为可配置的初始值，不代表已确认的公司限额。
- HTTP 429/503：遵循 Retry-After（秒数或 HTTP 日期），本数据库队列整体冷却；缺少该头默认至少 30 秒。网络错误、408、5xx 有限退避重试并加随机间隔；其他 HTTP 4xx 停止任务。最多累计 5 次错误后转 failed，需要人工检查。
- 不猜测公司业务错误码的限流含义；目前沿用参考接口成功/处理中状态码，其余非 5 开头业务码视为终止错误。拿到公司正式码表后补充映射。
- 同一任务重试持久复用同一音频 URL 和请求 ID，减少提交响应丢失后的重复任务风险。签名过期需人工处理；不会无提示更换 URL 重发同一 ID。

失败的远端任务不代表已取消：本地释放名额无法保证公司侧任务已经结束。并发限制是本业务的准入控制，不能保证淘宝或其他团队完全不受共享 ASR 负载影响。没有调用远端取消接口，也不读取其他服务的队列。真实吞吐能力需要公司配额及联调数据确认。

## 主播插件数据接收（PostgreSQL）

独立服务，不初始化 ASR 的本地任务库，不创建 SQLite。数据库连接仅在服务器配置，插件只持有接口令牌。

```sh
python3 -m pip install -r backend/requirements.txt
# 通过服务器的密钥管理/环境变量设置 METRICS_DATABASE_URL 和 METRICS_API_KEY。
# METRICS_API_KEY 至少 24 字符；不要提交真实配置。
python3 -m backend.metrics_service migrate
python3 -m backend.metrics_service serve --host 127.0.0.1 --port 18773
```

迁移只新增 `diting_metrics` schema，包含 `samples`（逐条采样和接收时间）、`batches`（批次内容与幂等校验）。数据库账号须有对应权限。先在测试数据库执行，公网访问由 HTTPS 反向代理转到本服务。

- `POST /api/metrics/batches`：Bearer `METRICS_API_KEY`，JSON `{schema:1,batchId,records}`，最多 300 条/2 MB。事务提交后返回 `{batchId,acceptedIds}`；相同记录重传不会重复入库；相同 ID 不同内容返回 409，整批回滚。数据库失败返回 503，插件保留原批次重试。
- `GET /api/metrics?runId=...&after=0&limit=300`：同样鉴权，返回 `records,nextCursor`，按入库序号分页。runId 是采集批次，不能作为真实直播场次 ID。
- 当前单个部署使用一个共享 API 令牌，适用于受控内部测试，不提供多租户隔离。批次写入使用事务锁串行处理以保证重传一致性和分页不会遗漏未提交记录。
- 部署并取得 HTTPS 地址后，才设置插件 `INGEST_URL`、对应 host permission 和上传令牌；当前插件仍未连接公网接口。
- 每 10 分钟分析和飞书同步不在此接收服务内。

验证：`python3 -m unittest discover -s backend/tests -v`。
PostgreSQL 集成测试仅在设置 `METRICS_TEST_DATABASE_URL` 后运行：**必须指向专用可清空的测试数据库**，测试会清空其中的 `diting_metrics.samples/batches`。未配置时明确跳过，不表示数据库联调通过。


## ASR PostgreSQL 升级与前端接入

此版本 ASR 队列、场次、片段及转写文字全部写 PostgreSQL；仅一次性迁移工具读取旧 SQLite。全新部署只需设置 ASR_DATABASE_URL，无需迁移旧文件。

已有旧数据时：先停止旧、新 worker，备份旧目录，并让 DATA_DIR 指向原媒体目录（跨机器时完整复制 media/）。目标业务 schema 必须没有场次，避免覆盖或模糊合并。

```sh
python3 -m pip install -r backend/requirements.txt
# 服务器环境中设置 ASR_DATABASE_URL，不要将密码提交到 Git。
python3 -m backend.migrate_sqlite /path/to/old/pipeline.sqlite --data /path/to/media-root --business douyin
python3 -m backend serve --worker
```

迁移为单事务，失败回滚；旧数据库只读不修改。完成后核对迁移行数与媒体文件。旧队列已提交的任务继续用原 task_id 轮询；新任务按公司文档使用 UUID。公司失败码 55000031 终止任务，不重复轮询。采用 query/result 轮询，无需配置 callback 白名单。公司文档未明确 utterances 时间单位，本版仍按音频块输出时间，不猜测逐字时间。

前端对接：在用户选择场次或时间段时，请求 `GET /api/sessions/{id}?start=0&end=1800`；处理中可每 10 秒刷新，离开页面停止。返回 segments 的 state/text/start/end，以及 recordings 的 start/duration/url；done 才展示转写，缺失与失败不填假内容。视频定位为直播相对秒减 recording.start，仅在该录像覆盖范围内跳转。

线上网页应通过同域、带用户鉴权的后端代理查询，由服务器注入 REVIEW_API_KEY；不能把共用密钥打包进网页。当前静态演示网页尚未接这个代理。插件 runId 与 ASR sessionId 不是同一概念，需明确关联后再按实际开播时间对齐人数曲线，不能按昵称猜测场次。本提交不包含 OBS 收流服务、用户登录代理、自动 AI 总结或线上网页部署。

测试环境：设置 ASR_DATABASE_URL 指向专用测试 PostgreSQL，运行原有测试。每条 ASR 测试使用独立随机业务 schema；METRICS_TEST_DATABASE_URL 仍必须指向可清空的专用测试库。

## 与 db/schema.sql 业务表衔接

`db/schema.sql` 纳入版本管理，保留原有五张表。`metrics_service migrate` 先初始化收件表，再执行业务基线和增量迁移 `003_business_metrics.sql`；只新增字段/关联表，不删除既有电商字段或数据。

接收服务现在使用 BusinessStore：未绑定 runId 的记录先保存在 `diting_metrics.samples`；绑定后在同一事务投影到 `diting.capture_snapshots` 和 `diting.online_samples`，提交后才返回确认。昵称不作为场次匹配依据。使用业务表中已确认的场次 ID：

```sh
python3 -m backend.metrics_service bind --run-id COLLECTOR_RUN_UUID --session-id EXISTING_BUSINESS_SESSION_ID
```

该命令回填已接收记录，重复执行去重；runId 不允许改绑另一场次，超出场次时间的记录拒绝整批入库。场次须事先有真实 live_room_id、started_at，不能以首次采样时间冒充开播时间。未绑定不会丢失数据，也不会创建虚假场次。

实测字段：online/previewOnline/giftUsers/commentUsers/likes/shares/fanClubJoins/newFollowers 对应业务整数列；缺失保持 NULL，raw_payload 保留原始值与 approximate 标记。averageStay 只保存原始字符串和单位信息，单位未确认时不填 avg_stay_duration_seconds。is_stale 暂以采样 gap 标记，不能证明平台数值的新鲜程度。

此变更只映射已实测的插件指标；ASR 到业务 transcript_lines 的场次关联、统一前端查询尚待接通。真实导出数据仅用于本地测试，不提交到公共仓库。

## 本地模拟上传到复盘页面

仅针对专用测试 PostgreSQL，运行：

```sh
METRICS_TEST_DATABASE_URL=postgresql://... python3 -m backend.demo_forward
```

该脚本仅监听 127.0.0.1:18773，创建带 synthetic 前缀的独立模拟场次，生成 30 分钟/180 条十秒采样，调用插件共用的 flush 上传函数，通过鉴权 HTTP 接口入库并等待确认。然后浏览 `http://127.0.0.1:18773/?test=1`，前端通过 `/api/test/session` 从 PostgreSQL 读取曲线，每十秒刷新。无真实文字、视频或 AI 总结；不调用公司 ASR。临时上传密钥只在进程内生成，前端不含密钥。

这是本机联调工具，未安装 Chrome 扩展即可验证共用上传逻辑；不等同于 Chrome 后台定时器/权限弹窗端到端验证。测试读取接口仅提供本次生成的模拟场次，禁止将该无登录预览服务改为公网监听。线上域名仍需正式用户鉴权代理。

## 本地真实 ASR 结果预览

已有测试场次提交到公司 ASR 后，可在相同 `ASR_DATABASE_URL` 上启动只监听本机的预览：

```sh
python3 -m backend.asr_preview --data /path/to/test-media --business douyin_asr_check --session TEST_SESSION
```

浏览 `http://127.0.0.1:18774/?test=1`，每十秒从 PostgreSQL 查询所选场次，只展示 done 片段的真实文字；未关联人数时不产生模拟曲线，不生成 AI 总结。此预览不提供公网认证，仅用于本机联调，不能当作生产部署。

组合联调：给 asr_preview 增加 `--metrics-session ID`，可读取一个 live_room_id 以 synthetic- 开头的模拟场次人数，将相对时间起点与真实音频样本对齐。仅用于本地测试，原数据库时间与记录不改写。前端显示规则生成的主题、关键词和运营测试稿，并标注模拟指标/真实转写的不同来源；组合测试在前45秒真实转写之后补充逐行标注的模拟文字，覆盖30分钟，用于验证三个10分钟区间的文字、人数、主题、关键词和运营测试稿联动。模拟文字仅在浏览器组合测试模式生成，不写入ASR记录。真实音频仅在覆盖区间可播放；主播放按钮演示测试时间轴，不代表已有完整视频。
