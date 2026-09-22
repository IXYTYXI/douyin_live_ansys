# 谛听 · 抖音直播复盘

现有开发代码快照，包含复盘页面与 Chrome 插件联调版本。

## 当前状态

- 复盘 UI：30 分钟区间、默认 10 分钟前后跳转、曲线与文字联动、16 字以内主题编辑、关键词增删、本机浏览器草稿。
- 真实数据模型：支持秒级开播起点、部分转写、缺失在线序列，不把整场均值当作时段曲线。
- 插件：现有罗盘采集逻辑与全自动开关设置。自动调度、抖音主播后台采集、Mac 桥接尚未完成。
- 新增 `backend/`：完成录制文件导入、FFmpeg 切音频、公司 ASR 适配、持久化队列和复盘查询 API。见 [运行说明](backend/README.md)。真实 ASR 尚未联调；OBS 实时接流、页面真实回放与自动总结尚未集成。

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
