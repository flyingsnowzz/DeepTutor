# MCP 服务依赖说明

## 服务形态
- 技能是声明式门面，不内置题库、RAG、掌握度数据库，不保存学习记录，不直接连接数据库或对象存储。
- 所有学习功能由 DeepTutor MCP 服务提供，支持两种连接：
  - **本地 stdio**：`deeptutor mcp serve --transport stdio`（单机开发/自托管）；
  - **云端 streamable HTTP**：`POST {base_url}/mcp`，`Authorization: Bearer <access_token>`。

## 运行依赖
| 能力 | 服务端依赖 |
| --- | --- |
| 解题/研究/出题/判分/可视化/掌握路径 | DeepTutor 应用服务 + 已配置的模型 |
| PDF 精读 | PyMuPDF |
| 视频课 | Node.js 22 + npm（Remotion）、ffmpeg、TTS |
| 数学动画 | manim>=0.19、LaTeX、ffmpeg |
| 数据层 | PostgreSQL 15+（唯一关系库）、S3 兼容对象存储（产物） |

能力就绪状态以 `capabilities_list` 为准；缺依赖时调用返回 `CAPABILITY_UNAVAILABLE`，技能会如实说明而不是伪造结果。

## 版本兼容
- 技能版本 0.1.0 对应 MCP 工具契约 T4 冻结集；新增工具向后兼容追加，不修改既有工具语义。
- 本地自托管与云端共用同一工具集与错误码。
