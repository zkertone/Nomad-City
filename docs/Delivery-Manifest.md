# v0.2.0 项目文件清单

仓库：[zkertone/Nomad-City](https://github.com/zkertone/Nomad-City)。以下位置均相对于仓库根目录；链接适用于 GitHub 页面和本地检出。

历史地图分析与 Board 设计稿保持原样，ADR 为 Accepted，DevLog 保留完整历史。

| 相对位置 | 文件链接 |
| --- | --- |
| `.gitignore` | [.gitignore](../.gitignore) |
| `README.md` | [README.md](../README.md) |
| `docs/Board-Model-v0.1.0.md` | [Board-Model-v0.1.0.md](Board-Model-v0.1.0.md) |
| `docs/Delivery-Manifest.md` | [Delivery-Manifest.md](Delivery-Manifest.md) |
| `docs/DevLog.md` | [DevLog.md](DevLog.md) |
| `docs/Map-Analysis-v0.1.0.md` | [Map-Analysis-v0.1.0.md](Map-Analysis-v0.1.0.md) |
| `docs/adr/ADR-0001-Board-Representation.md` | [ADR-0001-Board-Representation.md](adr/ADR-0001-Board-Representation.md) |
| `docs/testing/v0.2.0-validation.md` | [v0.2.0-validation.md](testing/v0.2.0-validation.md) |
| `package-lock.json` | [package-lock.json](../package-lock.json) |
| `package.json` | [package.json](../package.json) |
| `packages/game-core/package.json` | [package.json](../packages/game-core/package.json) |
| `packages/game-core/src/board/board.test.ts` | [board.test.ts](../packages/game-core/src/board/board.test.ts) |
| `packages/game-core/src/board/definitions/build.ts` | [build.ts](../packages/game-core/src/board/definitions/build.ts) |
| `packages/game-core/src/board/definitions/founders-3.ts` | [founders-3.ts](../packages/game-core/src/board/definitions/founders-3.ts) |
| `packages/game-core/src/board/definitions/founders-4.ts` | [founders-4.ts](../packages/game-core/src/board/definitions/founders-4.ts) |
| `packages/game-core/src/board/hash.ts` | [hash.ts](../packages/game-core/src/board/hash.ts) |
| `packages/game-core/src/board/index.ts` | [index.ts](../packages/game-core/src/board/index.ts) |
| `packages/game-core/src/board/schema.ts` | [schema.ts](../packages/game-core/src/board/schema.ts) |
| `packages/game-core/src/board/state.ts` | [state.ts](../packages/game-core/src/board/state.ts) |
| `packages/game-core/src/board/topology.ts` | [topology.ts](../packages/game-core/src/board/topology.ts) |
| `packages/game-core/src/board/types.ts` | [types.ts](../packages/game-core/src/board/types.ts) |
| `packages/game-core/src/board/validate.ts` | [validate.ts](../packages/game-core/src/board/validate.ts) |
| `packages/game-core/src/board/verification/verified-catalog.json` | [verified-catalog.json](../packages/game-core/src/board/verification/verified-catalog.json) |
| `packages/game-core/src/index.ts` | [index.ts](../packages/game-core/src/index.ts) |
| `scripts/archive.py` | [archive.py](../scripts/archive.py) |
| `scripts/check-maps.mjs` | [check-maps.mjs](../scripts/check-maps.mjs) |
| `tsconfig.build.json` | [tsconfig.build.json](../tsconfig.build.json) |
| `tsconfig.json` | [tsconfig.json](../tsconfig.json) |
| `vitest.config.ts` | [vitest.config.ts](../vitest.config.ts) |

共 29 个项目文件。依赖目录 node_modules、构建目录 dist 和 ZIP 归档不纳入 Git 源码提交；按 README 可重建。

原 v0.2.0 归档导入时只调整 README/本清单的链接及追加 DevLog；地图数据、Schema、测试及依赖锁文件不变。
