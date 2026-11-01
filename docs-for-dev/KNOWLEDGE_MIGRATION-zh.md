> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# 知识迁移指南

[使用手册](README.md) · [相关指南](INDEXING_RECOVERY.md)

本指南涵盖将现有笔记从 Obsidian、Hermes 或其他基于 Markdown 的工具移动到当前的知识中心。要在工作区之间移动现有 DeepTutor 数据，请使用[工作区数据迁移](workspaces.md)。

## 选择迁移路径

| 小路 | DeepTutor 保留了什么 | 最适合 | 权衡 |
| --- | --- | --- | --- |
| 连接黑曜石金库 | 指向金库的实时指针 | 继续使用黑曜石作为事实来源 | Vault 未复制到向量索引中，因此它不是 RAG 语料库 |
| 导入索引知识库 | Markdown 和其他支持的文件复制到“raw/”，然后建立索引 | 使用选定的检索引擎搜索复制的语料库 | 原始笔记的后续更改不会自动导入 |

DeepTutor 没有专用的一键 Hermes 导入器。将 Hermes 笔记导出为 Markdown 并遵循导入的知识库路径。首先在你的笔记工具中检查导出； DeepTutor 不转换专有格式。

## 准备源码

1. 在连接或导入源保管库或导出之前对其进行完整备份。
2. 将注释导出为 `.md` 或 `.markdown`。当您的笔记工具提供该选项时，请包括链接的图像和文档资源。
3. 如果应用程序导出 HTML 或其他格式，请将其转换为 DeepTutor 外部的 Markdown，检查示例，并验证链接和附件是否仍然可以解析。
4. 选择上表中的两条路线之一。您可以使用两者：连接实时黑曜石保管库进行笔记工作，并在需要可检索索引时导入副本。

## 连接黑曜石

当 Obsidian 仍然是您的主要编辑器并且您希望 DeepTutor 浏览并添加到相同的笔记时，请使用此路径。

1. 在 DeepTutor 中，打开 **知识中心**，选择 **创建 KB**，然后选择 **链接现有** 和 **Obsidian**。
2. 输入 DeepTutor 服务器可以访问的保管库文件夹的绝对路径，例如 `/Users/example/Documents/MyVault`。不要输入来自另一台计算机的路径。
3. 为知识库指定一个独特的名称并将其连接起来。
4. 在聊天中选择该知识库。然后黑曜石工具会对选定的保管库进行操作。

DeepTutor 创建一个指针而不是上传或索引。它识别 Markdown 注释，跟踪库链接和标签，并忽略 `.obsidian`、 `.trash` 和 `.git` 内部结构。写入是附加的：可以创建、附加注释或给定 frontmatter 属性，但助手不会删除或重写现有注释正文。删除知识库仅删除DeepTutor指针；金库保持原样。

对于自托管容器，安装主机保管库，以便相同的路径在服务器容器内可见，然后连接服务器可见的路径。仅在主机上有效的路径是不够的。

要对黑曜石笔记副本进行语义检索，请将该副本导入为单独的索引知识库。保留连接的库以进行实时编辑，以便两种用途保持清晰。

## 导入 Markdown 或 Hermes 笔记

当您需要复制的、索引的语料库时，请使用此路径。源注释保留在其原始位置。

### 网络

1. 将笔记和资源导出到本地 Markdown 文件夹。
2. 在 DeepTutor 中，打开 **知识中心** 并选择 **创建知识库**。
3. 选择**新建**和检索引擎。 LlamaIndex 是默认值；仅当其权衡适合语料库时才选择另一个引擎。
4. 上传文件、文件夹或 `.zip` 存档。
5. 等待解析和索引完成，然后在删除任何源备份之前确认一些有代表性的注释是可检索的。

**文件夹上传**保留其相对目录结构。 `.zip` 存档会进行防御性扩展：嵌套目录被展平、跳过不支持的成员、跳过隐藏和系统条目以及跳过展平后的重复基本名称。当笔记标题在不同文件夹中重复或文件夹层次结构有意义时，首选文件夹上传。

上传 UI 报告支持的扩展名和每个文件的限制。当前的 Markdown 扩展是 `.md` 和 `.markdown`；相同的上传政策接受其他支持的文本、文档、电子表格、演示文稿、EPUB、图像和源格式。

### 命令行界面

从导出目录：

```bash
deeptutor kb create hermes-notes --docs-dir /path/to/hermes-export
```

对于单个文件或以后添加的文件：

```bash
deeptutor kb create one-note --doc /path/to/note.md
deeptutor kb add hermes-notes --docs-dir /path/to/more-notes
```

CLI 递归地从 `--docs-dir` 收集支持的文件，然后将每个匹配的文件复制到知识库的 `raw/` 目录的顶层。由于重复的文件名可能会覆盖较早的副本，因此当文件名重复或层次结构有意义时，首选 Web 文件夹上传。使用 `deeptutor kb list` 和 `deeptutor kb info hermes-notes` 确认创建和文档计数。

## 验证迁移

- 打开小型、中型和深度嵌套的示例注释，并检查文本、链接和资产引用是否仍然可读。
- 对于索引知识库，运行代表性搜索以查找确切的注释名称、短语和概念。确认引用的来源指向预期的注释。
- 对于 Obsidian，搜索笔记、点击链接或反向链接、创建草稿笔记，然后从 Obsidian 中删除该草稿笔记。
- 保留原始备份，直到确认检索质量和资产参考。

## 实施与验证

- [deeptutor/capability/obsidian/vault.py](../deeptutor/capabilities/obsidian/vault.py)
- [deeptutor/api/routers/knowledge.py](../deeptutor/api/routers/knowledge.py)
- [deeptutor_cli/kb.py](../deeptutor_cli/kb.py)