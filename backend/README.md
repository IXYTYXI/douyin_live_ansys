# 录制片段 → ASR → 复盘查询

这是独立测试后端，Python 3.11+ 标准库 + FFmpeg，可在 Mac / Windows 运行。已实现文件处理与公司 ASR 接口适配；不是已上线的 OBS 推流服务，也尚未连接部署中的复盘 UI。

## 处理流

```text
OBS / MediaMTX 完成一个录制片段
  → ingest(场次、真实开播时间、片段第一帧时间、文件)
  → 留存原文件 / FFmpeg 单声道 16kHz PCM16
  → 默认 45 秒音频块（与人数 10 秒采样独立）
  → SQLite queued → submitted → done / failed
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

参考 `.env.example` 设置到运行环境（程序不自动加载 .env）。密钥至少 24 字符，自己生成，不要提交 Git。

- `REVIEW_API_KEY`：读取业务 API 的 Bearer 密钥。
- `MEDIA_SIGNING_KEY`：签发限时音频/视频 URL 的独立密钥。
- `PUBLIC_BASE_URL`：本服务可被 ASR 服务访问的 HTTPS 地址。需要部署或反向代理；本机 localhost 不能被远端 ASR 访问。
- `COMPANY_ASR_URL`：公司 ASR 服务地址，无内置生产地址。
- `COMPANY_ASR_HOST`：可选虚拟 Host。
- `COMPANY_ASR_UID`：测试用户标识。
- `COMPANY_ASR_BEARER`：如网关需要 Bearer 认证才设置。
- `DATA_DIR`：本地持久目录，默认 `private-data/asr`。

先只启动查询服务，再显式启用真实 ASR：

```sh
python3 -m backend serve
python3 -m backend serve --worker
```

两条命令二选一，不同时占同一端口。默认仅监听 127.0.0.1:18772。外部部署应使用 HTTPS 反向代理；不要把 Python 标准库 HTTP 服务直接暴露公网。不会自动上传到飞书或业务表。

API：`GET /api/sessions/test-001?start=120&end=720`，请求头 `Authorization: Bearer <REVIEW_API_KEY>`。返回片段任务状态、文字以及录制文件的签名 URL。URL 支持单段字节 Range 用于播放器拖动。前端定位：`video.currentTime = 目标直播相对秒 - recording.start`，仅在该录制片段覆盖的时间范围内播放。当前静态页面尚未连接此 API；不得把 API 密钥硬编码进公开前端。

## 重试与恢复

任务与结果存 SQLite，重启可继续轮询已提交任务。每步异常指数退避，累计 5 次失败停止；24 小时未完成也停止。可执行 `python3 -m backend retry test-001` 重试失败任务。对于已过 24 小时的远端任务，需要运营核查远端状态，retry 不会重新创建远端任务。

相同场次、片段起点和内容哈希重复导入不重复建任务。提交始终使用固定 X-Api-Request-Id；网络中断发生于提交成功但本地落库前时可能重发，依赖上游同 ID 幂等语义，未真实验证，不能宣称 exactly-once。锁租约 180 秒，单个 HTTP 请求 30 秒超时。媒体暂不自动删除，须规划保留期限与磁盘容量。原文件与提取音频时长可能存在偏差，生产需结合源流时间校准。

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

- `ASR_BUSINESS=douyin`：新录制任务哈希包含业务标识；数据库绑定该标识，禁止把同一目录改为淘宝用途。已有任务保持原 ID，不导致重复提交。不同业务必须使用不同 DATA_DIR。
- `COMPANY_ASR_UID`：CLI 默认 `diting-douyin`，仅作请求业务标识，不是权限或额度隔离机制；公司如何使用 uid 需按其规范确认。
- `ASR_MAX_INFLIGHT=2`：限制本队列已提交或待确认重试的任务，优先轮询已有任务再补新任务。它不是公司的总并发上限。
- `ASR_REQUESTS_PER_MINUTE=60`：单个服务进程内平滑限制所有 submit/query/result HTTP 请求，含轮询。支持 6–6000。当前部署方式是单个 worker 进程；多实例时该 HTTP 限速不共享，不能把它当集群总额度。
- `ASR_POLL_SECONDS=5`：每个任务轮询间隔。上述参数均为可配置的初始值，不代表已确认的公司限额。
- HTTP 429/503：遵循 Retry-After（秒数或 HTTP 日期），本数据库队列整体冷却；缺少该头默认至少 30 秒。网络错误、408、5xx 有限退避重试并加随机间隔；其他 HTTP 4xx 停止任务。最多累计 5 次错误后转 failed，需要人工检查。
- 不猜测公司业务错误码的限流含义；目前沿用参考接口成功/处理中状态码，其余非 5 开头业务码视为终止错误。拿到公司正式码表后补充映射。
- 同一任务重试持久复用同一音频 URL 和请求 ID，减少提交响应丢失后的重复任务风险。签名过期需人工处理；不会无提示更换 URL 重发同一 ID。

失败的远端任务不代表已取消：本地释放名额无法保证公司侧任务已经结束。并发限制是本业务的准入控制，不能保证淘宝或其他团队完全不受共享 ASR 负载影响。没有调用远端取消接口，也不读取其他服务的队列。真实吞吐能力需要公司配额及联调数据确认。
