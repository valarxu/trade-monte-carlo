# Trade Monte Carlo · 交易蒙特卡洛

将历史交易导入浏览器，在**历史收益分布与胜率的双重约束**下生成蒙特卡洛模拟。各币种独立 Tab，红线为历史交易顺序，蓝线为模拟，附带收益分布对照和 32 项统计。

**本地优先、零运行依赖、无需 API Key。** 浏览器导入的文件只在本机内存中处理，不上传、不存入浏览器持久存储。仓库内示例全部为程序生成的虚构交易。

## 快速使用

需要 Node.js 22 或更新版本，推荐使用 `.node-version` 指定的版本。没有第三方依赖，无需执行 `npm install`。

```sh
npm start
```

打开终端显示的本地地址，默认是 `http://127.0.0.1:4180/`。

1. 页面初始展示合成示例。点击 **导入 CSV / JSON**，选择原始交易文件。
2. 如果有多个账户，先选择一个账户，再勾选分析币种。不同计价交易对不会合并。
3. 设置模拟条数与随机种子，点击 **开始模拟**。
4. 切换币种 Tab；选择任意模拟编号，对照柱状图和单笔收益区间笔数。
5. 点击 **最大回撤** 或 **资金最低** 查看风险极端路径；可下载每个币种的统计 CSV。

默认规则：区间笔数相对历史 ±20%、胜率绝对波动 ±5 个百分点、交易总笔数固定、初始资金 50% 为自定义爆仓线。高级参数可调整这些阈值。

## 输入格式

两种 CSV 格式均可使用，多余字段不会进入分析。

### 已有逐笔收益率

```csv
account_id,symbol,return_pct,closed_at
example-account,BTC-USDT,3.5,2000-01-01T00:00:00Z
example-account,BTC-USDT,-1.2,2000-01-02T00:00:00Z
```

- `return_pct` 的单位是百分数：`1` 表示 **1%**，不是 100%；也接受 `1%`。
- `account_id` 可省略。文件包含多个账户时必须明确选择，不会自动混在一起。
- `closed_at` 可省略；没有时间列时按文件原始行顺序回放。存在时间列时必须填写有效 ISO 日期或带时区的 ISO 时间。
- 可选 `record_id` / `trade_id` 用于检测重复记录。重复时会报错，不会擅自删除。

JSON 接受同字段的记录数组，或 `{ "trades": [...] }`。完整示例见 [examples/synthetic.csv](examples/synthetic.csv)。

### 只有开平仓均价

使用 `account_id,record_id,symbol,direction,open_price,close_price,closed_at`，其中 `direction` 为 `long` 或 `short`。示例见 [examples/raw-format.csv](examples/raw-format.csv)。

价格收益率计算为：

```text
long:  (close_price / open_price − 1) × 100%
short: (close_price / open_price − 1) × −100%
```

`realized_pnl`、`fee`、`funding_fee`、仓位数量等字段不用于此价格收益模型。胜率按价格收益率大于零计算，可能不同于扣费后的实际盈利胜率。若已经自行计算净收益率，应通过 `return_pct` 明确提供，并自行保证每笔收益基准一致。

## 命令行生成可保存的页面

把真实数据放在被 Git 忽略的 `local-data/`，将结果输出到 `local-output/`：

```sh
npm run analyze -- \
  --input local-data/trades.csv \
  --account example-account \
  --symbols BTC-USDT,ETH-USDT,SOL-USDT \
  --paths 10000 \
  --seed 20261023 \
  --output local-output/report.html \
  --summary local-output/summary.json
```

单账户文件可以省略 `--account`。使用 `--all-accounts` 才会明确合并多个账户。`--symbols BTC` 会选中 BTC 相关计价对，但仍分别建模；指定完整交易对则精确筛选。

生成的 HTML 内嵌页面代码、输入的最小分析数据和合成示例，可直接在现代浏览器打开，也可用本地服务打开：

```sh
node scripts/serve.mjs --dir local-output --port 4181
```

然后访问 `http://127.0.0.1:4181/report.html`。报告移除了账户、订单 ID 和原文件路径，**仍包含真实逐笔收益率，因此仍属于私人数据**。不要将它推送到公开仓库。

现有输出默认不会覆盖，显式添加 `--force` 才会覆盖。全部选项：

```sh
npm run analyze -- --help
```

## 统计与模型

每币种列出 32 项统计，分为四组：

- **最终收益分布**：中位数、均值、P5、P95、最差、最好、标准差、最差 5% 的平均收益。
- **最大回撤分布**：平均值、中位数、P95、P99、最严重、最轻、达到 20% 和 30% 的比例。
- **亏损与资金触线**：最终亏损、最终盈利、曾触爆仓线、期末仍低于资金线、期末亏损至少 20%、资金翻倍、高于历史终值、回撤达到 50% 的比例。
- **逐笔表现与连亏**：交易笔数、平均胜率、实际胜率范围、盈亏比中位数、最长连亏的中位数/P95/最大值、最低资金比例。

**最大回撤**以此前资金峰值为基准。**爆仓**仅是自定义风险标记：任意一笔交易后净值严格低于初始资金阈值即计入，恢复后不撤销；触线后仍继续计算完整路径，不模拟实际强平或停盘。恰好等于阈值不计入。

抽样方法、统计定义与局限见 [docs/methodology.md](docs/methodology.md)。

## 构建、测试与隐私检查

```sh
npm test
npm run build
npm run check:privacy
# 或一次执行：
npm run check
```

`npm run build` 只生成包含虚构示例的自包含 `dist/index.html`，不读取真实数据。这个文件可作为静态页面部署，用户导入的交易文件仍在各自浏览器本地处理。

项目不依赖专有仪表盘运行环境、Python、CDN、数据库或云端服务。模型与解析器是可直接导入的 ES Modules；后台 Worker 支持计算进度与取消，不能使用 Worker 时回退到主线程。

提交前的扫描会检查版本控制文件中的私人绝对路径、常见凭据形态和不应提交的数据/报告。可额外传入本地私密标识列表：

```sh
node scripts/check-privacy.mjs --deny-file local-data/private-markers.json
```

这个 JSON 是字符串数组，内容只在本地参与扫描，不会写入扫描结果。该检查不能代替人工复核，也不能承诺识别所有潜在隐私。

## 边界

- 初始净值为 1，每笔以当前权益的 1 倍名义金额串行复投；不模拟持仓重叠、仓位缩放、保证金和交易所强平。
- 单笔收益率必须大于 −100%；不静默截断或修正不适用的数据。
- 默认约束有意限制分布变化，不覆盖历史之外的市场状态和尾部损失。
- 百分位不是未来收益的置信区间；0% 只表示本批模拟未出现。
- 每币种最多 10,000 笔，交易笔数×模拟条数最多 300 万；全部币种合计最多 600 万步。规模过大时应减少条数或分批分析。
